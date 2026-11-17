import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { completeText } from "../complete";
import type { AIChatConfig } from "../types";

const cfg: AIChatConfig = {
  endpoint: "https://example.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
} as AIChatConfig;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("completeText（学习页/摘要补全）", () => {
  it("解析普通 JSON 响应，且地址自动补 /chat/completions", async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "课件正文" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const text = await completeText(cfg, "sys", "user");
    expect(text).toBe("课件正文");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.com/v1/chat/completions",
    );
  });

  it("已带 /chat/completions 的地址不重复拼接", async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await completeText(
      { ...cfg, endpoint: "https://example.com/v1/chat/completions" },
      "s",
      "u",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.com/v1/chat/completions",
    );
  });

  it("兼容代理返回 SSE 的情况", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"B"}}]}\n\n' +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(sse, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
    await expect(completeText(cfg, "s", "u")).resolves.toBe("AB");
  });

  it("空内容与 HTTP 错误给出可行动信息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: "" } }] }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );
    await expect(completeText(cfg, "s", "u")).rejects.toThrow("空内容");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid key", { status: 401 })),
    );
    await expect(completeText(cfg, "s", "u")).rejects.toThrow("401");
  });

  it("未配置地址直接提示", async () => {
    await expect(
      completeText({ ...cfg, endpoint: "" }, "s", "u"),
    ).rejects.toThrow("未配置模型接口地址");
  });
});
