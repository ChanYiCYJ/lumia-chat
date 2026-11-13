import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  webSearch,
  searchWeb,
  searchFast,
  searchFastWithAnswer,
  searchAI,
  webSearchToArticle,
  fetchWebContent,
  readSearchCache,
  writeSearchCache,
  detectQueryType,
  detectQueryLang,
  isContentBlocked,
  filterSensitiveResults,
} from "../search";
import { setDeepseekKeyProvider } from "../deepseekSearch";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** DeepSeek Search 返回体 */
function dsResponse(
  items: Array<Record<string, unknown>>,
  status = 200,
): Response {
  return jsonResponse({ results: items }, status);
}

const ITEM = {
  title: "DeepSeek 结果",
  url: "https://a.com/post",
  snippet: "短摘要",
  summary: "长摘要内容",
  content: "正文内容",
  site_name: "示例站",
  date: "2026-11-01T00:00:00+00:00",
  authority: 3,
  rerank_score: 2.4,
};

beforeEach(() => {
  // 默认注入可用 Key（等同于用户在「模型API配置」里选了 DeepSeek）
  setDeepseekKeyProvider(() => ({
    endpoint: "https://api.deepseek.com",
    apiKey: "sk-test",
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setDeepseekKeyProvider(null);
  localStorage.clear();
});

describe("search · 网络搜索链路（DeepSeek Search）", () => {
  it("走 /api/deepseek/search 并返回格式化结果", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return dsResponse([ITEM]);
      }),
    );
    const r = await webSearch("test");
    expect(calls).toEqual(["/api/deepseek/search"]);
    expect(r).toContain("DeepSeek 结果");
    expect(r).toContain("https://a.com/post");
    expect(r).not.toContain("未找到");
  });

  it("结果为空时回退 AI 搜索（读取 kimo_ai_bots 配置）", async () => {
    localStorage.setItem(
      "kimo_ai_bots",
      JSON.stringify([
        { endpoint: "https://api.x.com/v1", apiKey: "k", model: "m" },
      ]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith("/api/deepseek")) return dsResponse([]);
        if (u.includes("/chat/completions")) {
          return jsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      title: "标题A",
                      url: "https://a.com",
                      description: "描述A",
                    },
                  ]),
                },
              },
            ],
          });
        }
        return jsonResponse([]);
      }),
    );
    const r = await webSearch("test");
    expect(r).toContain("标题A");
    expect(r).not.toContain("未找到");
  });

  it("全部来源失败时返回未找到提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/deepseek")) return dsResponse([]);
        return new Response("", { status: 500 });
      }),
    );
    const r = await webSearch("test");
    expect(r).toContain("未找到结果");
  });

  it("未配置 Key 时不发请求（直接 AI 兜底）", async () => {
    setDeepseekKeyProvider(null);
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await searchWeb("test", 5);
    expect(r).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("search · DeepSeek 请求参数与结果映射", () => {
  it("请求体含 query/count/need_content/ori_question，Key 走请求头", async () => {
    let captured: { url: string; init?: RequestInit } = { url: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        captured = { url: String(url), init };
        return dsResponse([ITEM]);
      }),
    );
    await searchWeb("DeepSeek V4", 5, {
      needContent: true,
      oriQuestion: "DeepSeek V4 什么时候发布",
    });
    const body = JSON.parse(String(captured.init?.body));
    expect(body.query).toContain("DeepSeek V4");
    expect(body.count).toBe(5);
    expect(body.need_content).toBe(true);
    expect(body.ori_question).toBe("DeepSeek V4 什么时候发布");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers["x-deepseek-key"]).toBe("sk-test");
  });

  it("映射官方字段（评分/权威度/发布日期/站点）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dsResponse([ITEM])),
    );
    const [r] = await searchWeb("test", 3);
    expect(r.engine).toBe("deepseek");
    expect(r.score).toBe(2.4);
    expect(r.authority).toBe(3);
    expect(r.publishedAt).toContain("2026-11-01");
    expect(r.source).toBe("示例站");
    expect(r.description).toBe("长摘要内容");
  });

  it("rerank_score < 1.5 的低质结果被过滤；全低分时保留", async () => {
    const low = { ...ITEM, url: "https://low.com", rerank_score: 0.5 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dsResponse([ITEM, low])),
    );
    const mixed = await searchWeb("test", 5);
    expect(mixed.map((r) => r.url)).toEqual(["https://a.com/post"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dsResponse([low])),
    );
    const onlyLow = await searchWeb("test", 5);
    expect(onlyLow).toHaveLength(1);
  });

  it("时敏查询追加 after: 语法", async () => {
    let body: { query?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return dsResponse([ITEM]);
      }),
    );
    await searchWeb("今天最新 AI 新闻", 5);
    expect(body.query).toContain("after:");
  });

  it("searchFast / searchFastWithAnswer：answer 由官方摘要拼接", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dsResponse([ITEM])),
    );
    const fast = await searchFast("test", 4);
    expect(fast).toHaveLength(1);

    const withAnswer = await searchFastWithAnswer("test", 4);
    expect(withAnswer.results).toHaveLength(1);
    expect(withAnswer.answer).toContain("长摘要内容");
  });
});

