/**
 * MCP 配置存储：服务器列表 + 工具目录缓存
 * ------------------------------------------------------------------
 * 纯 localStorage，密钥只留在本机；工具目录缓存让插件能同步声明工具，
 * 避免每次对话都重新握手。
 */
import type { McpServerConfig, McpServerState } from "./types";
import { MCP_CATALOG_KEY, MCP_SERVERS_KEY, mcpId } from "./types";
import { MCP_PRESETS, mcpPreset, presetDefaultUrl } from "./presets";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略配额 */
  }
}

export function loadMcpServers(): McpServerConfig[] {
  const list = readJSON<McpServerConfig[]>(MCP_SERVERS_KEY, []);
  return Array.isArray(list) ? list.filter((s) => s && s.id && s.url) : [];
}

export function saveMcpServers(list: McpServerConfig[]): void {
  writeJSON(MCP_SERVERS_KEY, list);
}

export function enabledMcpServers(): McpServerConfig[] {
  return loadMcpServers().filter((s) => s.enabled);
}

export function upsertMcpServer(server: McpServerConfig): McpServerConfig[] {
  const list = loadMcpServers();
  const i = list.findIndex((s) => s.id === server.id);
  if (i >= 0) list[i] = server;
  else list.push(server);
  saveMcpServers(list);
  return list;
}

export function removeMcpServer(id: string): McpServerConfig[] {
  const list = loadMcpServers().filter((s) => s.id !== id);
  saveMcpServers(list);
  const catalog = loadMcpCatalog();
  delete catalog[id];
  saveMcpCatalog(catalog);
  return list;
}

/** 从预设新建一个服务器配置 */
export function serverFromPreset(presetId: string): McpServerConfig | null {
  const preset = mcpPreset(presetId);
  if (!preset) return null;
  return {
    id: mcpId("mcp_"),
    name: preset.name,
    transport: "sse",
    url: presetDefaultUrl(preset),
    headers: {},
    enabled: true,
    preset: preset.id,
    env: {},
    createdAt: Date.now(),
  };
}

/** 自定义 MCP 服务 */
export function newCustomServer(name = "自定义 MCP"): McpServerConfig {
  return {
    id: mcpId("mcp_"),
    name,
    transport: "http",
    url: "",
    headers: {},
    enabled: true,
    env: {},
    createdAt: Date.now(),
  };
}

export function loadMcpCatalog(): Record<string, McpServerState> {
  return readJSON<Record<string, McpServerState>>(MCP_CATALOG_KEY, {});
}

export function saveMcpCatalog(catalog: Record<string, McpServerState>): void {
  writeJSON(MCP_CATALOG_KEY, catalog);
}

export function setMcpCatalogEntry(
  serverId: string,
  state: McpServerState,
): Record<string, McpServerState> {
  const catalog = loadMcpCatalog();
  catalog[serverId] = state;
  saveMcpCatalog(catalog);
  return catalog;
}

export function clearMcpCatalogEntry(
  serverId: string,
): Record<string, McpServerState> {
  const catalog = loadMcpCatalog();
  delete catalog[serverId];
  saveMcpCatalog(catalog);
  return catalog;
}

/** 已添加的预设 id（设置页用于隐藏「可添加」推荐） */
export function addedPresetIds(list = loadMcpServers()): Set<string> {
  return new Set(list.map((s) => s.preset).filter(Boolean) as string[]);
}

/** 未添加的内置预设 */
export function availablePresets(list = loadMcpServers()) {
  const used = addedPresetIds(list);
  return MCP_PRESETS.filter((p) => !used.has(p.id));
}
