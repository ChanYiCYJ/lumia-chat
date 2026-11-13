/**
 * 双通道桥接：原生工具调用 与 旧 [TAG:] 文本标记 的去重规则。
 *
 * 背景：原生 Agent 模式下，模型可能仍会写出 `[SEARCH:]` / `[KB-SAVE:]` 等旧标记
 * （系统提示词/模型习惯残留）。如果两套都执行，会出现「搜两次 / 存两条」。
 *
 * 规则：
 * - 旧通道（agentUsed=false）：标记全部照常执行，行为与改动前完全一致。
 * - 原生通道（agentUsed=true）：只有当本轮「没有调用过对应工具」时，才执行该标记，
 *   既避免重复，也保留模型漏调工具时的兜底能力。
 */
export type TagKind =
  | "search"
  | "browse"
  | "article"
  | "edit"
  | "kb"
  | "kbDelete"
  | "view";

/** 标记 → 能代表它的原生工具（命中任一即视为已由工具完成） */
const TAG_TO_TOOLS: Record<TagKind, string[]> = {
  search: ["web_search"],
  browse: ["fetch_page"],
  article: ["generate_article"],
  edit: ["write_artifact"],
  kb: ["kb_save"],
  kbDelete: ["kb_delete"],
  view: ["write_artifact", "generate_article", "open_artifact"],
};

export interface TagGateContext {
  /** 本轮是否走了原生 Agent 通道 */
  agentUsed: boolean;
  /** 本轮实际调用过的工具名 */
  ranTools: ReadonlySet<string>;
}

export function shouldRunTag(kind: TagKind, ctx: TagGateContext): boolean {
  if (!ctx.agentUsed) return true;
  const tools = TAG_TO_TOOLS[kind];
  return !tools.some((t) => ctx.ranTools.has(t));
}

/** 一次性计算所有标记的执行许可（避免分派链里重复调用） */
export function createTagGate(ctx: TagGateContext): Record<TagKind, boolean> {
  return {
    search: shouldRunTag("search", ctx),
    browse: shouldRunTag("browse", ctx),
    article: shouldRunTag("article", ctx),
    edit: shouldRunTag("edit", ctx),
    kb: shouldRunTag("kb", ctx),
    kbDelete: shouldRunTag("kbDelete", ctx),
    view: shouldRunTag("view", ctx),
  };
}
