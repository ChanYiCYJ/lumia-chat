/**
 * Agent 插件协议（AgentPlugin）
 * ------------------------------------------------------------------
 * 一个「功能」= 一个插件文件，插件自己声明：
 *   工具（tools） + 提示词（promptLines） + 卡片 UI（ui） + 可用性守卫（guard）
 * 核心（registry / piRunner / AIChat）只依赖这里的接口，不认识任何具体功能，
 * 因此新增功能不需要改核心代码，也不会影响已有功能。
 *
 * 插件由 registry.ts 用 `import.meta.glob("./*Plugin.ts")` 自动发现：
 * 在 plugins/ 下新建 `xxxPlugin.ts` 并 `export default` 一个 AgentPlugin 即生效。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Artifact } from "../../artifacts";
import type { SkillContext, SkillSection } from "../../skills/util";

/** Agent 面板可切换的页签 */
export type ToolTab = "artifacts" | "kb" | "edit" | "live2d" | "settings";

/** 工具执行上下文（由 AIChat 注入，插件只读 + 通过回调产生 UI 副作用） */
export interface ToolContext {
  pageId: number;
  sessionId: string;
  /** 搜索模式：fast 不允许联网工具，auto/deep 允许 */
  mode: "fast" | "auto" | "deep";
  webEnabled: boolean;
  /** 权限预设：read=只读（禁写操作）/ write=标准 / auto=自动 */
  permission?: "read" | "write" | "auto";
  notionToken?: string;
  notionDbId?: string;
  /** 关联的对话消息下标（工具卡定位） */
  msgIdx?: number;
  /** 打开 Agent 面板（可指定产物 id 直接定位） */
  openPanel?: (
    tab: ToolTab,
    artifactId?: string,
    /** true=移动端也强制打开（用户明确要求打开面板时） */
    force?: boolean,
  ) => void;
  /** 产物新增/更新后回调（UI 刷新列表并自动选中） */
  onArtifact?: (artifact: Artifact) => void;
  /** 产物删除后回调（UI 刷新列表并清空选中） */
  onArtifactRemoved?: (id: string) => void;
}

/** 工具卡展示信息：type=卡片文案/配色，tab=点击后打开哪个面板 */
export interface ToolUi {
  type: string;
  tab?: ToolTab;
}

export interface AgentPlugin {
  /** 唯一 id（同名插件后者覆盖前者，便于使用时临时替换实现） */
  id: string;
  /** 人类可读名称（调试 / 设置页展示） */
  name: string;
  /** 排序权重：小在前，影响工具声明顺序与提示词行顺序（默认 100） */
  priority?: number;
  /** 是否属于「联网能力」：fast 模式 / 未开启联网时由核心统一拦截 */
  web?: boolean;
  /**
   * 可用性守卫：返回字符串 = 拒绝原因（模型会看到该原因并自行降级），
   * 返回 undefined = 允许执行。核心会在每次工具调用前调用。
   * toolName 可选（插件内工具级差异化判断用，如「含 http 步骤才算联网」）。
   */
  guard?: (ctx: ToolContext, toolName?: string) => string | undefined;
  /** 本插件提供的工具 */
  tools: (ctx: ToolContext) => AgentTool[];
  /**
   * 注入 system 提示词的工具使用说明（仅原生工具模式、自动拼进【原生工具】段）。
   * 每行以 "\n" 结尾；不需要说明的功能返回 ""。
   */
  promptLines?: (ctx: SkillContext) => string;
  /** 工具名 → 工具卡展示信息（未声明时核心回退为 { type: 工具名 }） */
  ui?: Record<string, ToolUi>;
  /**
   * 动态工具（运行时生成，例如 AI 自写插件）的工具卡 UI：
   * 静态 `ui` 无法预先列出未知工具名，用这个钩子按名解析。
   */
  resolveUi?: (toolName: string) => ToolUi | undefined;
  /**
   * 插件自带的 system 提示词段（不是工具说明，例如工作流/格式约定）。
   * 由 assembleSystem 统一注入，插件不需要再改 skills/registry.ts。
   */
  systemSection?: (ctx: SkillContext) => SkillSection | SkillSection[];
  /**
   * 旧 [TAG:] 文本通道的清洗正则（可选）。
   * 核心在 stripToolCmds 的最后逐个执行，用于隐藏新增指令标记。
   */
  tagPatterns?: RegExp[];
}
