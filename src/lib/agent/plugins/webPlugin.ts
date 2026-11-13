/**
 * 联网插件：搜索 / 读网页 / 展示网页 / 生成文章
 * web: true → fast 模式与「未开启联网」时核心统一拦截，无需在 execute 里重复判断。
 */
import type { AgentPlugin } from "./types";
import { fetchWebpage, searchWithCache } from "../../search";
import { runSearchAgent } from "../../searchAgent";
import {
  derivePageTitle,
  fail,
  ok,
  requireWeb,
  saveArtifact,
  searchResultsBrief,
} from "./shared";

const plugin: AgentPlugin = {
  id: "web",
  name: "联网搜索",
  priority: 10,
  web: true,

  ui: {
    web_search: { type: "Search", tab: "artifacts" },
    fetch_page: { type: "读取网页", tab: "artifacts" },
    open_webpage: { type: "网页", tab: "artifacts" },
    generate_article: { type: "View", tab: "artifacts" },
  },

  promptLines: (ctx) =>
    ctx.webTools
      ? `- 需要实时/最新信息、事实核查：调用 web_search（参数 query，必要时 deep=true）。
- 用户给了链接：调用 fetch_page（参数 url）读取正文。
- 要把网页展示给用户看（“打开/看看这个网页”）：调用 open_webpage（url），产物面板会以「阅读/原网页」双视图展示。
- 用户要完整文章/盘点/攻略：调用 generate_article（参数 topic），文章会进产物面板，正文不要再重复输出全文。
- 搜索/网页结果需要保留：用 write_artifact（kind=search / web）存为产物，不要只在对话里复述一堆链接。
`
      : "",

  tools: (ctx) => [
    {
      name: "web_search",
      label: "联网搜索",
      description:
        "联网搜索最新信息（新闻、番剧、价格、事件等）。返回结果摘要与来源链接。需要最新/不确定的事实时优先调用。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词（可多语言混合）" },
          deep: {
            type: "boolean",
            description: "是否深度检索（更多来源、更慢）",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { query?: string; deep?: boolean };
        const query = (params.query || "").trim();
        if (!query) fail("query 不能为空");
        requireWeb(ctx, "web_search");
        const result = await runSearchAgent(
          query,
          "",
          params.deep ? "deep" : "auto",
        );
        const brief = searchResultsBrief(result.results);
        const answer = (result.answer || "").slice(0, 1200);
        const text = [
          answer ? `【综合】${answer}` : "",
          brief ? `【来源】\n${brief}` : "（没有检索到结果）",
        ]
          .filter(Boolean)
          .join("\n\n");
        return ok(text, {
          count: result.results.length,
          sources: result.results
            .filter((r) => !!r.url)
            .slice(0, 8)
            .map((r) => r.url),
        });
      },
    },
    {
      name: "fetch_page",
      label: "读取网页",
      description:
        "抓取指定 URL 的正文内容。用户给了链接、或搜索结果需要展开细读时使用。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要读取的完整网址（http/https）",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { url?: string };
        const url = (params.url || "").trim();
        if (!/^https?:\/\//i.test(url)) fail("url 必须是 http/https 地址");
        requireWeb(ctx, "fetch_page");
        const content = await fetchWebpage(url);
        if (!content.trim()) fail(`抓取失败或页面无正文：${url}`);
        const title = derivePageTitle(content, url);
        const text = content.slice(0, 6000);
        return ok(text, {
          url,
          title,
          chars: content.length,
        });
      },
    },
    {
      name: "open_webpage",
      label: "展示网页",
      description:
        "抓取网页并在产物面板中展示（阅读模式 + 原网页预览）。用户说“打开/看看这个网页”或需要把页面展示给用户看时使用。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要展示的完整网址（http/https）",
          },
          title: {
            type: "string",
            description: "可选标题，不传则从正文首行推导",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { url?: string; title?: string };
        const url = (params.url || "").trim();
        if (!/^https?:\/\//i.test(url)) fail("url 必须是 http/https 地址");
        requireWeb(ctx, "open_webpage");
        const content = await fetchWebpage(url);
        if (!content.trim()) fail(`抓取失败或页面无正文：${url}`);
        const title =
          (params.title || "").trim() || derivePageTitle(content, url);
        const artifact = saveArtifact(ctx, {
          kind: "web",
          title,
          url,
          content,
          sources: [{ title, url }],
        });
        ctx.openPanel?.("artifacts", artifact.id);
        return ok(
          `已在产物面板打开网页《${title}》（${content.length} 字），可直接切换「网页」查看原站。`,
          { artifactId: artifact.id, url },
        );
      },
    },
    {
      name: "generate_article",
      label: "生成文章",
      description:
        "围绕一个主题联网检索并生成一篇完整综合文章，生成后进入本会话的「产物」列表，用户可在产物面板阅读。需要长文/整理资料时使用。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "文章主题/搜索关键词" },
          deep: { type: "boolean", description: "是否深度生成（更多来源）" },
        },
        required: ["topic"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { topic?: string; deep?: boolean };
        const topic = (params.topic || "").trim();
        if (!topic) fail("topic 不能为空");
        requireWeb(ctx, "generate_article");
        const result = await searchWithCache(topic, {
          maxSources: params.deep || ctx.mode === "deep" ? 7 : 5,
          perSourceChars: params.deep || ctx.mode === "deep" ? 2600 : 2200,
        });
        const article = (result.article || result.content || "").trim();
        if (!article) fail(`文章生成失败：${topic}`);
        const artifact = saveArtifact(ctx, {
          kind: "article",
          title: topic,
          topic,
          content: article,
          sources: (result.sources || [])
            .filter((s) => !!s.url)
            .slice(0, 8)
            .map((s) => ({ title: s.title || s.url, url: s.url })),
        });
        ctx.openPanel?.("artifacts", artifact.id);
        return ok(
          `已生成文章《${topic}》，共 ${article.length} 字，已存入本会话产物（id: ${artifact.id}）。正文已在产物面板展示，请不要重复输出全文。`,
          { artifactId: artifact.id, chars: article.length },
        );
      },
    },
  ],
};

export default plugin;
