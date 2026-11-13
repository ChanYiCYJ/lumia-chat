/**
 * Agent 插件注册表（核心）
 * ------------------------------------------------------------------
 * 唯一的「核心」文件：自动发现 plugins/*Plugin.ts、按 priority 排序、聚合成
 * 工具列表 / 提示词 / 工具卡 UI / 守卫 / 标签清洗规则。
 *
 * 新增功能的标准姿势（无需改本文件）：
 *   1) 新建 `src/lib/agent/plugins/xxxPlugin.ts`
 *   2) `export default { id, name, priority, tools, promptLines?, ui?, guard? } satisfies AgentPlugin`
 *   3) 完事：工具、提示词、卡片 UI、联网/配置守卫全部自动接上
 *
 * 需要运行时动态挂载（例如第三方脚本 / 测试）时用 `registerPlugin(plugin)`。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { SkillContext, SkillSection } from "../../skills/util";
import type { AgentPlugin, ToolContext, ToolUi } from "./types";

/** 自动发现：plugins 目录下所有 *Plugin.ts（eager 是为了同步拿到 tool 声明） */
const discovered = import.meta.glob<{ default: AgentPlugin }>("./*Plugin.ts", {
  eager: true,
});

/** 运行时动态注册的插件（覆盖同 id 内置插件） */
const dynamic: AgentPlugin[] = [];

/** 工具名 → 插件 的缓存（插件变化/开关变化时失效） */
let toolIndex: Map<string, AgentPlugin> | null = null;

/** 被禁用的插件 id（插件页开关；存 UI 不进入对话） */
const DISABLED_KEY = "kimo_plugin_disabled_v1";
function readDisabled(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISABLED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    return new Set();
  }
}
export function isPluginEnabled(id: string): boolean {
  return !readDisabled().has(id);
}
/** 启用/禁用插件（立即影响工具、提示词与面板） */
export function setPluginEnabled(id: string, on: boolean): void {
  const s = readDisabled();
  if (on) s.delete(id);
  else s.add(id);
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...s]));
  } catch {
    /* 忽略 */
  }
  toolIndex = null;
}

/** 所有插件（含已禁用，供插件页展示） */
export function allPlugins(): AgentPlugin[] {
  const map = new Map<string, AgentPlugin>();
  for (const mod of Object.values(discovered)) {
    const plugin = mod?.default;
    if (plugin && typeof plugin.id === "string") map.set(plugin.id, plugin);
  }
  for (const plugin of dynamic) map.set(plugin.id, plugin);
  return [...map.values()].sort(
    (a, b) =>
      (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id),
  );
}

/** 生效插件（过滤掉被禁用的） */
export function listPlugins(): AgentPlugin[] {
  const disabled = readDisabled();
  return allPlugins().filter((p) => !disabled.has(p.id));
}

/** 动态注册/替换插件（按 id 覆盖内置实现） */
export function registerPlugin(plugin: AgentPlugin): void {
  const idx = dynamic.findIndex((p) => p.id === plugin.id);
  if (idx >= 0) dynamic[idx] = plugin;
  else dynamic.push(plugin);
  toolIndex = null;
}

/** 注销动态插件（回落到内置实现；测试清理用） */
export function unregisterPlugin(id: string): void {
  const idx = dynamic.findIndex((p) => p.id === id);
  if (idx >= 0) dynamic.splice(idx, 1);
  toolIndex = null;
}

/**
 * 工具名 → 所属插件。重复工具名视为开发错误，直接抛错尽早暴露。
 * 注意：建立索引时会用空 ctx 调一次 tools()，因此插件的 tools() 必须是纯声明
 * （不要在声明期读 ctx 字段或产生副作用）。
 */
function ensureToolIndex(): Map<string, AgentPlugin> {
  if (toolIndex) return toolIndex;
  const index = new Map<string, AgentPlugin>();
  const probe = {} as ToolContext;
  for (const plugin of listPlugins()) {
    let tools: AgentTool[] = [];
    try {
      tools = plugin.tools(probe);
    } catch {
      tools = [];
    }
    for (const tool of tools) {
      const owner = index.get(tool.name);
      if (owner && owner.id !== plugin.id) {
        throw new Error(
          `[agent] 工具名冲突：${tool.name}（${owner.id} 与 ${plugin.id}）`,
        );
      }
      index.set(tool.name, plugin);
    }
  }
  toolIndex = index;
  return index;
}

/** 聚合所有插件的工具（顺序 = 插件 priority + 插件内声明顺序） */
export function createAgentTools(ctx: ToolContext): AgentTool[] {
  ensureToolIndex(); // 顺便做一次重名校验（插件作者的常见错误，尽早报错）
  return listPlugins().flatMap((plugin) => plugin.tools(ctx));
}

/** 本轮是否允许联网工具（runner 的 beforeToolCall 复用） */
export function isWebTool(name: string): boolean {
  return !!ensureToolIndex().get(name)?.web;
}

/**
 * 工具可用性守卫：返回拒绝原因（模型会看到）或 undefined。
 * 顺序：联网开关 → Fast 模式 → 插件自定义 guard。
 */
export function guardTool(name: string, ctx: ToolContext): string | undefined {
  const plugin = ensureToolIndex().get(name);
  if (!plugin) return undefined;
  if (plugin.web) {
    if (!ctx.webEnabled)
      return "联网工具已关闭，请直接回答或改为不联网的说明。";
    if (ctx.mode === "fast") return "Fast 模式不允许联网，请直接回答。";
  }
  return plugin.guard?.(ctx, name);
}

/** 工具卡展示信息（未声明时回退为工具名） */
export function toolUi(name: string): ToolUi {
  const plugin = ensureToolIndex().get(name);
  return plugin?.resolveUi?.(name) || plugin?.ui?.[name] || { type: name };
}

/**
 * 手动失效工具索引（运行时增删工具后调用，例如 AI 自写插件创建成功）。
 * 不调用也能用，但 toolUi/isWebTool/guardTool 会暂时认不得新工具。
 */
export function invalidateRegistry(): void {
  toolIndex = null;
}

/** 插件自带的 system 段（插件化提示词的扩展点） */
export function pluginSystemSections(ctx: SkillContext): SkillSection[] {
  const out: SkillSection[] = [];
  for (const plugin of listPlugins()) {
    const section = plugin.systemSection?.(ctx);
    if (!section) continue;
    if (Array.isArray(section)) out.push(...section);
    else out.push(section);
  }
  return out;
}

/** 原生工具模式下，各插件贡献的「工具使用说明」行（顺序 = priority） */
export function pluginToolsPrompt(ctx: SkillContext): string {
  // 不再为「是否有工具」实例化 tools（每轮组装都要跑）：不可用时应由插件
  // 自己让 promptLines 返回 ""（例如 web 插件看 ctx.webTools）。
  return listPlugins()
    .map((plugin) => plugin.promptLines?.(ctx) || "")
    .join("");
}

/** 旧 [TAG:] 通道：插件追加的清洗正则 */
export function pluginTagPatterns(): RegExp[] {
  return listPlugins().flatMap((plugin) => plugin.tagPatterns || []);
}

export type { AgentPlugin, ToolContext, ToolUi } from "./types";
export { ok, fail, saveArtifact, requireWeb } from "./shared";
