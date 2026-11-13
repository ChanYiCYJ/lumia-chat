import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  buildSearchQuery,
  deepseekErrorText,
  dsFetch,
  dsSearch,
  hasDeepseekKey,
  isDeepseekEndpoint,
  isQualityItem,
  authorityTier,
  resolveDeepseekCfg,
  setDeepseekKeyProvider,
} from "../deepseekSearch";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ITEM = {
  title: "标题",
  url: "https://a.com",
  snippet: "s",
  summary: "sum",
  content: "body",
  site_name: "站点",
  date: "2026-11-01T00:00:00+00:00",
  authority: 3,
  rerank_score: 2.1,
};

beforeEach(() => {
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

describe("deepseekSearch · Key 解析", () => {
  it("识别 DeepSeek 端点", () => {
    expect(isDeepseekEndpoint("https://api.deepseek.com")).toBe(true);
    expect(isDeepseekEndpoint("https://api.moonshot.cn/v1")).toBe(false);
    expect(isDeepseekEndpoint(undefined)).toBe(false);
  });

  it("注入的生效配置优先", () => {
    expect(resolveDeepseekCfg()).toEqual({
      endpoint: "https://api.deepseek.com",
      apiKey: "sk-test",
    });
    expect(hasDeepseekKey()).toBe(true);
  });

  it("未注入时回落 localStorage 机器人配置", () => {
    setDeepseekKeyProvider(null);
    localStorage.setItem(
      "kimo_ai_bots",
      JSON.stringify([
        { endpoint: "https://api.deepseek.com", apiKey: "sk-bot" },
      ]),
    );
    expect(resolveDeepseekCfg()?.apiKey).toBe("sk-bot");
  });

  it("完全没有 Key 时返回 null", () => {
    setDeepseekKeyProvider(null);
    expect(resolveDeepseekCfg()).toBeNull();
    expect(hasDeepseekKey()).toBe(false);
  });
});

describe("deepseekSearch · dsSearch", () => {
  it("成功返回 results", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [ITEM] }));
    const r = await dsSearch("关键词", { fetchImpl: fetchMock as never });
    expect(r.items).toHaveLength(1);
    expect(r.error).toBeUndefined();
  });

  it("未配置 Key 时不发请求并给出提示", async () => {
    setDeepseekKeyProvider(null);
    const fetchMock = vi.fn();
    const r = await dsSearch("关键词", { fetchImpl: fetchMock as never });
    expect(r.items).toEqual([]);
    expect(r.error).toContain("DeepSeek API Key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空 query 直接返回（不计费）", async () => {
    const fetchMock = vi.fn();
    const r = await dsSearch("   ", { fetchImpl: fetchMock as never });
    expect(r.items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401 不重试，返回 Key 无效提示", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: "invalid key" } }, 401),
    );
    const r = await dsSearch("q", { fetchImpl: fetchMock as never });
    expect(r.status).toBe(401);
    expect(r.error).toContain("Key 无效");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("402 提示余额不足", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 402));
    const r = await dsSearch("q", { fetchImpl: fetchMock as never });
    expect(r.error).toContain("余额不足");
  });

  it("429 退避重试一次", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ results: [ITEM] }));
    const r = await dsSearch("q", { fetchImpl: fetchMock as never });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.items).toHaveLength(1);
  });

  it("网络异常重试一次后返回错误", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = await dsSearch("q", { fetchImpl: fetchMock as never });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.error).toContain("搜索请求失败");
  });

  it("相同 query 并发只发一次请求", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [ITEM] }));
    const [a, b] = await Promise.all([
      dsSearch("并发", { fetchImpl: fetchMock as never }),
      dsSearch("并发", { fetchImpl: fetchMock as never }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.items).toEqual(b.items);
  });

  it("过滤无 url 的异常条目", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ results: [ITEM, { title: "no url" }] }),
    );
    const r = await dsSearch("q", { fetchImpl: fetchMock as never });
    expect(r.items).toHaveLength(1);
  });
});

describe("deepseekSearch · dsFetch", () => {
  it("返回 Markdown 正文 + 标题", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ title: "页面", content: "# 正文" }),
    );
    const r = await dsFetch("https://example.com", {
      fetchImpl: fetchMock as never,
    });
    expect(r.title).toBe("页面");
    expect(r.content).toBe("# 正文");
  });

  it("非 http(s) 地址直接拒绝", async () => {
    const fetchMock = vi.fn();
    const r = await dsFetch("file:///etc/passwd", {
      fetchImpl: fetchMock as never,
    });
    expect(r.error).toContain("无效");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404（站点不可抓取）返回错误说明", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    const r = await dsFetch("https://example.com/x", {
      fetchImpl: fetchMock as never,
    });
    expect(r.content).toBe("");
    expect(r.status).toBe(404);
  });
});

describe("deepseekSearch · 查询语法与评分", () => {
  it("buildSearchQuery 追加 lang / after / site 语法", () => {
    expect(buildSearchQuery("React 教程", { lang: "zh" })).toBe(
      "React 教程 lang:zh,en",
    );
    expect(buildSearchQuery("AI 新闻", { fresh: true, year: 2026 })).toContain(
      "after:2026",
    );
    expect(buildSearchQuery("hooks", { official: true })).toContain("site:");
    // 已有语法不重复追加
    expect(buildSearchQuery("x lang:en", { lang: "zh" })).toBe("x lang:en");
  });

  it("超长查询回退为原始查询截断（不破坏 128 字符限制）", () => {
    const long = "a".repeat(200);
    const out = buildSearchQuery(long, { lang: "zh" });
    expect(out.length).toBeLessThanOrEqual(128);
  });

  it("isQualityItem / authorityTier", () => {
    expect(isQualityItem({ rerank_score: 1.5 })).toBe(true);
    expect(isQualityItem({ rerank_score: 1.49 })).toBe(false);
    expect(isQualityItem({})).toBe(true);
    expect(authorityTier({ authority: 4 })).toBe("high");
    expect(authorityTier({ authority: 2 })).toBe("medium");
    expect(authorityTier({ authority: -1 })).toBe("low");
  });

  it("deepseekErrorText 覆盖常见状态码", () => {
    expect(deepseekErrorText(401)).toContain("Key 无效");
    expect(deepseekErrorText(402)).toContain("余额不足");
    expect(deepseekErrorText(429)).toContain("限速");
    expect(deepseekErrorText(504)).toContain("服务异常");
    expect(deepseekErrorText(undefined, "自定义错误")).toBe("自定义错误");
  });
});
