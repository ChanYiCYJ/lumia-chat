/**
 * 学习系统（借鉴 StudyMate 的「科目 → 大纲 → 课件 → 练习」工作流）
 * ------------------------------------------------------------------
 * 纯数据 + 纯函数；存储 localStorage `kimo_study_v1`。
 * 页面见 components/StudyPage.tsx；AI 工具见 agent/plugins/studyPlugin.ts。
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

/** 生成课件的提示词（StudyMate 风格：先直觉，再定义/例子/误区，最后练习） */
export function lessonPrompt(subject: StudySubject, node: StudyNode): string {
  return [
    `科目：${subject.name}`,
    subject.goal ? `学习目标：${subject.goal}` : "",
    `当前知识点：${node.title}（${NODE_TYPE_LABEL[node.type]}课）`,
    node.deps.length ? `前置知识点：${node.deps.join("、")}` : "",
    "",
    "请用中文写一份可直接阅读的课件（Markdown）：",
    "1. 一句话直觉：这个东西解决什么问题；",
    "2. 核心定义与关键公式/接口（必要时给出符号说明）；",
    "3. 一个从零推导或逐步实现的例子（代码/算式要能跑通或算对）；",
    "4. 常见误区 2-3 条（每条说明为什么错）；",
    "5. 3 道由易到难的练习（先题目，答案放在最后「答案」小节）。",
    "不要输出与课件无关的寒暄；不要编造不存在的事实。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 出题提示词 */
export function quizPrompt(subject: StudySubject, node: StudyNode): string {
  return [
    `科目：${subject.name}；知识点：${node.title}`,
    "请出 3 道检验该知识点的题（由易到难，覆盖概念理解与动手计算/编码）。",
    "格式：每题先写题目，再在新的一行给「答案：…」；不要只给答案。",
  ].join("\n");
}
