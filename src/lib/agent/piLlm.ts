/**
 * pi-ai 适配层：把「OpenAI 兼容 /chat/completions」包装成 pi-agent-core 需要的
 * `StreamFn`（返回 AssistantMessageEventStream）。
 *
 * 为什么自己写而不是用 `@earendil-works/pi-ai/providers/*`：
 * - 浏览器打包友好：不引入 openai / @anthropic-ai/sdk / @aws-sdk 等重型 SDK
 * - 复用现有配置（endpoint / apiKey / model 全部来自 localStorage 的机器人配置）
 * - 复用现有模型适配（resolveMaxTokens / isReasoningModel）
 * - 原生 tool calling 是本文件的核心新增能力（现有 parseDelta 会丢弃 tool_calls）
 */
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  ImageContent,
  JsonObject,
  Message,
  Model,
  SimpleStreamOptions,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
  Usage,
} from "@earendil-works/pi-ai";
import { isReasoningModel, resolveMaxTokens } from "../providerPresets";

/** 与 AIChatConfig 兼容的最小配置形状（便于单测注入） */
export interface PiLlmCfg {
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface PiStreamHooks {
  /** 服务端明确表示不支持 tools/function calling（400/422/404 且报错含 tools） */
  onToolsUnsupported?: () => void;
  /** 请求实际下发了 tools（供 UI/埋点观察） */
  onToolsSent?: (count: number) => void;
}

export type PiStreamFn = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/** 由项目配置构造 pi 的 Model（api 固定为 openai-completions） */
export function toPiModel(cfg: PiLlmCfg): Model<"openai-completions"> {
  const baseUrl = cfg.endpoint.replace(/\/+$/, "");
  return {
    id: cfg.model,
    name: cfg.model,
    api: "openai-completions",
    provider: "lumia",
    baseUrl,
    reasoning: isReasoningModel(cfg.model),
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: resolveMaxTokens(cfg.model),
    compat: {
      // 大多数 OpenAI 兼容服务（DeepSeek/Kimi/GLM/Qwen…）不认识 developer 角色
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

/** pi 的 Usage → 估算（无 stream_options 时按字符数粗估） */
function estimateUsage(
  promptChars: number,
  outputChars: number,
  reasoningChars: number,
): Usage {
  const input = Math.ceil(promptChars / 4);
  const output = Math.ceil((outputChars + reasoningChars) / 4);
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: reasoningChars ? Math.ceil(reasoningChars / 4) : undefined,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** 把 pi 的 transcript 消息转成 OpenAI 兼容 messages（system 统一由 getCurrentSystemPrompt 生成） */
function toOpenAIMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    // system 消息统一在最前面合成一条（多段 system 合并会破坏 provider 兼容性）
    if (m.role === "system") continue;
    if (m.role === "user") {
      if (typeof m.content === "string") {
        out.push({ role: "user", content: m.content });
      } else {
        const parts = m.content.map((c) =>
          c.type === "text"
            ? { type: "text", text: c.text }
            : {
                type: "image_url",
                image_url: {
                  url: `data:${(c as ImageContent).mimeType};base64,${(c as ImageContent).data}`,
                },
              },
        );
        out.push({ role: "user", content: parts });
      }
      continue;
    }
    if (m.role === "assistant") {
      const texts: string[] = [];
      const toolCalls: unknown[] = [];
      for (const block of m.content) {
        if (block.type === "text") texts.push(block.text);
        else if (block.type === "toolCall") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.arguments ?? {}),
            },
          });
        }
      }
      const msg: Record<string, unknown> = {
        role: "assistant",
        content: texts.join(""),
      };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }
    if (m.role === "toolResult") {
      const text = m.content
        .map((c) => (c.type === "text" ? c.text : "[图片]"))
        .join("\n");
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: text || (m.isError ? "工具执行失败" : "（空结果）"),
      });
    }
  }
  return out;
}

/** OpenAI tools 声明（pi 的 Tool 已经是 JSON Schema） */
function toOpenAITools(tools: ReturnType<typeof getCurrentTools>): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** 安全解析工具参数（流式中可能是半截 JSON） */
function safeParseArgs(raw: string): {
  args: JsonObject;
  error?: string;
} {
  const text = (raw || "").trim();
  if (!text) return { args: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { args: parsed as JsonObject };
    }
    return { args: {}, error: `工具参数不是对象：${text.slice(0, 200)}` };
  } catch {
    return { args: {}, error: `工具参数 JSON 解析失败：${text.slice(0, 200)}` };
  }
}

