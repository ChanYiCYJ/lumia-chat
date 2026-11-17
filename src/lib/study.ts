/**
 * 学习系统（借鉴 StudyMate 的「科目 → 大纲 → 课件 → 练习」工作流）
 * ------------------------------------------------------------------
 * 纯数据 + 纯函数；存储 localStorage `kimo_study_v1`。
 * 交互在对话里完成（components/StudyChatCard.tsx），后台页面见
 * components/StudyWorkspace.tsx，AI 工具见 agent/plugins/studyPlugin.ts。
 */

export type StudyNodeType = "concept" | "practice" | "lab";
export type StudyNodeStatus = "todo" | "doing" | "done";

export interface StudyNode {
  id: string;
  title: string;
  type: StudyNodeType;
  status: StudyNodeStatus;
  /** 依赖节点 id（这些节点完成后才建议开始） */
  deps: string[];
  /** AI 生成的课件 / 笔记（Markdown） */
  content: string;
  updatedAt?: number;
}

export interface StudySubject {
  id: string;
  name: string;
  goal: string;
  nodes: StudyNode[];
  createdAt: number;
}

export const STUDY_KEY = "kimo_study_v1";

export const NODE_TYPE_LABEL: Record<StudyNodeType, string> = {
  concept: "概念",
  practice: "实操",
  lab: "实验",
};

export function studyUid(prefix = "s"): string {
  return (
    prefix +
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 5)
  );
}

export function loadSubjects(): StudySubject[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STUDY_KEY) || "[]");
    return Array.isArray(raw) ? (raw as StudySubject[]) : [];
  } catch {
    return [];
  }
}

export function saveSubjects(list: StudySubject[]): void {
  try {
    localStorage.setItem(STUDY_KEY, JSON.stringify(list));
  } catch {
    /* 忽略配额 */
  }
}

export function findSubject(id: string): StudySubject | undefined {
  return loadSubjects().find((s) => s.id === id);
}

/** 按 id 或名称（忽略大小写与首尾空白）找科目 */
export function resolveSubject(key: string): StudySubject | undefined {
  const k = (key || "").trim().toLowerCase();
  if (!k) return undefined;
  return loadSubjects().find(
    (s) => s.id === key || s.name.trim().toLowerCase() === k,
  );
}

/** 按 id / 精确标题 / 包含标题找知识点；key 为空时返回当前建议学习的节点 */
export function resolveNode(
  subject: StudySubject,
  key?: string,
): StudyNode | undefined {
  const k = (key || "").trim().toLowerCase();
  if (!k) return subjectProgress(subject).current;
  return (
    subject.nodes.find((n) => n.id === key) ||
    subject.nodes.find((n) => n.title.trim().toLowerCase() === k) ||
    subject.nodes.find((n) => n.title.toLowerCase().includes(k))
  );
}

export function createSubject(
  name: string,
  goal = "",
  outline: { title: string; type?: StudyNodeType }[] = [],
  now = Date.now(),
): StudySubject | null {
  const n = (name || "").trim();
  if (!n) return null;
  const subject: StudySubject = {
    id: studyUid("sub"),
    name: n.slice(0, 60),
    goal: goal.trim().slice(0, 500),
    createdAt: now,
    nodes: outline
      .map((o) => (o.title || "").trim())
      .filter(Boolean)
      .map((title, i) => ({
        id: studyUid("n"),
        title: title.slice(0, 80),
        type: outline[i]?.type || "concept",
        status: "todo" as const,
        deps: [] as string[],
        content: "",
      })),
  };
  saveSubjects([...loadSubjects(), subject]);
  return subject;
}

export function removeSubject(id: string): boolean {
  const list = loadSubjects();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  saveSubjects(next);
  return true;
}

/** 重命名科目 / 修改学习目标 */
export function updateSubject(
  subjectId: string,
  patch: { name?: string; goal?: string },
): StudySubject | undefined {
  const list = loadSubjects();
  const subject = list.find((s) => s.id === subjectId);
  if (!subject) return undefined;
  if (patch.name != null) {
    const name = patch.name.trim().slice(0, 60);
    if (name) subject.name = name;
  }
  if (patch.goal != null) subject.goal = patch.goal.trim().slice(0, 500);
  saveSubjects(list);
  return subject;
}

/** 删除知识点（同时清理其它节点对它的依赖） */
export function removeNode(subjectId: string, nodeId: string): boolean {
  const list = loadSubjects();
  const subject = list.find((s) => s.id === subjectId);
  if (!subject) return false;
  const next = subject.nodes.filter((n) => n.id !== nodeId);
  if (next.length === subject.nodes.length) return false;
  for (const n of next) n.deps = n.deps.filter((d) => d !== nodeId);
  subject.nodes = next;
  saveSubjects(list);
  return true;
}

/** 清空已生成的课件/练习（保留知识点本身） */
export function clearNodeContent(subjectId: string, nodeId: string): boolean {
  const list = loadSubjects();
  const node = list
    .find((s) => s.id === subjectId)
    ?.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  node.content = "";
  node.updatedAt = Date.now();
  saveSubjects(list);
  return true;
}

