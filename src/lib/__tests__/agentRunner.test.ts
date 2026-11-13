/**
 * runAgentTurn 端到端：模型发起原生工具调用 → 工具执行（写入产物）→ 二次往返给出正文。
 * 这一层验证 pi-agent-core 的 Agent 循环与自写 streamFn 的接线（不依赖真实网络）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runAgentTurn } from "../agent/piRunner";
import { listArtifacts } from "../artifacts";
import type { AIChatConfig } from "../types";

const cfg: AIChatConfig = {
  endpoint: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "deepseek-v4-flash",
  botName: "测试",
  systemPrompt: "你是助手",
};

function sse(chunks: string[]): Response {
  const body =
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("runAgentTurn 工具循环", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("工具调用 → 写入产物 → 二次往返返回正文", async () => {
    const fetchMock = vi
      .fn()
      // 第一轮：模型要求写产物
      .mockResolvedValueOnce(
        sse([
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write_artifact","arguments":"{\\"kind\\":\\"note\\",\\"title\\":\\"周报\\","}}]}}]}',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"content\\":\\"# 周报\\\\n本周完成 A、B\\"}"}}]}}]}',
          '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        ]),
      )
      // 第二轮：模型基于工具结果给出正文
      .mockResolvedValueOnce(
        sse([
          '{"choices":[{"delta":{"content":"已经"}}]}',
          '{"choices":[{"delta":{"content":"写好了。"}}]}',
          '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const onArtifact = vi.fn();
    const tokens: string[] = [];

    const res = await runAgentTurn({
      cfg,
      systemPrompt: "你是助手",
      history: [],
      userText: "帮我写一份周报",
      signal: new AbortController().signal,
      toolContext: {
        pageId: 9,
        sessionId: "s-run",
        mode: "auto",
        webEnabled: true,
      },
      onToken: (text) => tokens.push(text),
      onToolStart,
      onToolEnd,
      onArtifact,
    });

    // 两次模型往返
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 工具事件
    expect(onToolStart).toHaveBeenCalledTimes(1);
    expect(onToolStart.mock.calls[0][0].toolName).toBe("write_artifact");
    expect(onToolEnd).toHaveBeenCalledTimes(1);
    expect(onToolEnd.mock.calls[0][0].isError).toBe(false);
    // 产物落库 + 回调
    expect(onArtifact).toHaveBeenCalledTimes(1);
    const artifacts = listArtifacts(9, "s-run");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("周报");
    expect(artifacts[0].content).toContain("本周完成");
    // 最终正文与结果
    expect(res.content).toContain("已经写好了");
    expect(res.toolsUnsupported).toBe(false);
    expect(res.aborted).toBe(false);
    expect(res.turns).toBeGreaterThanOrEqual(2);
    expect(res.toolCalls).toBe(1);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("模型不支持 tools 时回传 toolsUnsupported 供调用方回退", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "tools are not supported" }), {
            status: 400,
          }),
      ),
    );

    const res = await runAgentTurn({
      cfg,
      systemPrompt: "你是助手",
      history: [],
      userText: "你好",
      signal: new AbortController().signal,
      toolContext: {
        pageId: 9,
        sessionId: "s-run",
        mode: "auto",
        webEnabled: true,
      },
    });

    expect(res.toolsUnsupported).toBe(true);
    expect(res.content).toBe("");
    expect(listArtifacts(9, "s-run")).toHaveLength(0);
  });

  it("启动前已 abort 时直接返回 aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const res = await runAgentTurn({
      cfg,
      systemPrompt: "你是助手",
      history: [],
      userText: "你好",
      signal: controller.signal,
      toolContext: {
        pageId: 9,
        sessionId: "s-run",
        mode: "auto",
        webEnabled: true,
      },
    });

    expect(res.aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
