/**
 * 学习插件：科目路线 / 课件 / 练习
 * ------------------------------------------------------------------
 * 对话里的学习闭环：建科目（路线卡）→ 讲课件（课件卡）→ 出题（练习卡）→ 复习（复习卡）。
 * 每个工具在 details.card 里声明要展示哪张卡；AIChat 负责把卡片实时挂到回复上，
 * 卡片内容始终从学习库读取，不在会话里复制课件正文。
 */
import type { AgentPlugin, ToolContext } from "./types";
import {
  LESSON_SYSTEM,
  QUIZ_SYSTEM,
  addNodes,
  createSubject,
  lessonPrompt,
  loadSubjects,
  normalizeLesson,
  quizPrompt,
  resolveNode,
  resolveSubject,
  subjectProgress,
  updateNode,
} from "../../study";
import type { StudyNodeStatus, StudyNodeType } from "../../study";
import { addCards, cardsForNode, dueCards, parseCards, srsStats } from "../../srs";
import { fail, ok } from "./shared";

function normType(t?: string): StudyNodeType {
  const v = (t || "").toLowerCase();
  return v === "practice" || v === "lab" ? v : "concept";
}

/** 后台生成不可用（未配置模型 / 无此能力）时给出可执行提示 */
function requireGenerate(ctx: ToolContext): NonNullable<ToolContext["generate"]> {
  if (!ctx.generate) {
    fail("当前环境不能后台生成：请先在「设置 → 模型 API」配置可用的模型");
  }
  return ctx.generate as NonNullable<ToolContext["generate"]>;
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
    study_teach: { type: "学习" },
    study_practice: { type: "学习" },
  },

  promptLines: () =>
    `- 【学习】用户说「想学某科目 / 帮我排一条学习路线」：先 study_add_subject 建科目 + 大纲（每行一个知识点，可写 标题|concept/practice/lab），对话里会出现「学习路线」卡片。
- 用户说「学某个知识点 / 继续学」：调用 study_teach（subject 必填，node 可选，缺省为当前节点）。课件会在卡片里展示，正文只用 1-2 句衔接（例如提醒一个易错点或接下来做什么），不要复述课件正文。
- 用户说「出题 / 练习」：调用 study_practice。题目、答案与四档评分都在卡片里，正文不要再抄题。
- 用户问「今天要复习什么」：anki_due，复习卡会直接出现在对话里。用户说「学完了」用 study_mark 勾完成；进度必须落到 study_*，不要空口说已保存。
`,

  tools: (ctx) => [
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
        const name = String(p.name || "").trim();
        if (!name) fail("name 不能为空");
        // 同名科目已存在：只补缺失的知识点，不重复建科目（避免每次说「我想学…」都多一份）
        const existed = resolveSubject(name);
        if (existed) {
          const have = new Set(
            existed.nodes.map((n) => n.title.trim().toLowerCase()),
          );
          const missing = items.filter(
            (i) => !have.has(i.title.trim().toLowerCase()),
          );
          const added = missing.length ? addNodes(existed.id, missing) : 0;
          return ok(
            `科目「${existed.name}」已存在${
              added ? `，补充了 ${added} 个知识点` : "，大纲没有变化"
            }。`,
            { id: existed.id, card: { kind: "plan", subjectId: existed.id } },
          );
        }
        const s = createSubject(name, String(p.goal || ""), items);
        if (!s) fail("name 不能为空");
        return ok(`已创建科目「${s.name}」，共 ${s.nodes.length} 个知识点。`, {
          id: s.id,
          card: { kind: "plan", subjectId: s.id },
        });
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
        const s = resolveSubject(String(p.subject || ""));
        if (!s) fail(`没有找到科目：${p.subject}`);
        const subject = s as NonNullable<typeof s>;
        const n = addNodes(
          subject.id,
          (p.nodes || []).map((x) => ({
            title: String(x.title || ""),
            type: normType(x.type),
          })),
        );
        if (n <= 0) fail("没有有效知识点");
        return ok(`已给「${subject.name}」添加 ${n} 个知识点`, {
          added: n,
          card: { kind: "plan", subjectId: subject.id },
        });
      },
    },
    {
      name: "study_list",
      label: "查看学习进度",
      description: "列出科目、进度、卡片与当前建议学习节点。",
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
              const stat = srsStats(s.id);
              return `- ${s.name}：${p.done}/${p.total}（${p.pct}%）· 当前：${
                p.current?.title || "已完成"
              } · ${stat.total} 张卡（${stat.due} 到期）`;
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
        const s = resolveSubject(String(p.subject || ""));
        if (!s) fail(`没有找到科目：${p.subject}`);
        const subject = s as NonNullable<typeof s>;
        const n = resolveNode(subject, String(p.node || ""));
        if (!n) fail(`「${subject.name}」里没有找到知识点：${p.node}`);
        const node = n as NonNullable<typeof n>;
        const status = (["todo", "doing", "done"] as StudyNodeStatus[]).includes(
          p.status as StudyNodeStatus,
        )
          ? (p.status as StudyNodeStatus)
          : "done";
        updateNode(subject.id, node.id, { status });
        return ok(`「${subject.name}」的「${node.title}」已标记为 ${status}`);
      },
    },
    {
      name: "study_teach",
      label: "生成课件",
      description:
        "为科目里的知识点生成/刷新课件（Markdown），保存到学习库并以课件卡展示。已有课件时直接展示，不重复生成。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名或 id" },
          node: {
            type: "string",
            description: "知识点标题或 id；省略时用当前建议节点",
          },
          refresh: {
            type: "boolean",
            description: "true = 忽略已有课件，重新生成",
          },
        },
        required: ["subject"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as { subject?: string; node?: string; refresh?: boolean };
        const s = resolveSubject(String(p.subject || ""));
        if (!s) fail(`没有找到科目：${p.subject || "(空)"}`);
        const subject = s as NonNullable<typeof s>;
        const n = resolveNode(subject, String(p.node || ""));
        if (!n)
          fail(
            `「${subject.name}」还没有知识点：先用 study_add_subject / study_add_nodes 建大纲`,
          );
        const node = n as NonNullable<typeof n>;
        const card = {
          kind: "lesson" as const,
          subjectId: subject.id,
          nodeId: node.id,
        };
        if (!p.refresh && node.content.trim()) {
          return ok(
            `「${subject.name} / ${node.title}」已有课件，卡片已展示。`,
            { card, existing: true },
          );
        }
        const content = normalizeLesson(
          await requireGenerate(ctx)(LESSON_SYSTEM, lessonPrompt(subject, node)),
        );
        updateNode(subject.id, node.id, {
          content,
          status: node.status === "todo" ? "doing" : node.status,
        });
        return ok(
          `课件已生成并保存：「${subject.name} / ${node.title}」（${content.length} 字）。正文只用 1-2 句衔接，不要复述课件。`,
          { card, chars: content.length },
        );
      },
    },
    {
      name: "study_practice",
      label: "生成练习",
      description:
        "为知识点出题并建成复习卡，以练习卡展示（可直接在卡片里评分）。已有卡片时直接展示，不重复出题。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名或 id" },
          node: {
            type: "string",
            description: "知识点标题或 id；省略时用当前建议节点",
          },
          refresh: {
            type: "boolean",
            description: "true = 忽略已有卡片，再出一组新题",
          },
        },
        required: ["subject"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as { subject?: string; node?: string; refresh?: boolean };
        const s = resolveSubject(String(p.subject || ""));
        if (!s) fail(`没有找到科目：${p.subject || "(空)"}`);
        const subject = s as NonNullable<typeof s>;
        const n = resolveNode(subject, String(p.node || ""));
        if (!n) fail(`「${subject.name}」还没有知识点`);
        const node = n as NonNullable<typeof n>;
        const card = {
          kind: "practice" as const,
          subjectId: subject.id,
          nodeId: node.id,
        };
        const existing = cardsForNode(node.id);
        if (existing.length && !p.refresh) {
          const due = dueCards(subject.id).filter((c) => c.nodeId === node.id);
          return ok(
            `「${node.title}」已有 ${existing.length} 张练习卡（${due.length} 张到期），卡片已展示。`,
            { card, count: existing.length },
          );
        }
        const text = await requireGenerate(ctx)(
          QUIZ_SYSTEM,
          quizPrompt(subject, node),
        );
        const pairs = parseCards(text);
        if (!pairs.length) fail("没有解析到「问：/答：」格式的题目，重新生成一次");
        const added = addCards(subject.id, node.id, pairs);
        if (!added) {
          return ok(
            `生成的题目与现有卡片重复，没有新增；直接复习「${node.title}」现有卡片即可。`,
            { card, added: 0 },
          );
        }
        if (node.status === "todo") {
          updateNode(subject.id, node.id, { status: "doing" });
        }
        return ok(
          `已生成 ${added} 张复习卡：「${subject.name} / ${node.title}」，在卡片里直接评分。`,
          { card, added },
        );
      },
    },
  ],
};

export default plugin;
