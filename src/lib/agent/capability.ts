/**
 * 模型原生 tool calling 能力缓存
 * ------------------------------------------------------------------
 * 目的：默认开启原生工具调用，但部分 OpenAI 兼容服务/模型不支持 `tools` 参数
 * （返回 400/422 且报错含 tool/function）。失败一次后记住该 endpoint+model
 * 组合不支持，后续直接走旧的 `[TAG:]` 通道，避免每次都先失败一次。
 *
 * 存储：localStorage key `kimo_ai_tool_support_v1`，结构 Record<key, "supported" | "unsupported">。
 */

export type ToolSupport = "supported" | "unsupported" | "unknown";

const KEY = "kimo_ai_tool_support_v1";

function read(): Record<string, ToolSupport> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ToolSupport>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, ToolSupport>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 忽略 */
  }
}

/** 缓存键：接口地址 + 模型（同一 endpoint 不同模型的 tool 支持可能不同） */
export function toolSupportKey(endpoint: string, model: string): string {
  return `${(endpoint || "").replace(/\/+$/, "").toLowerCase()}|${(model || "").toLowerCase()}`;
}

export function getToolSupport(endpoint: string, model: string): ToolSupport {
  return read()[toolSupportKey(endpoint, model)] || "unknown";
}

export function markToolSupport(
  endpoint: string,
  model: string,
  value: ToolSupport,
): void {
  const map = read();
  map[toolSupportKey(endpoint, model)] = value;
  write(map);
}

/** 设置页「重置能力检测」用 */
export function resetToolSupport(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}