/** 判断错误体是否为「不支持 tools」 */
export function looksLikeToolsUnsupported(status: number, body: string): boolean {
  if (![400, 404, 422, 501].includes(status)) return false;
  return /tool|function[_ ]?call|tools/i.test(body);
}

/**
 * 构造 pi 可用的 StreamFn。
 * 契约（pi-agent-core）：不抛错，所有失败编码为事件流中的 error 事件。
 */
export function createPiStreamFn(
  getCfg: () => PiLlmCfg,
  hooks: PiStreamHooks = {},
): PiStreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    void runStream(model, context, options, getCfg(), hooks, stream).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        const errorMessage = buildError(model, msg, "error");
        stream.push({ type: "error", reason: "error", error: errorMessage });
      },
    );
    return stream;
  };
}

function buildError(
  model: Model<Api>,
  message: string,
  reason: StopReason,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: reason,
    errorMessage: message,
    timestamp: Date.now(),
  };
}

async function runStream(
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
  cfg: PiLlmCfg,
  hooks: PiStreamHooks,
  stream: AssistantMessageEventStream,
): Promise<void> {
  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
  const emit = (event: AssistantMessageEvent) => stream.push(event);
  const finishError = (reason: Extract<StopReason, "error" | "aborted">, message: string) => {
    const error = buildError(model, message, reason);
    error.content = partial.content;
    error.usage = partial.usage;
    emit({ type: "error", reason, error });
    stream.end(error);
  };

  const systemPrompt = getCurrentSystemPrompt(context.messages);
  const tools = getCurrentTools(context.messages);
  const messages = toOpenAIMessages(context.messages);
  const payload: Record<string, unknown> = {
    model: model.id,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ],
    temperature: 0.7,
    stream: true,
    max_tokens: model.maxTokens,
  };
  if (tools.length) {
    payload.tools = toOpenAITools(tools);
    payload.tool_choice = options?.toolChoice ?? "auto";
    hooks.onToolsSent?.(tools.length);
  }

  let promptChars = systemPrompt.length;
  for (const m of messages) {
    const content = (m as { content?: unknown }).content;
    if (typeof content === "string") promptChars += content.length;
  }

  // 开始事件：pi 要求 start 先于任何 delta
  emit({ type: "start", partial });

  const controller = new AbortController();
  const external = options?.signal;
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${model.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      finishError("aborted", "已取消");
      return;
    }
    finishError("error", e instanceof Error ? e.message : "请求失败");
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (tools.length && looksLikeToolsUnsupported(res.status, body)) {
      hooks.onToolsUnsupported?.();
    }
    finishError(
      "error",
      `AI 请求失败 (${res.status})${body ? ": " + body.slice(0, 200) : ""}`,
    );
    return;
  }
  const reader = res.body?.getReader();
  if (!reader) {
    finishError("error", "不支持流式");
    return;
  }

  // 内容块状态
  let textIndex: number | null = null;
  let thinkingIndex: number | null = null;
  const toolStates = new Map<
    number,
    { contentIndex: number; id: string; name: string; raw: string }
  >();
  let finishReason = "";
  let outputChars = 0;
  let reasoningChars = 0;
  let providerUsage: Usage | null = null;

  const closeText = () => {
    if (textIndex == null) return;
    const block = partial.content[textIndex] as TextContent;
    emit({
      type: "text_end",
      contentIndex: textIndex,
      content: block.text,
      partial,
    });
    textIndex = null;
  };
  const closeThinking = () => {
    if (thinkingIndex == null) return;
    const block = partial.content[thinkingIndex] as ThinkingContent;
    emit({
      type: "thinking_end",
      contentIndex: thinkingIndex,
      content: block.thinking,
      partial,
    });
    thinkingIndex = null;
  };
  const closeTool = (key: number) => {
    const st = toolStates.get(key);
    if (!st) return;
    const parsed = safeParseArgs(st.raw);
    const block = partial.content[st.contentIndex] as ToolCall;
    const toolCall: ToolCall = {
      type: "toolCall",
      id: st.id || `call_${key}`,
      name: st.name,
      arguments: parsed.args,
      ...(parsed.error ? { argumentsError: parsed.error } : {}),
    };
    block.id = toolCall.id;
    block.name = toolCall.name;
    block.arguments = toolCall.arguments;
    if (parsed.error) block.argumentsError = parsed.error;
    emit({
      type: "toolcall_end",
      contentIndex: st.contentIndex,
      toolCall,
      partial,
    });
    toolStates.delete(key);
  };
  const closeAll = () => {
    closeText();
    closeThinking();
    for (const key of [...toolStates.keys()]) closeTool(key);
  };

  const handleDelta = (delta: Record<string, unknown>) => {
    const reasoning =
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? (delta.reasoning as string)
          : "";
    if (reasoning) {
      closeText();
      if (thinkingIndex == null) {
        partial.content.push({ type: "thinking", thinking: "" });
        thinkingIndex = partial.content.length - 1;
        emit({ type: "thinking_start", contentIndex: thinkingIndex, partial });
      }
      const block = partial.content[thinkingIndex] as ThinkingContent;
      block.thinking += reasoning;
      reasoningChars += reasoning.length;
      emit({
        type: "thinking_delta",
        contentIndex: thinkingIndex,
        delta: reasoning,
        partial,
      });
    }
    const content = typeof delta.content === "string" ? delta.content : "";
    if (content) {
      closeThinking();
      if (textIndex == null) {
        partial.content.push({ type: "text", text: "" });
        textIndex = partial.content.length - 1;
        emit({ type: "text_start", contentIndex: textIndex, partial });
      }
      const block = partial.content[textIndex] as TextContent;
      block.text += content;
      outputChars += content.length;
      emit({
        type: "text_delta",
        contentIndex: textIndex,
        delta: content,
        partial,
      });
    }
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const raw of calls) {
      const tc = raw as {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      };
      const key = typeof tc.index === "number" ? tc.index : toolStates.size;
      let st = toolStates.get(key);
      if (!st) {
        closeText();
        closeThinking();
        partial.content.push({
          type: "toolCall",
          id: tc.id || `call_${key}`,
          name: tc.function?.name || "",
          arguments: {},
        });
        st = {
          contentIndex: partial.content.length - 1,
          id: tc.id || `call_${key}`,
          name: tc.function?.name || "",
          raw: "",
        };
        toolStates.set(key, st);
        emit({ type: "toolcall_start", contentIndex: st.contentIndex, partial });
      }
      if (tc.id && tc.id !== st.id) st.id = tc.id;
      if (tc.function?.name) st.name = tc.function.name;
      const argDelta = tc.function?.arguments ?? "";
      if (argDelta) {
        st.raw += argDelta;
        const block = partial.content[st.contentIndex] as ToolCall;
        block.name = st.name;
        block.arguments = safeParseArgs(st.raw).args;
        emit({
          type: "toolcall_delta",
          contentIndex: st.contentIndex,
          delta: argDelta,
          partial,
        });
      }
    }
  };

  const dec = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let json: {
          choices?: {
            delta?: Record<string, unknown>;
            finish_reason?: string | null;
          }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const choice = json.choices?.[0];
        if (choice?.delta) handleDelta(choice.delta);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (json.usage) {
          const input = json.usage.prompt_tokens ?? 0;
          const output = json.usage.completion_tokens ?? 0;
          providerUsage = {
            input,
            output,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: json.usage.total_tokens ?? input + output,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
        }
      }
    }
  } catch (e: unknown) {
    closeAll();
    if (controller.signal.aborted) {
      finishError("aborted", "已取消");
      return;
    }
    finishError("error", e instanceof Error ? e.message : "流读取失败");
    return;
  } finally {
    external?.removeEventListener("abort", onAbort);
  }

  // 处理尾部残留（少数服务端末行无换行）
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data && data !== "[DONE]") {
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: Record<string, unknown>; finish_reason?: string | null }[];
        };
        const choice = json.choices?.[0];
        if (choice?.delta) handleDelta(choice.delta);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch {
        /* 半截 JSON：忽略 */
      }
    }
  }

  if (controller.signal.aborted) {
    closeAll();
    finishError("aborted", "已取消");
    return;
  }

  closeAll();
  const hasToolCalls = partial.content.some((b) => b.type === "toolCall");
  const reason: Extract<StopReason, "stop" | "length" | "toolUse"> = hasToolCalls
    ? "toolUse"
    : finishReason === "length"
      ? "length"
      : "stop";
  partial.usage = providerUsage ?? estimateUsage(promptChars, outputChars, reasoningChars);
  partial.stopReason = reason;
  partial.rawStopReason = finishReason || undefined;
  emit({ type: "done", reason, message: partial });
  stream.end(partial);
}
