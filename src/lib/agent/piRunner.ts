/**
 * pi-agent-core 运行器：一次用户提问 = 一个 Agent 运行（可多轮工具循环）。
 *
 * 职责边界：
 * - 只负责「组装 Agent + 订阅事件 + 中断/轮次预算」，不碰 React state
 * - 把 pi 的事件翻译成 AIChat 需要的回调（token 流 / 工具卡 / 产物）
 * - 出错不抛给 UI：错误以 errorMessage 形式带回，交由调用方决定是否回退旧通道
 */
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AIChatConfig } from "../types";
import type { Artifact } from "../artifacts";
import {
  createPiStreamFn,
  looksLikeToolsUnsupported,
  toPiModel,
} from "./piLlm";
import { createAgentTools, guardTool } from "./piTools";
import type { ToolContext } from "./piTools";
import { fitMessages } from "../contextMode";

/**
 * 工具/轮次预算：按模式放宽。
 * 旧值（6 轮 / 12 次工具）在「搜索 → 读页 → 再搜 → 写产物」的真研究链路里
 * 很容易中途被截断，表现为「查一半自己停了」。
 */
const BUDGET = {
  fast: { turns: 5, calls: 8 },
  auto: { turns: 10, calls: 20 },
  deep: { turns: 16, calls: 36 },
} as const;

/** 累计 token 用量（含服务端 prompt cache 命中量） */
export interface TokenUsage {
  input: number;
  output: number;
  /** 服务端 prompt cache 命中（DeepSeek/Anthropic 等会返回） */
  cacheRead: number;
  totalTokens: number;
}

export interface AgentHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolStartInfo {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolEndInfo {
  toolCallId: string;
  toolName: string;
  isError: boolean;
  durationMs?: number;
  result?: unknown;
}

export interface RunAgentOptions {
  cfg: AIChatConfig;
  /** 组装好的 system 提示词（assembleSystem 输出） */
  systemPrompt: string;
  history: AgentHistoryMessage[];
  userText: string;
  toolContext: Omit<ToolContext, "onArtifact" | "msgIdx">;
  signal: AbortSignal;
  maxTurns?: number;
  /** 工具调用上限（默认按模式：fast 8 / auto 20 / deep 36） */
  maxToolCalls?: number;
  /** context-mode 字符预算（默认 60k ≈ 30k tokens） */
  contextMaxChars?: number;
  /** 流式正文（每轮 assistant 消息的当前完整文本） */
  onToken?: (text: string) => void;
  onToolStart?: (info: ToolStartInfo) => void;
  onToolEnd?: (info: ToolEndInfo) => void;
  onArtifact?: (artifact: Artifact) => void;
  /** 每轮更新累计 token 用量（powerline 状态栏 / 缓存命中展示） */
  onUsage?: (usage: TokenUsage) => void;
}

export interface RunAgentResult {
  /** 最终 assistant 正文（最后一轮） */
  content: string;
  /** 服务端明确不支持 tools（调用方应回退旧的 [TAG:] 通道） */
  toolsUnsupported: boolean;
  errorMessage?: string;
  aborted: boolean;
  turns: number;
  toolCalls: number;
  usage: TokenUsage;
}

function extractText(message: AssistantMessage): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

function toAgentMessages(history: AgentHistoryMessage[]): AgentMessage[] {
  return history
    .filter((m) => !!m.content?.trim())
    .map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: Date.now(),
    })) as AgentMessage[];
}

/** 写操作类工具：只读权限下统一拦截 */
const WRITE_TOOLS = new Set([
  "kb_save",
  "kb_delete",
  "write_artifact",
  "delete_artifact",
  "todo_add",
  "todo_done",
  "todo_remove",
  "todo_clear",
  "anki_add",
  "anki_grade",
  "anki_reset",
  "plugin_forge_create",
  "plugin_forge_delete",
]);

