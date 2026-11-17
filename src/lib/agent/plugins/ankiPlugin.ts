/**
 * Anki 式复习插件
 * ------------------------------------------------------------------
 * 到期队列与建卡。复习本身发生在对话卡片里（StudyChatCard 的评分按钮），
 * 卡片评分直接写入 srs.ts 的调度，Agent 只负责「查」与「加」，不冒充复习。
 */
import type { AgentPlugin } from "./types";
import { fail, ok } from "./shared";
import {
  cardsForNode,
  dueCards,
  addCards,
  srsStats,
} from "../../srs";
import { resolveNode, resolveSubject, updateNode } from "../../study";

function requireSubject(key: string) {
  const s = resolveSubject(key);
  if (!s) fail(`没有找到科目：${key || "(空)"}`);
  return s as NonNullable<typeof s>;
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
    `- 【复习】用户问「今天要复习什么」：anki_due。到期卡片会直接在对话里显示，用户点评分即可完成复习。
- 普通练习优先 study_practice（会自动出题建卡）；只有用户明确要求补卡/整理记忆卡时才用 anki_add_cards：front 是具体问题（≤60 字），back 是可判断的答案（≤80 字），一次最多 10 张。
- 不要凭空说“已经复习 / 已经记住”：真实评分只发生在卡片里，你只报告到期数量与结果。
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
          sid = requireSubject(String(p.subject)).id;
        }
        const stats = srsStats(sid);
        const due = dueCards(sid);
        if (!stats.total) {
          return ok("还没有复习卡。先说要学什么，课件卡里可以直接出题。");
        }
        const sample = due
          .slice(0, 5)
          .map((c) => `- ${c.front}`)
          .join("\n");
        return ok(
          `共 ${stats.total} 张卡：${stats.due} 张到期、${stats.fresh} 张新卡、${stats.mature} 张长期卡。${
            sample ? `\n到期示例：\n${sample}` : "\n今天没有到期卡片。"
          }`,
          { total: stats.total, due: stats.due, card: { kind: "review", subjectId: sid } },
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
        const subject = requireSubject(String(p.subject || ""));
        const n = resolveNode(subject, String(p.node || ""));
        if (!n) fail(`「${subject.name}」里没有知识点：${p.node}`);
        const node = n as NonNullable<typeof n>;
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
        const total = cardsForNode(node.id).length;
        return ok(
          `已添加 ${added} 张复习卡到「${subject.name} / ${node.title}」（共 ${total} 张），在卡片里直接评分。`,
          {
            card: { kind: "practice", subjectId: subject.id, nodeId: node.id },
            added,
          },
        );
      },
    },
  ],
};

export default plugin;
