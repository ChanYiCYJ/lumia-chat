/**
 * 学习卡片的「对话内引用」
 * ------------------------------------------------------------------
 * 学习功能的主舞台是对话：课件 / 练习 / 复习 / 路线图都以卡片实时出现。
 * 消息里只存一个轻量引用（科目 id + 知识点 id + 类型），内容每次渲染时
 * 从学习库（kimo_study_v1）与复习卡（kimo_study_cards_v1）读取，
 * 因此卡片永远不会和后台数据脱节，也不会把整篇课件复制进会话存储。
 *
 * 纯函数、无 React 依赖，便于单测。
 */
import { loadSubjects, subjectProgress } from "./study";
import type { StudyNode, StudySubject } from "./study";

export type StudyChatCardKind = "plan" | "lesson" | "practice" | "review";

export interface StudyChatCardRef {
  kind: StudyChatCardKind;
  subjectId?: string;
  nodeId?: string;
  /** 工具执行中：卡片先占位，完成后原地替换 */
  pending?: boolean;
  /** 工具失败：卡片内显示一行原因（可点重试） */
  error?: string;
}

const KINDS: StudyChatCardKind[] = ["plan", "lesson", "practice", "review"];

/** 会产生对话卡片的工具（onToolEnd 只处理这些） */
const CARD_TOOLS = new Set([
  "study_add_subject",
  "study_add_nodes",
  "study_teach",
  "study_practice",
  "anki_add_cards",
  "anki_due",
]);

export function isStudyCardTool(name: string): boolean {
  return CARD_TOOLS.has(name);
}

function str(v: unknown, max = 64): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

/** 校验/收敛卡片引用（单条消息最多 6 张，避免刷屏） */
export function normalizeStudyCards(value: unknown): StudyChatCardRef[] {
  if (!Array.isArray(value)) return [];
  const out: StudyChatCardRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const kind = KINDS.find((k) => k === raw.kind);
    if (!kind) continue;
    const error = str(raw.error, 120);
    out.push({
      kind,
      subjectId: str(raw.subjectId),
      nodeId: str(raw.nodeId),
      pending: raw.pending === true,
      ...(error ? { error } : {}),
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** 会话恢复：丢掉「生成中 / 失败」的临时态，只留已经落地的卡片 */
export function reviveStudyCards(value: unknown): StudyChatCardRef[] {
  return normalizeStudyCards(value).filter((c) => !c.pending && !c.error);
}

/** 工具结果 → 卡片引用（工具用 details.card 声明要展示哪张卡） */
export function cardFromToolResult(result: unknown): StudyChatCardRef | null {
  const details = (result as { details?: unknown } | null)?.details;
  const card = (details as { card?: unknown } | null)?.card;
  return normalizeStudyCards([card])[0] || null;
}

/** 工具失败：pi 把抛错内容放进 content[0].text，压缩成一行给卡片 */
export function errorFromToolResult(result: unknown): string {
  const text = (result as { content?: { text?: unknown }[] } | null)
    ?.content?.[0]?.text;
  const msg = typeof text === "string" ? text : "";
  return (msg || "生成失败").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** 名字/id → 科目 + 知识点（工具参数通常只有名字，卡片需要 id 才能读数据） */
export function resolveStudyTarget(
  subjects: StudySubject[],
  subjectKey?: string,
  nodeKey?: string,
): { subject?: StudySubject; node?: StudyNode } {
  const k = (subjectKey || "").trim().toLowerCase();
  if (!k) return {};
  const subject = subjects.find(
    (s) => s.id === subjectKey || s.name.trim().toLowerCase() === k,
  );
  if (!subject) return {};
  const nk = (nodeKey || "").trim().toLowerCase();
  const node = nk
    ? subject.nodes.find((n) => n.id === nodeKey) ||
      subject.nodes.find((n) => n.title.trim().toLowerCase() === nk) ||
      subject.nodes.find((n) => n.title.toLowerCase().includes(nk))
    : subjectProgress(subject).current;
  return { subject, node };
}

/**
 * 工具开始执行时的占位卡片；返回 null 表示该工具不产生卡片。
 * 读取 localStorage 解析名字 → id，保证卡片一出现就绑定到正确的科目/节点。
 */
export function pendingCardForTool(
  toolName: string,
  args: unknown,
  subjects = loadSubjects(),
): StudyChatCardRef | null {
  const a = (args || {}) as { subject?: string; node?: string };
  const { subject, node } = resolveStudyTarget(
    subjects,
    String(a.subject || ""),
    String(a.node || ""),
  );
  const subjectId = subject?.id;
  const nodeId = node?.id;
  switch (toolName) {
    case "study_add_subject":
    case "study_add_nodes":
      return { kind: "plan", subjectId, pending: true };
    case "study_teach":
      return { kind: "lesson", subjectId, nodeId, pending: true };
    case "study_practice":
    case "anki_add_cards":
      return { kind: "practice", subjectId, nodeId, pending: true };
    case "anki_due":
      return { kind: "review", subjectId, pending: true };
    default:
      return null;
  }
}