/** 运行一次 Agent（含工具循环）。永不抛错。 */
export async function runAgentTurn(
  opts: RunAgentOptions,
): Promise<RunAgentResult> {
  const {
    cfg,
    systemPrompt,
    history,
    userText,
    toolContext,
    signal,
    maxTurns,
    maxToolCalls,
    contextMaxChars = 60_000,
    onToken,
    onToolStart,
    onToolEnd,
    onArtifact,
    onUsage,
  } = opts;

  const budget = BUDGET[toolContext.mode] || BUDGET.auto;
  const turnLimit = maxTurns ?? budget.turns;
  const callLimit = maxToolCalls ?? budget.calls;
  /** 已触发「收尾」：下一轮不再提供工具，强制模型用文字总结 */
  let finalizing = false;
  const usage: TokenUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    totalTokens: 0,
  };

  let toolsUnsupported = false;
  /** 每次构建都读最新注册表：AI 自建插件（forge）创建后可立即生效 */
  const buildTools = () =>
    createAgentTools({
      ...toolContext,
      onArtifact: (artifact) => onArtifact?.(artifact),
    });
  const tools = buildTools();
  const streamFn = createPiStreamFn(
    () => ({ endpoint: cfg.endpoint, apiKey: cfg.apiKey, model: cfg.model }),
    {
      onToolsUnsupported: () => {
        toolsUnsupported = true;
      },
    },
  );

  let turnCount = 0;
  let toolCallCount = 0;
  let content = "";
  let errorMessage: string | undefined;

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: toPiModel(cfg),
      messages: toAgentMessages(history),
      tools,
    },
    streamFn,
    sessionId: toolContext.sessionId,
    toolExecution: "sequential",
    identity: { attribution: null },
    /** context-mode：每次请求前按字符预算裁剪 transcript（保留 tool 结果与最近消息） */
    transformContext: async (messages) =>
      fitMessages(messages, contextMaxChars),
    /**
     * 预算将尽时强制收尾：注入一条 system 提醒，并在下一轮取消工具。
     * 这是「查一半就停」的关键修复——之前是达到上限后直接中止，模型没机会总结。
     */
    prepareNextTurn: () => {
      if (finalizing) return undefined;
      const nearTurns = turnCount >= Math.max(2, turnLimit - 2);
      const nearCalls = toolCallCount >= Math.max(4, callLimit - 4);
      if (!nearTurns && !nearCalls) return undefined;
      finalizing = true;
      return {
        messages: [
          {
            role: "system",
            content: `【收尾】工具预算即将用尽（已用 ${turnCount} 轮 / ${toolCallCount} 次工具调用）。请立刻基于已获得的信息给出完整最终回答，不要再调用工具；若信息不足，请明确说明还缺什么，并给出已确认的结论。`,
            timestamp: Date.now(),
          } as AgentMessage,
        ],
      };
    },
    /**
     * 每次发给模型前对比工具集：数量或名字变了就换新数组。
     * 典型场景：本轮调用 plugin_forge_create 后，下一轮模型就能直接调用新工具；
     * 收尾阶段则清空工具，避免模型继续调工具而不总结。
     */
    prepareRequest: (request) => {
      const prev = request.context.tools || [];
      const next = finalizing ? [] : buildTools();
      const prevNames = prev
        .map((t) => t.name)
        .sort()
        .join("|");
      const nextNames = next
        .map((t) => t.name)
        .sort()
        .join("|");
      if (prevNames === nextNames) return undefined;
      return { context: { ...request.context, tools: next } };
    },
    beforeToolCall: async ({ toolCall }) => {
      toolCallCount += 1;
      if (toolCallCount > callLimit) {
        // 不 terminate：让本轮回传错误给模型，下一轮由 prepareNextTurn 强制收尾
        return {
          block: true,
          reason: `本轮工具调用已达上限（${callLimit} 次），请立即基于已有信息回答，不要再调用工具。`,
        };
      }
      // 统一守卫：联网开关 / Fast 模式 / 插件自定义可用性（如 Notion 未配置）
      if (toolContext.permission === "read" && WRITE_TOOLS.has(toolCall.name)) {
        return {
          block: true,
          reason:
            "当前为只读权限：写操作已被禁用。请告知用户用「/ → 权限」切到标准或自动。",
        };
      }
      const blocked = guardTool(toolCall.name, toolContext);
      if (blocked) return { block: true, reason: blocked };
      return undefined;
    },
    finishTurn: () => {
      turnCount += 1;
      if (turnCount >= turnLimit) return { action: "end" };
      return undefined;
    },
  });

  const onAbort = () => agent.abort();
  if (signal.aborted) {
    return {
      content: "",
      toolsUnsupported: false,
      aborted: true,
      turns: 0,
      toolCalls: 0,
      usage,
    };
  }
  signal.addEventListener("abort", onAbort, { once: true });

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case "message_update": {
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta") {
          content = extractText(ev.partial);
          onToken?.(content);
        }
        break;
      }
      case "message_end": {
        if (event.message.role === "assistant") {
          const msg = event.message as AssistantMessage;
          const text = extractText(msg);
          if (text) {
            content = text;
            onToken?.(content);
          }
          if (msg.stopReason === "error" && msg.errorMessage) {
            errorMessage = msg.errorMessage;
          }
          // pi-ai 已把各家的 usage 归一化（含 cacheRead = 服务端 prompt cache 命中）
          const u = msg.usage;
          if (u) {
            usage.input += u.input || 0;
            usage.output += u.output || 0;
            usage.cacheRead += u.cacheRead || 0;
            usage.totalTokens += u.totalTokens || 0;
            onUsage?.({ ...usage });
          }
        }
        break;
      }
      case "tool_execution_start":
        onToolStart?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_end":
        onToolEnd?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          durationMs: event.durationMs,
          result: event.result,
        });
        break;
      default:
        break;
    }
  });

  try {
    await agent.prompt(userText);
    await agent.waitForIdle();
  } catch (e: unknown) {
    errorMessage = e instanceof Error ? e.message : String(e);
  } finally {
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
  }

  // 最终正文：取最后一条「有文本」的 assistant（工具轮可能只有 tool_calls、没有正文）
  const finalMessages = agent.state.messages;
  for (let i = finalMessages.length - 1; i >= 0; i -= 1) {
    const m = finalMessages[i];
    if (m.role !== "assistant") continue;
    const text = extractText(m as AssistantMessage).trim();
    if (text) {
      content = text;
      break;
    }
  }
  // 兜底：执行过工具但没有正文（被预算截断/空回复）→ 明确告知，而不是静默停止
  if (
    !content.trim() &&
    toolCallCount > 0 &&
    !errorMessage &&
    !signal.aborted
  ) {
    content =
      "工具已经执行完，但模型这次没有生成总结。回复「继续」，我就基于刚才的结果接着说。";
  }
  if (!errorMessage && agent.state.errorMessage) {
    errorMessage = agent.state.errorMessage;
  }

  return {
    content,
    toolsUnsupported:
      toolsUnsupported ||
      (!!errorMessage && looksLikeToolsUnsupported(400, errorMessage)),
    errorMessage,
    aborted: signal.aborted,
    turns: turnCount,
    toolCalls: toolCallCount,
    usage,
  };
}
