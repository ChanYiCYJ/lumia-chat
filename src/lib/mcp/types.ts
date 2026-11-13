/**
 * MCP（Model Context Protocol）接入层
 * ------------------------------------------------------------------
 * 浏览器只能走 HTTP/SSE，因此本地 stdio 型 MCP 服务需要先用 supergateway
 * 转成 SSE/Streamable HTTP（配置页会生成启动命令）。
 */
export type McpTransport = "http" | "sse";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  /** SSE: http://host/sse；Streamable HTTP: http://host/mcp */
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
  /** 内置预设 id（maimemo / weread / todo），自定义服务为空 */
  preset?: string;
  /** 仅用于生成「本地启动命令」的环境变量，不会发到服务端 */
  env?: Record<string, string>;
  createdAt: number;
}

/** MCP tools/list 返回的工具定义 */
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerState {
  tools: McpToolDef[];
  /** 最近一次拉取时间 */
  at: number;
  error?: string;
}

export const MCP_SERVERS_KEY = "kimo_mcp_servers_v1";
export const MCP_CATALOG_KEY = "kimo_mcp_catalog_v1";

export function mcpId(prefix = "mcp"): string {
  return `${prefix}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
}
