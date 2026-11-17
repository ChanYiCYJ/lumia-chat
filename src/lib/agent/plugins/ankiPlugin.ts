/**
 * Anki 式复习插件：把知识点整理成「问/答」记忆卡，按间隔重复复习
 * ------------------------------------------------------------------
 * 卡片与学习页共用 srs.ts 存储；Agent 负责建卡/查到期，
 * 评分与排队在学习页「练习 / 今日复习」里完成。
 */
import type { AgentPlugin } from "./types";
import { fail, ok } from "./shared";
import { loadSubjects, updateNode } from "../../study";
import type { StudySubject } from "../../study";
import { addCards, dueCards, srsStats } from "../../srs";

function pickSubject(key: string): StudySubject | undefined {
  const k = (key || "").trim().toLowerCase();
  return loadSubjects().find(
    (s) => s.id === key || s.name.trim().toLowerCase() === k,
  );
}

function pickNode(subject: StudySubject, key: string) {
  const k = (key || "").trim().toLowerCase();
  return subject.nodes.find(
    (n) => n.id === key || n.title.trim().toLowerCase() === k,
  );
}

const plugin: AgentPlugin = {
  id: "anki",
  name: "间隔重复复习",
  priority: 38,

  ui: {
    anki_due: { type: "复习" },
    anki_add_cards: { type: "复习" },
  },

  promptLines: () =>
    `- 【复习】练习用 Anki 式间隔重复：学习页打开知识点会自动生成课件，切到「练习」自动出题建卡；到期的卡出现在「今日复习」。
- 用户说「把这些整理成记忆卡 / 帮我背 / 出点题」时，用 anki_add_cards 建卡：front 是一个具体问题（≤60 字），back 是可直接判断的答案（≤80 字），一次最多 10 张，不要把整段课件当答案。
- 用户问「今天要复习什么」先 anki_due 查到期数量；具体复习由用户在「学习」页完成，你不要凭空说已经复习。
`,

  tools: () => [
    {
      name: "anki_due",
      label: "查看待复习",
      description: "列出到期复习卡数量与最近几张卡的题目。可按科目过滤。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名或 id（可选）" },
        },
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as { subject?: string };
        let sid: string | undefined;
        if (p.subject) {
          const s = pickSubject(String(p.subject));
          if (!s) fail(`没有找到科目：${p.subject}`);
          sid = s.id;
        }
        const stats = srsStats(sid);
        const due = dueCards(sid);
        if (!stats.total) return ok("还没有复习卡。打开知识点的「练习」会自动出题建卡。");
        const sample = due
          .slice(0, 5)
          .map((c) => `- ${c.front}`)
          .join("\n");
        return ok(
          `共 ${stats.total} 张卡：${stats.due} 张到期、${stats.fresh} 张新卡、${stats.mature} 张长期卡。${
            sample ? `\n到期示例：\n${sample}` : "\n今天没有到期卡片。"
          }`,
        );
      },
    },
    {
      name: "anki_add_cards",
      label: "添加复习卡",
      description:
        "给某科目/知识点添加问答复习卡。front 是问题，back 是简明答案；同题干自动去重。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名或 id" },
          node: { type: "string", description: "知识点标题或 id" },
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                front: { type: "string", description: "问题" },
                back: { type: "string", description: "答案" },
              },
              required: ["front", "back"],
            },
            description: "最多 10 张",
          },
        },
        required: ["subject", "node", "cards"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as {
          subject?: string;
          node?: string;
          cards?: { front?: string; back?: string }[];
        };
        const subject = pickSubject(String(p.subject || ""));
        if (!subject) fail(`没有找到科目：${p.subject}`);
        const node = pickNode(subject, String(p.node || ""));
        if (!node) fail(`「${subject.name}」里没有知识点：${p.node}`);
        const pairs = (p.cards || [])
          .map((c) => ({
            front: String(c.front || "").trim(),
            back: String(c.back || "").trim(),
          }))
          .filter((c) => c.front.length >= 2 && c.back.length >= 1)
          .slice(0, 10);
        if (!pairs.length) fail("cards 不能为空（front/back 都要写）");
        const added = addCards(subject.id, node.id, pairs);
        if (!added) fail("这些题目都已存在，没有新增");
        if (node.status === "todo") {
          updateNode(subject.id, node.id, { status: "doing" });
        }
        return ok(
          `已添加 ${added} 张复习卡到「${subject.name} / ${node.title}」。可在「学习 → 练习 / 今日复习」中复习。`,
        );
      },
    },
  ],
};

export default plugin;
