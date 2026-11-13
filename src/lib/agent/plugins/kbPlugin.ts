/**
 * 知识库插件：检索 / 读取 / 保存 / 删除条目（本地 + Notion 双存储由 kbStore 决定）
 */
import type { AgentPlugin } from "./types";
import { formatKbEntriesForContext, loadKbEntries } from "../../kb";
import { deleteKbEntrySmart, saveKbEntrySmart } from "../../kbStore";
import { fail, ok, saveArtifact } from "./shared";

const plugin: AgentPlugin = {
  id: "kb",
  name: "知识库",
  priority: 30,

  ui: {
    kb_search: { type: "打开知识库", tab: "kb" },
    kb_read: { type: "读取知识", tab: "kb" },
    kb_save: { type: "保存知识库", tab: "kb" },
    kb_delete: { type: "编辑知识库", tab: "kb" },
  },

  promptLines:
    () => `- 保存/收藏/记住内容：调用 kb_save（title + content 完整要点）。
- 修改已有知识条目：用同一个 title 再调用 kb_save（同名覆盖）。
- 删除知识条目：调用 kb_delete（title 需精确）。
- 查自己的资料：先调用 kb_search；需要全文时再调用 kb_read（title）。
`,

  tools: (ctx) => [
    {
      name: "kb_search",
      label: "检索知识库",
      description:
        "在自己的知识库中检索条目（标题/正文匹配）。回答个人资料、历史笔记类问题前先检索。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "检索关键词，留空则列出最近条目",
          },
        },
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { query?: string };
        const q = (params.query || "").trim().toLowerCase();
        const entries = loadKbEntries();
        const hits = q
          ? entries.filter(
              (e) =>
                e.name.toLowerCase().includes(q) ||
                (e.content || "").toLowerCase().includes(q),
            )
          : entries.slice(0, 10);
        if (!hits.length) return ok("知识库中没有匹配的条目。");
        const text = formatKbEntriesForContext(
          hits.map((e) => ({ title: e.name, content: e.content || "" })),
          { maxChars: 4000, perEntry: 800 },
        );
        return ok(text, { count: hits.length });
      },
    },
    {
      name: "kb_read",
      label: "读取知识条目",
      description:
        "按标题（或 id）读取知识库条目全文。需要参考某条笔记的完整内容时先调用（kb_search 只返回摘要）。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "条目标题（支持模糊匹配）" },
          id: { type: "string", description: "条目 id（可选，优先于标题）" },
        },
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { title?: string; id?: string };
        const entries = loadKbEntries();
        const t = (params.title || "").trim().toLowerCase();
        const target = params.id
          ? entries.find((e) => e.id === params.id)
          : t
            ? entries.find((e) => e.name.trim().toLowerCase() === t) ||
              entries.find((e) => e.name.toLowerCase().includes(t))
            : undefined;
        if (!target) fail(`未找到知识条目：${params.title || params.id || ""}`);
        return ok(
          `【知识条目】${target.name}\n\n${(target.content || "").slice(0, 8000)}`,
          { id: target.id, chars: (target.content || "").length },
        );
      },
    },
    {
      name: "kb_save",
      label: "保存知识库",
      description:
        "把一段内容保存到知识库（同名条目会被覆盖更新）。用户要求「记住/保存/收藏」时调用。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "条目标题（简短、概括主题）" },
          content: { type: "string", description: "条目完整内容（Markdown）" },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { title?: string; content?: string };
        const title = (params.title || "").trim();
        const content = (params.content || "").trim();
        if (!title || !content) fail("title 和 content 都不能为空");
        const result = await saveKbEntrySmart({ title, content });
        if (result.error) fail(`保存失败：${result.error}`);
        saveArtifact(ctx, {
          kind: "kb",
          title,
          content,
        });
        return ok(`已保存到知识库：${title}（${content.length} 字）`, {
          id: result.entry?.id,
          store: result.store,
        });
      },
    },
    {
      name: "kb_delete",
      label: "删除知识条目",
      description: "按标题删除知识库条目。仅在用户明确要求删除时调用。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "要删除的条目标题（需精确匹配）",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { title?: string };
        const title = (params.title || "").trim().toLowerCase();
        if (!title) fail("title 不能为空");
        const entry = loadKbEntries().find(
          (e) => e.name.trim().toLowerCase() === title,
        );
        if (!entry) fail(`未找到标题为「${params.title}」的知识条目`);
        const result = await deleteKbEntrySmart({ id: entry.id });
        return ok(`已删除知识条目：${entry.name}`, {
          removedNotion: !!result.removedNotion,
        });
      },
    },
  ],
};

export default plugin;
