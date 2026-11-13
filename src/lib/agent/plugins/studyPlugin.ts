/**
 * 学习插件：让 AI 建科目、排知识点路线图、勾进度（页面见 StudyPage）
 */
import type { AgentPlugin } from "./types";
import {
  addNodes,
  createSubject,
  loadSubjects,
  subjectProgress,
  updateNode,
} from "../../study";
import type { StudyNodeStatus, StudyNodeType } from "../../study";
import { fail, ok } from "./shared";

function normType(t?: string): StudyNodeType {
  const v = (t || "").toLowerCase();
  return v === "practice" || v === "lab" ? v : "concept";
}

function pickSubject(key: string) {
  const k = (key || "").trim().toLowerCase();
  return loadSubjects().find(
    (s) => s.id === key || s.name.trim().toLowerCase() === k,
  );
}

const plugin: AgentPlugin = {
  id: "study",
  name: "学习系统",
  priority: 36,

  ui: {
    study_add_subject: { type: "学习" },
    study_add_nodes: { type: "学习" },
    study_list: { type: "学习" },
    study_mark: { type: "学习" },
  },

  promptLines: () =>
    `- 【学习】用户说「想学某科目 / 帮我排个学习路线」时：先用 study_add_subject 建科目 + 大纲（每行一个知识点，可写 标题|concept/practice/lab），再用 study_add_nodes 补节点。
- 讲课时先 study_list 看进度，挑「当前节点」讲；用户说「学完了」用 study_mark 勾完成。
- 课件/练习题让用户在「学习」页点「生成课件 / 出题考我」生成；你也可以直接在对话里讲解，但进度要落到 study_* 里。
`,

  tools: () => [
    {
      name: "study_add_subject",
      label: "新建学习科目",
      description:
        "创建学习科目并写入知识点大纲（按依赖顺序）。大纲每项一行：标题|concept/practice/lab。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "科目名，例如 线性代数" },
          goal: { type: "string", description: "学习目标（可选）" },
          outline: {
            type: "array",
            items: { type: "string" },
            description:
              "知识点列表，按学习顺序；每项可写「标题|concept/practice/lab」",
          },
        },
        required: ["name", "outline"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as { name?: string; goal?: string; outline?: string[] };
        const items = (p.outline || [])
          .map((l) => String(l || "").trim())
          .filter(Boolean)
          .map((l) => {
            const [title, type] = l.split("|");
            return { title, type: normType(type) };
          });
        if (!items.length) fail("outline 不能为空");
        const s = createSubject(
          String(p.name || ""),
          String(p.goal || ""),
          items,
        );
        if (!s) fail("name 不能为空");
        return ok(
          `已创建科目「${s.name}」，共 ${s.nodes.length} 个知识点。可在侧边栏「学习」页查看并生成课件。`,
          { id: s.id },
        );
      },
    },
    {
      name: "study_add_nodes",
      label: "添加知识点",
      description: "给已有科目追加知识点（按顺序）。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名或 id" },
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                type: {
                  type: "string",
                  enum: ["concept", "practice", "lab"],
                },
              },
              required: ["title"],
            },
          },
        },
        required: ["subject", "nodes"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as {
          subject?: string;
          nodes?: { title?: string; type?: string }[];
        };
        const s = pickSubject(String(p.subject || ""));
        if (!s) fail(`没有找到科目：${p.subject}`);
        const n = addNodes(
          s.id,
          (p.nodes || []).map((x) => ({
            title: String(x.title || ""),
            type: normType(x.type),
          })),
        );
        if (n <= 0) fail("没有有效知识点");
        return ok(`已给「${s.name}」添加 ${n} 个知识点`, { added: n });
      },
    },
    {
      name: "study_list",
      label: "查看学习进度",
      description: "列出科目、进度与当前建议学习节点。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const list = loadSubjects();
        if (!list.length) return ok("还没有学习科目。可以说「我想学…」。");
        return ok(
          list
            .map((s) => {
              const p = subjectProgress(s);
              return `- ${s.name}：${p.done}/${p.total}（${p.pct}%）· 当前：${
                p.current?.title || "已完成"
              }`;
            })
            .join("\n"),
          { count: list.length },
        );
      },
    },
    {
      name: "study_mark",
      label: "更新知识点状态",
      description: "把某知识点标记为 todo / doing / done。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名或 id" },
          node: { type: "string", description: "知识点标题（模糊匹配）" },
          status: {
            type: "string",
            enum: ["todo", "doing", "done"],
          },
        },
        required: ["subject", "node", "status"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as { subject?: string; node?: string; status?: string };
        const s = pickSubject(String(p.subject || ""));
        if (!s) fail(`没有找到科目：${p.subject}`);
        const key = String(p.node || "")
          .trim()
          .toLowerCase();
        const n = s.nodes.find((x) =>
          x.title.trim().toLowerCase().includes(key),
        );
        if (!n) fail(`没有找到知识点：${p.node}`);
        const status = (
          ["todo", "doing", "done"] as StudyNodeStatus[]
        ).includes(p.status as StudyNodeStatus)
          ? (p.status as StudyNodeStatus)
          : "done";
        updateNode(s.id, n.id, { status });
        return ok(`「${s.name}」的「${n.title}」已标记为 ${status}`);
      },
    },
  ],
};

export default plugin;
