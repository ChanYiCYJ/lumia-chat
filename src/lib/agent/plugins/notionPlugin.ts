/**
 * Notion 插件：查询用户 Notion 工作区（页面正文 / 默认数据库）
 * guard：未配置 Token 时直接拒绝，避免模型反复重试。
 */
import type { AgentPlugin } from "./types";
import {
  buildNotionDbContext,
  fetchNotionContext,
  queryNotionDatabase,
} from "../../notion";
import { fail, ok } from "./shared";

const plugin: AgentPlugin = {
  id: "notion",
  name: "Notion",
  priority: 50,

  guard: (ctx) =>
    ctx.notionToken ? undefined : "未连接 Notion，请告知用户先配置 Token。",

  ui: {
    notion_query: { type: "网络资料", tab: "kb" },
  },

  promptLines: (ctx) =>
    ctx.notion
      ? `- 查 Notion 工作区：调用 notion_query。
`
      : "",

  tools: (ctx) => [
    {
      name: "notion_query",
      label: "查询 Notion",
      description:
        "查询用户 Notion 工作区（页面正文或指定数据库）。未连接 Notion 时会失败。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "查询关键词" },
          database: {
            type: "boolean",
            description: "是否查询已配置的默认数据库（任务/清单类）",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { query?: string; database?: boolean };
        const token = ctx.notionToken;
        if (!token) fail("未连接 Notion：请先在设置中填写 Notion Token");
        const query = (params.query || "").trim();
        const parts: string[] = [];
        if (params.database && ctx.notionDbId) {
          const rows = await queryNotionDatabase(token, ctx.notionDbId, {
            page_size: 10,
          });
          parts.push(buildNotionDbContext(rows, "默认数据库"));
        }
        parts.push(await fetchNotionContext(query, { token }));
        const text = parts.filter(Boolean).join("\n\n").slice(0, 4000);
        if (!text.trim()) return ok("Notion 中没有找到相关内容。");
        return ok(text, { chars: text.length });
      },
    },
  ],
};

export default plugin;