describe("search · bilibili 站内源短 TTL", () => {
  it("含 bilibili 来源的缓存超过 30 分钟视为过期", () => {
    writeSearchCache("bili", {
      content: "x",
      article: "a",
      sources: [
        {
          title: "t",
          url: "https://www.bilibili.com/video/1",
          description: "",
          source: "bilibili.com",
          engine: "deepseek",
        },
      ],
    });
    const map = JSON.parse(localStorage.getItem("kimo_search_cache_v1")!);
    map.bili.time = Date.now() - 31 * 60 * 1000;
    localStorage.setItem("kimo_search_cache_v1", JSON.stringify(map));
    expect(readSearchCache("bili")).toBeNull();
  });

  it("含 bilibili 来源的缓存 20 分钟内仍有效", () => {
    writeSearchCache("bili2", {
      content: "x",
      article: "a",
      sources: [
        {
          title: "t",
          url: "https://www.bilibili.com/video/2",
          description: "",
          source: "bilibili.com",
          engine: "deepseek",
        },
      ],
    });
    const map = JSON.parse(localStorage.getItem("kimo_search_cache_v1")!);
    map.bili2.time = Date.now() - 20 * 60 * 1000;
    localStorage.setItem("kimo_search_cache_v1", JSON.stringify(map));
    expect(readSearchCache("bili2")?.cached).toBe(true);
  });

  it("非 bilibili 来源保持 1 小时 TTL（40 分钟仍有效）", () => {
    writeSearchCache("normal", { content: "x", article: "a", sources: [] });
    const map = JSON.parse(localStorage.getItem("kimo_search_cache_v1")!);
    map.normal.time = Date.now() - 40 * 60 * 1000;
    localStorage.setItem("kimo_search_cache_v1", JSON.stringify(map));
    expect(readSearchCache("normal")?.cached).toBe(true);
  });

  it("writeSearchCache 写入后同查询可命中（含 loading 标记）", () => {
    writeSearchCache("hello", { content: "内容" });
    const hit = readSearchCache("hello");
    expect(hit?.content).toBe("内容");
    expect(hit?.cached).toBe(true);
  });
});

describe("search · 缓存卡死恢复（loading 永不过期 bug）", () => {
  it("loading 卡死超过 5 分钟 → readSearchCache 返回 null", () => {
    writeSearchCache("stuck", { loading: true });
    const map = JSON.parse(localStorage.getItem("kimo_search_cache_v1")!);
    map.stuck.loadingAt = Date.now() - 6 * 60 * 1000;
    map.stuck.time = Date.now() - 6 * 60 * 1000;
    localStorage.setItem("kimo_search_cache_v1", JSON.stringify(map));
    expect(readSearchCache("stuck")).toBeNull();
  });

  it("刚进入 loading 的条目仍返回 loading（并发去重）", () => {
    writeSearchCache("busy", { loading: true });
    const hit = readSearchCache("busy");
    expect(hit?.loading).toBe(true);
    expect(hit?.cached).toBe(false);
  });

  it("writeSearchCache 进入 loading 记录 loadingAt，完成时清除", () => {
    writeSearchCache("x1", { loading: true });
    let map = JSON.parse(localStorage.getItem("kimo_search_cache_v1")!);
    expect(map.x1.loadingAt).toBeGreaterThan(0);
    writeSearchCache("x1", { loading: false, content: "done" });
    map = JSON.parse(localStorage.getItem("kimo_search_cache_v1")!);
    expect(map.x1.loadingAt).toBeUndefined();
    expect(map.x1.content).toBe("done");
  });
});

describe("search · 查询类型/语言检测", () => {
  it("天气查询", () => {
    expect(detectQueryType("北京今天天气怎么样").weather).toBe(true);
  });

  it("新番查询", () => {
    expect(detectQueryType("2026年7月新番").anime).toBe(true);
  });

  it("新闻查询", () => {
    expect(detectQueryType("今天有什么科技新闻").news).toBe(true);
  });

  it("普通查询非 fresh", () => {
    expect(detectQueryType("React useEffect 用法").fresh).toBe(false);
  });

  it("语言检测（含多语言 ja/ko）", () => {
    expect(detectQueryLang("TypeScript 泛型")).toBe("zh");
    expect(detectQueryLang("TypeScript generics")).toBe("en");
    expect(detectQueryLang("2026年夏アニメ")).toBe("ja");
    expect(detectQueryLang("2026년 애니메이션")).toBe("ko");
  });
});

