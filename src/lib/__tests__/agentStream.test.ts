import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeContext } from "@earendil-works/pi-ai";
import type { AssistantMessage, AssistantMessageEvent, Tool } from "@earendil-works/pi-ai";
import { createPiStreamFn, looksLikeToolsUnsupported, toPiModel } from "../agent/piLlm";

const cfg = {
  endpoint: "https://api.example.com/v1/",
  apiKey: "sk-test",
  model: "deepseek-v4-flash",
};

const artifactTool: Tool = {
  name: "write_artifact",
  description: "写入产物",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
    },
    required: ["title", "content"],
    additionalProperties: false,
  },
};

function ctxWithTool() {
  return normalizeContext({
    systemPrompt: "你是助手",
    messages: [{ role: "user", content: "写入一个产物", timestamp: Date.now() }],
    tools: [artifactTool],
  });
}

function sseResponse(chunks: string[]): Response {
  const body =
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
  const events: AssistantMessageEvent[] = [];
  for await (const ev of stream) events.push(ev);
  return events;
}

describe("piLlm streamFn（OpenAI 兼容 → pi 事件流）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("解析正文增量并给出 done/stop", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        '{"choices":[{"delta":{"content":"你"}}]}',
        '{"choices":[{"delta":{"content":"好"}}]}',
        '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stream = createPiStreamFn(() => cfg)(toPiModel(cfg), normalizeContext({
      messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
    }));
    const events = await collect(stream);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types).toContain("text_delta");
    expect(types[types.length - 1]).toBe("done");

    const message = await stream.result();
    expect(message.stopReason).toBe("stop");
    const text = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    expect(text).toBe("你好");
    expect(message.usage.totalTokens).toBeGreaterThan(0);
  });

  it("聚合分片 tool_calls 并给出 toolUse", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        '{"choices":[{"delta":{"content":"好的"}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write_artifact","arguments":"{\\"title\\":"}}]}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"周报\\",\\"content\\":\\"正文\\"}"}}]}}]}',
        '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stream = createPiStreamFn(() => cfg)(
      toPiModel(cfg),
      ctxWithTool(),
    );
    const events = await collect(stream);
    const types = events.map((e) => e.type);
    expect(types).toContain("toolcall_start");
    expect(types).toContain("toolcall_delta");
    expect(types).toContain("toolcall_end");
    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.reason).toBe("toolUse");

    const message = (await stream.result()) as AssistantMessage;
    const call = message.content.find((b) => b.type === "toolCall");
    expect(call).toBeTruthy();
    if (call && call.type === "toolCall") {
      expect(call.name).toBe("write_artifact");
      expect(call.arguments).toEqual({ title: "周报", content: "正文" });
    }

    // 请求体应携带 tools 声明与 tool_choice
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    ) as { tools?: { function: { name: string } }[]; tool_choice?: string };
    expect(body.tools?.[0].function.name).toBe("write_artifact");
    expect(body.tool_choice).toBe("auto");
  });

  it("服务端不支持 tools 时触发回调并给出 error 事件", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { message: "tools are not supported" } }),
          { status: 400 },
        ),
      ),
    );
    const onToolsUnsupported = vi.fn();
    const stream = createPiStreamFn(() => cfg, { onToolsUnsupported })(
      toPiModel(cfg),
      ctxWithTool(),
    );
    const events = await collect(stream);
    expect(onToolsUnsupported).toHaveBeenCalledTimes(1);
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    const message = await stream.result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("400");
  });

  it("looksLikeToolsUnsupported 只在工具相关报错时命中", () => {
    expect(looksLikeToolsUnsupported(400, "tools not supported")).toBe(true);
    expect(looksLikeToolsUnsupported(422, "invalid function calling")).toBe(true);
    expect(looksLikeToolsUnsupported(400, "invalid api key")).toBe(false);
    expect(looksLikeToolsUnsupported(500, "tools not supported")).toBe(false);
  });
});
