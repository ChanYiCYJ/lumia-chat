/**
 * MCP 插件：把设置页配置的外部 MCP 服务工具动态挂到 Agent 上
 * ------------------------------------------------------------------
 * 工具命名 mcp_<server>_<tool>；目录来自上次「测试连接」的缓存，
 * 未连接时只暴露 mcp_servers / mcp_refresh 两个管理工具。
 * 内置预设（墨墨背单词 / 微信读书 / Microsoft To Do）见 lib/mcp/presets.ts。
 */
import type { AgentPlugin } from "./types";
import { ok, fail } from "./shared";
import {
  enabledMcpServers,
  loadMcpCatalog,
  loadMcpServers,
  setMcpCatalogEntry,
} from "../../mcp/store";
import { mcpCallTool, mcpListTools } from "../../mcp/client";
import type { McpServerConfig, McpToolDef } from "../../mcp/types";

const MAX_TOOL_TEXT = 8000;

function slug(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

function serverKey(s: McpServerConfig): string {
  return slug(s.preset || s.name) || "srv";
}

function normalizeSchema(
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const next: Record<string, unknown> = { ...schema };
  delete next.$schema;
  if (next.type !== "object") next.type = "object";
  const props = next.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    next.properties = {};
  }
  return next;
}

function toolDescription(server: McpServerConfig, tool: McpToolDef): string {
  const desc = (tool.description || tool.name)
    .replace(/\s+/g, " ")
    .slice(0, 300);
  return `[MCP · ${server.name}] ${desc}`;
}

/** 生成动态工具：名字去重、参数 schema 兜底 */
function buildMcpTools(): ReturnType<AgentPlugin["tools"]> {
  const out: ReturnType<AgentPlugin["tools"]> = [];
  const used = new Set<string>();
  for (const server of enabledMcpServers()) {
    const state = loadMcpCatalog()[server.id];
    for (const tool of state?.tools || []) {
      let name = `mcp_${serverKey(server)}_${slug(tool.name) || "tool"}`;
      let n = 2;
      while (used.has(name)) name = `${name.slice(0, 56)}_${n++}`;
      used.add(name);
      out.push({
        name,
        label: `${server.name} · ${tool.name}`,
        description: toolDescription(server, tool),
        parameters: normalizeSchema(tool.inputSchema),
        execute: async (_id, raw) => {
          try {
            const args =
              raw && typeof raw === "object" && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : {};
            const res = await mcpCallTool(server, tool.name, args);
            const text = res.text || "（空结果）";
            return ok(
              text.length > MAX_TOOL_TEXT
                ? text.slice(0, MAX_TOOL_TEXT) + "\n…（已截断）"
                : text,
            );
          } catch (e) {
            fail(e instanceof Error ? e.message : "MCP 调用失败");
          }
        },
      });
    }
  }
  return out;
}

function summaryLine(s: McpServerConfig, tools: number): string {
  return `- ${s.name}：${tools > 0 ? `${tools} 个工具` : "未连接/未发现工具"}（${s.transport.toUpperCase()} ${s.url || "未填地址"}）`;
}

const plugin: AgentPlugin = {
  id: "mcp",
  name: "MCP 扩展",
  priority: 30,

  ui: {
    mcp_servers: { type: "MCP" },
    mcp_refresh: { type: "MCP" },
  },
  resolveUi: (name) => (name.startsWith("mcp_") ? { type: "MCP" } : undefined),

  promptLines: () => {
    const servers = enabledMcpServers();
    if (!servers.length) {
      return `- 【MCP】尚未接入外部服务；用户要求「背单词/墨墨」「微信读书/书摘/书评」「Microsoft To Do/微软待办」时，先提示到「设置 → MCP 服务」添加对应预设（内置一键启动命令），不要编造数据。
`;
    }
    const catalog = loadMcpCatalog();
    const lines = servers.map((s) =>
      summaryLine(s, catalog[s.id]?.tools.length || 0),
    );
    return `- 【MCP】已接入外部服务：
${lines.join("\n")}
- 用户提到背单词/墨墨、微信读书/书摘/书评、微软待办/任务时，优先调用对应的 mcp_* 工具，不要凭记忆编造书单、词本或任务。
- mcp_* 工具失败时先调用 mcp_refresh 刷新目录再重试一次；仍失败就告诉用户在「设置 → MCP 服务」检查桥接是否启动。
`;
  },

  tools: () => [
    ...buildMcpTools(),
    {
      name: "mcp_servers",
      label: "查看 MCP 服务",
      description:
        "列出已配置的 MCP 服务、连接状态与可用工具数量。用户问「接了哪些 MCP / 有没有连接」时使用。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const servers = loadMcpServers();
        if (!servers.length) {
          return ok(
            "还没有配置 MCP 服务。可在「设置 → MCP 服务」添加内置预设（墨墨背单词 / 微信读书 / Microsoft To Do）或自定义服务。",
          );
        }
        const catalog = loadMcpCatalog();
        const text = servers
          .map((s) => {
            const tools = catalog[s.id]?.tools || [];
            return `${s.enabled ? "●" : "○"} ${s.name} · ${tools.length} 工具${
              s.enabled ? "" : "（已停用）"
            }\n  ${tools.length ? tools.map((t) => t.name).join(", ") : "（未拉取目录，可在设置页测试连接）"}`;
          })
          .join("\n");
        return ok(text);
      },
    },
    {
      name: "mcp_refresh",
      label: "刷新 MCP 工具",
      description:
        "重新连接所有已启用的 MCP 服务并刷新工具目录。工具调用失败或新装工具后使用。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const servers = enabledMcpServers();
        if (!servers.length) fail("没有已启用的 MCP 服务");
        const parts: string[] = [];
        for (const server of servers) {
          try {
            const tools = await mcpListTools(server);
            setMcpCatalogEntry(server.id, { tools, at: Date.now() });
            parts.push(`✓ ${server.name}：${tools.length} 个工具`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "连接失败";
            setMcpCatalogEntry(server.id, {
              tools: [],
              at: Date.now(),
              error: msg,
            });
            parts.push(`✗ ${server.name}：${msg}`);
          }
        }
        return ok(parts.join("\n"));
      },
    },
  ],
};

export default plugin;
