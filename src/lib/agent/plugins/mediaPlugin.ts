/**
 * 图片插件：图片搜索（动漫/照片/商品），结果存入产物
 */
import type { AgentPlugin } from "./types";
import { imageSearch } from "../../imageApi";
import { fail, ok } from "./shared";

const plugin: AgentPlugin = {
  id: "media",
  name: "图片搜索",
  priority: 40,

  ui: {
    image_search: { type: "图片", tab: "artifacts" },
  },

  promptLines: () =>
    `- 找图片：调用 image_search（keyword，可选 category/limit）。
`,

  tools: () => [
    {
      name: "image_search",
      label: "图片搜索",
      description: "搜索图片（动漫/照片/商品），返回图片直链。",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "图片关键词" },
          category: {
            type: "string",
            enum: ["photo", "anime", "product"],
            description: "图片类型，默认 photo",
          },
          limit: { type: "number", description: "返回数量，默认 6" },
        },
        required: ["keyword"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as {
          keyword?: string;
          category?: string;
          limit?: number;
        };
        const keyword = (params.keyword || "").trim();
        if (!keyword) fail("keyword 不能为空");
        const results = await imageSearch(
          keyword,
          params.category || "photo",
          Math.min(Math.max(params.limit || 6, 1), 12),
        );
        if (!results.length) fail(`没有搜到图片：${keyword}`);
        const text = results.map((r, i) => `${i + 1}. ${r.url}`).join("\n");
        return ok(text, { count: results.length });
      },
    },
  ],
};

export default plugin;