describe("search · 幻觉抑制（AI 兜底）", () => {
  it("searchAI 系统提示含「不要编造 URL」，空结果返回 []", async () => {
    localStorage.setItem(
      "kimo_ai_bots",
      JSON.stringify([
        { endpoint: "https://api.x.com/v1", apiKey: "k", model: "m" },
      ]),
    );
    let system = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        system = body.messages[0].content;
        return jsonResponse({
          choices: [{ message: { content: "[]" } }],
        });
      }),
    );
    const r = await searchAI("test", 5);
    expect(r).toEqual([]);
    expect(system).toContain("不要编造");
  });

  it("webSearchToArticle 系统提示含来源约束 + 抓取失败标注资料有限", async () => {
    localStorage.setItem(
      "kimo_ai_bots",
      JSON.stringify([
        {
          endpoint: "https://api.deepseek.com",
          apiKey: "sk-test",
          model: "deepseek-v4-flash",
        },
      ]),
    );
    let userMsg = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.startsWith("/api/deepseek/search")) return dsResponse([ITEM]);
        if (u.startsWith("/api/deepseek/fetch"))
          return jsonResponse({ title: "", content: "" }, 404);
        if (u.includes("/chat/completions")) {
          const body = JSON.parse(String(init?.body));
          userMsg = body.messages[1].content;
          return jsonResponse({
            choices: [{ message: { content: "# 标题\n\n正文" } }],
          });
        }
        return jsonResponse([]);
      }),
    );
    const { article } = await webSearchToArticle("测试主题", 3, [
      "https://blank.example.com",
    ]);
    expect(article).toContain("# 标题");
    expect(userMsg).toContain("资料有限");
  });
});

describe("search · isContentBlocked（违规内容友好兜底）", () => {
  it("400/403 + 内容策略关键词 → true", () => {
    expect(isContentBlocked(new Error("400 content policy violation"))).toBe(
      true,
    );
    expect(isContentBlocked(new Error("403 内容违规"))).toBe(true);
  });

  it("非违规错误 → false", () => {
    expect(isContentBlocked(new Error("500 server error"))).toBe(false);
    expect(isContentBlocked(new Error("网络错误"))).toBe(false);
  });
});

describe("search · fetchWebContent（DeepSeek Fetch + 会话内缓存）", () => {
  it("同一 URL 只抓取一次，第二次命中缓存", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/deepseek/fetch")) calls++;
        return jsonResponse({ title: "页面标题", content: "# 正文\n内容" });
      }),
    );
    const a = await fetchWebContent("https://example.com/a");
    const b = await fetchWebContent("https://example.com/a");
    expect(calls).toBe(1);
    expect(a.content).toContain("正文");
    expect(a.retrievalMethod).toBe("deepseek");
    expect(a.title).toBe("页面标题");
    expect(b.content).toBe(a.content);
  });

  it("空正文不缓存（允许下次重试）", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return jsonResponse({ title: "", content: "" });
      }),
    );
    await fetchWebContent("https://example.com/empty");
    await fetchWebContent("https://example.com/empty");
    expect(calls).toBe(2);
  });

  it("超过 maxChars 时截断并标记 truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ title: "t", content: "x".repeat(500) })),
    );
    const r = await fetchWebContent("https://example.com/long", 100);
    expect(r.truncated).toBe(true);
    expect(r.content).toHaveLength(100);
  });
});

describe("search · filterSensitiveResults（违规内容默默隐藏）", () => {
  const base = { description: "", source: "", engine: "deepseek" };

  it("命中明确违规词的结果被过滤（正常结果保留）", () => {
    const out = filterSensitiveResults([
      { ...base, title: "正常文章", url: "https://a.com" },
      { ...base, title: "赌博网站", url: "https://b.com" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://a.com");
  });

  it("全部违规 → 返回空（折叠卡不显示）", () => {
    expect(
      filterSensitiveResults([
        { ...base, title: "色情内容", url: "https://c.com" },
      ]),
    ).toEqual([]);
  });

  it("空数组/未违规 → 原样返回", () => {
    expect(filterSensitiveResults([])).toEqual([]);
    const ok = [{ ...base, title: "成人教育", url: "https://d.com" }];
    expect(filterSensitiveResults(ok)).toEqual(ok);
  });
});