/** 调整知识点顺序（delta = -1 上移 / 1 下移） */
export function moveNode(
  subjectId: string,
  nodeId: string,
  delta: number,
): boolean {
  const list = loadSubjects();
  const subject = list.find((s) => s.id === subjectId);
  if (!subject) return false;
  const i = subject.nodes.findIndex((n) => n.id === nodeId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= subject.nodes.length) return false;
  const [node] = subject.nodes.splice(i, 1);
  subject.nodes.splice(j, 0, node);
  saveSubjects(list);
  return true;
}

export function addNodes(
  subjectId: string,
  nodes: { title: string; type?: StudyNodeType; deps?: string[] }[],
): number {
  const list = loadSubjects();
  const subject = list.find((s) => s.id === subjectId);
  if (!subject) return -1;
  let added = 0;
  for (const n of nodes) {
    const title = (n.title || "").trim();
    if (!title) continue;
    subject.nodes.push({
      id: studyUid("n"),
      title: title.slice(0, 80),
      type: n.type || "concept",
      status: "todo",
      deps: Array.isArray(n.deps) ? n.deps : [],
      content: "",
    });
    added += 1;
  }
  saveSubjects(list);
  return added;
}

export function updateNode(
  subjectId: string,
  nodeId: string,
  patch: Partial<
    Pick<StudyNode, "title" | "type" | "status" | "content" | "deps">
  >,
  now = Date.now(),
): StudyNode | undefined {
  const list = loadSubjects();
  const subject = list.find((s) => s.id === subjectId);
  const node = subject?.nodes.find((n) => n.id === nodeId);
  if (!subject || !node) return undefined;
  Object.assign(node, patch);
  node.updatedAt = now;
  saveSubjects(list);
  return node;
}

export interface StudyProgress {
  total: number;
  done: number;
  /** 0-100 */
  pct: number;
  /** 下一个建议学习的节点（依赖已完成的第一个 todo/doing 节点） */
  current?: StudyNode;
}

export function subjectProgress(subject: StudySubject): StudyProgress {
  const total = subject.nodes.length;
  const done = subject.nodes.filter((n) => n.status === "done").length;
  const doneIds = new Set(
    subject.nodes.filter((n) => n.status === "done").map((n) => n.id),
  );
  const current =
    subject.nodes.find(
      (n) => n.status !== "done" && n.deps.every((d) => doneIds.has(d)),
    ) || subject.nodes.find((n) => n.status !== "done");
  return {
    total,
    done,
    pct: total ? Math.round((done / total) * 100) : 0,
    current,
  };
}

/** 生成课件的提示词：短、直接、可验证，避免套话与过度分点 */
export function lessonPrompt(subject: StudySubject, node: StudyNode): string {
  return [
    `科目：${subject.name}`,
    subject.goal ? `学习目标：${subject.goal}` : "",
    `知识点：${node.title}（${NODE_TYPE_LABEL[node.type]}）`,
    node.deps.length ? `前置知识点：${node.deps.join("、")}` : "",
    "",
    "写一份 500-800 字的中文课件，直接讲知识本身：",
    "1. 核心定义/结论（3 句内说清）；",
    "2. 一个能算清或跑通的例子；",
    "3. 2 条常见误区（说明错在哪）；",
    "4. 3 道由易到难的练习，答案统一放最后「答案」小节。",
    "",
    "要求：不要开场白、不要总结套话、不要 emoji、不要吹嘘；标题层级最多三级；不确定的事实要写明。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 出题提示词：必须是「问：/答：」结构，前端直接转 Anki 卡 */
export function quizPrompt(subject: StudySubject, node: StudyNode): string {
  return [
    `科目：${subject.name}；知识点：${node.title}`,
    "出 3 道由易到难的题，覆盖概念理解与一次具体计算/推导。",
    "严格按下面格式输出 3 组，不要编号、不要额外说明：",
    "问：题目（≤60 字）",
    "答：答案（≤60 字）",
    "不要出现「以下是」「希望能帮到你」这类套话。",
  ].join("\n");
}

/** 课件系统提示（后台生成用：与聊天主提示分离，避免人设干扰知识准确性） */
export const LESSON_SYSTEM =
  "你是严谨、耐心的中文学习教练。只输出课件本身：Markdown，公式用 $...$，代码块标注语言；不确定的事实要写明。";

/** 出题系统提示 */
export const QUIZ_SYSTEM =
  "你是出题人。只输出「问：/答：」格式的题目，不要开场白、编号或解释。";

/** 校验/清洗 AI 课件：去围栏、拒绝过短与套话，返回可保存的 Markdown（不合格直接抛错） */
export function normalizeLesson(text: string): string {
  const clean = (text || "")
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  if (clean.length < 80) throw new Error("课件太短，重新生成一次");
  if (/作为一个?\s*AI|我无法|以下是为你准备/.test(clean)) {
    throw new Error("课件内容不合规，重新生成一次");
  }
  return clean;
}
