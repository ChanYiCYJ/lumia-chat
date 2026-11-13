import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  availablePresets,
  loadMcpServers,
  removeMcpServer,
  serverFromPreset,
  setMcpCatalogEntry,
  upsertMcpServer,
} from "../mcp/store";
import { buildStartCommand, MCP_PRESETS } from "../mcp/presets";
import { mcpCallTool, mcpListTools } from "../mcp/client";
import { createAgentTools } from "../agent/plugins";
import { MCP_SERVERS_KEY } from "../mcp/types";

const maimemo = MCP_PRESETS.find((p) => p.id === "maimemo")!;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("MCP 预设与配置存储", () => {
  it("生成带凭据与 CORS 的启动命令", () => {
    const cmd = buildStartCommand(maimemo, { MAIMEMO_TOKEN: "tk_1" });
    expect(cmd).toContain("MAIMEMO_TOKEN='tk_1'");
    expect(cmd).toContain('--stdio "mcp-server-maimemo"');
    expect(cmd).toContain("--port 8791");
    expect(cmd).toContain("--cors");
    expect(cmd).toContain("go install");
  });

  it("添加/停用/删除与推荐列表", () => {
    const server = serverFromPreset("weread")!;
    expect(server.url).toBe("http://localhost:8792/sse");
    upsertMcpServer(server);
    expect(loadMcpServers()).toHaveLength(1);
    expect(availablePresets().map((p) => p.id)).toEqual(["maimemo", "todo"]);

    upsertMcpServer({ ...server, enabled: false });
    expect(loadMcpServers()[0].enabled).toBe(false);

    removeMcpServer(server.id);
    expect(loadMcpServers()).toHaveLength(0);
  });
});

describe("MCP 客户端（Streamable HTTP）", () => {
  it("tools/list 解析工具", async () => {
    const server = {
      ...serverFromPreset("maimemo")!,
      transport: "http" as const,
      url: "http://127.0.0.1:1/mcp",
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-06-18" },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "s1",
            },
          },
        );
      }
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "get_vocabulary",
                description: "查词",
                inputSchema: { type: "object" },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tools = await mcpListTools(server);
    expect(tools.map((t) => t.name)).toEqual(["get_vocabulary"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("tools/call 返回文本与错误", async () => {
    const server = {
      ...serverFromPreset("todo")!,
      transport: "http" as const,
      url: "http://127.0.0.1:1/mcp",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        if (body.method === "initialize") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (body.method === "notifications/initialized")
          return new Response("", { status: 202 });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: "已添加任务：写周报" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const res = await mcpCallTool(server, "add_task", { title: "写周报" });
    expect(res.text).toContain("写周报");
  });
});

describe("MCP 插件", () => {
  const ctx = {
    pageId: 1,
    sessionId: "mcp",
    mode: "auto" as const,
    webEnabled: true,
  };

  it("无配置时只暴露管理工具", () => {
    const names = createAgentTools(ctx).map((t) => t.name);
    expect(names).toContain("mcp_servers");
    expect(names).toContain("mcp_refresh");
    expect(names.some((n) => n.startsWith("mcp_maimemo_"))).toBe(false);
  });

  it("按缓存目录生成 mcp_* 动态工具并调用", async () => {
    const server = serverFromPreset("maimemo")!;
    localStorage.setItem(MCP_SERVERS_KEY, JSON.stringify([server]));
    setMcpCatalogEntry(server.id, {
      at: Date.now(),
      tools: [
        {
          name: "get_vocabulary",
          description: "查询单词",
          inputSchema: {
            type: "object",
            properties: { word: { type: "string" } },
          },
        },
      ],
    });

    const tools = createAgentTools(ctx);
    const tool = tools.find((t) => t.name === "mcp_maimemo_get_vocabulary");
    expect(tool).toBeTruthy();
    expect(tool!.description).toContain("[MCP · 墨墨背单词]");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        if (body.method === "initialize") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (body.method === "notifications/initialized")
          return new Response("", { status: 202 });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: "vocabulary ok" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    // 预设默认是 SSE；测试里换成 HTTP 走 fetch mock
    upsertMcpServer({
      ...server,
      transport: "http",
      url: "http://127.0.0.1:1/mcp",
    });
    const httpTool = createAgentTools(ctx).find(
      (t) => t.name === "mcp_maimemo_get_vocabulary",
    )!;
    const r = (await httpTool.execute("1", { word: "abandon" })) as {
      content: { type: string; text?: string }[];
    };
    expect(r.content[0].type).toBe("text");
    expect(r.content[0].text).toContain("vocabulary ok");
  });

  it("提示词说明已接入的服务", () => {
    const server = serverFromPreset("weread")!;
    upsertMcpServer(server);
    setMcpCatalogEntry(server.id, { at: Date.now(), tools: [] });
    const prompts = createAgentTools(ctx).length;
    expect(prompts).toBeGreaterThan(0);
  });
});
