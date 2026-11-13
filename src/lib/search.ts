/**
 * 网络搜索 & 网页抓取模块
 *
 * 数据源：DeepSeek 官方搜索（https://api-docs.deepseek.com/zh-cn/guides/search/）
 *   - Search API：一次请求返回结构化结果（含 rerank_score / authority / date / summary / 正文）
 *   - Fetch API ：按 URL 抓取网页正文（Markdown）
 *   - 均由 Worker `/api/deepseek/*` 代理转发（Key 走请求头，规避浏览器 CORS 与 Key 泄漏）
 *
 * 架构：
 *   - SearchResult 统一类型（保留 DeepSeek 的评分/权威度/发布时间）
 *   - searchWeb() 单源搜索；失败回退 searchAI（模型知识兜底）
 *   - webSearch() 返回格式化文本（向后兼容）
 *   - fetchWebContent() / fetchWebpage() 正文抓取（DeepSeek Fetch）
 *   - searchWithCache() View 面板入口（缓存 + 增量写）
 *
 * 计费：Search / Fetch 各 5 元 / 1000 次成功请求（与 count 无关），
 * 因此正文优先用 Search 的 need_content:true 一次取回，避免逐条 Fetch。
 */

import { cacheTtlMs, todayStr } from "./searchApi";
import { resolveMaxTokens } from "./providerPresets";
import {
  animeSearchKeyword,
  imageSearch,
  imageUrls,
  inferImageCategory,
} from "./imageApi";
import {
  buildSearchQuery,
  dsFetch,
  dsSearch,
  DS_MAX_COUNT,
  type DsSearchItem,
} from "./deepseekSearch";

// ======================== 类型定义 ========================

/** 搜索结果 */
export interface SearchResult {
  title: string;
  url: string;
  description: string;
  /** 来源站点名 */
  source: string;
  /** 数据源（现固定为 deepseek；历史缓存可能是旧引擎名） */
  engine: string;
  /** DeepSeek 排序分 0~3（>=1.5 为优质结果） */
  score?: number;
  /** DeepSeek 权威性 0~4（>=3 极权威） */
  authority?: number;
  /** 发布时间（UTC RFC3339） */
  publishedAt?: string;
  /** 长摘要（600~800 字，适合给模型阅读） */
  summary?: string;
  /** 网页正文（need_content 时返回） */
  content?: string;
  /** 站点名称 */
  siteName?: string;
  /** 站点图标 URL */
  icon?: string;
}

/** 网页抓取结果 */
export interface FetchWebContentResult {
  url: string;
  finalUrl: string;
  contentType: string;
  title: string;
  /** 抓取方式：deepseek(官方 Fetch) | direct(浏览器直连) | proxy(旧代理) */
  retrievalMethod: "deepseek" | "direct" | "proxy";
  truncated: boolean;
  content: string;
  /** 封面图（DeepSeek 不提供，保留字段兼容旧缓存） */
  ogImage?: string;
  /** 正文图片列表（DeepSeek 不提供，保留字段兼容旧缓存） */
  images?: string[];
}

/** 搜索引擎执行器签名 */
export type SearchEngineExecutor = (
  query: string,
  limit: number,
) => Promise<SearchResult[]>;

/** 多引擎搜索结果 */
export interface MultiSearchResult {
  query: string;
  engines: string[];
  totalResults: number;
  results: SearchResult[];
  partialFailures: Array<{ engine: string; message: string }>;
}

// ======================== 查询类型 / 语言检测 ========================

/** 查询类型：用于决定引擎组合（时敏/天气/新番/新闻走专用引擎） */
export interface QueryType {
  /** 需要最新/实时数据（天气、新番、新闻等） */
  fresh: boolean;
  /** 天气查询 */
  weather: boolean;
  /** 新番/番剧查询 */
  anime: boolean;
  /** 新闻/资讯查询 */
  news: boolean;
}

const WEATHER_RE =
  /天气|气温|温度|下雨|降水|降雨|湿度|风力|台风|weather|forecast|temperature|rain|humidity|wind/i;
const ANIME_RE =
  /新番|本季|当季|番剧|夏番|冬番|春番|秋番|动漫新|anime|season|animation/i;
const NEWS_RE =
  /今天|今日|最新|新闻|突发|实时|刚刚|昨天|昨日|新作|上市|发布|发售|更新|近期|today|now|recent|latest|news|break/i;

/** 检测查询类型（天气/新番/新闻/其他），供引擎组合与深度判断 */
export function detectQueryType(q: string): QueryType {
  const s = q || "";
  const weather = WEATHER_RE.test(s);
  const anime = ANIME_RE.test(s);
  const news = NEWS_RE.test(s);
  return { fresh: weather || anime || news, weather, anime, news };
}

/**
 * 检测查询语言：中文/日文/韩文/英文（用于后端 mkt/locale 自适应）。
 * 多语言混合关键词时取主要语言：日文假名（平/片假名）→ ja；韩文谚文 → ko；中文汉字 → zh；其余 → en。
 * （日文汉字也在 CJK 区间，但含假名的日文查询优先判 ja）
 */
export function detectQueryLang(q: string): "zh" | "en" | "ja" | "ko" {
  const s = q || "";
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(s)) return "ja";
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(s)) return "ko";
  if (/[\u4e00-\u9fff]/.test(s)) return "zh";
  return "en";
}

// ======================== 工具函数 ========================

const MAX_CHARS_DEFAULT = 30000;
const FETCH_TIMEOUT_MS = 8000;

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 从 URL 提取域名作为 source */
function extractSource(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** 去重 URL */
function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

/** 按域名多样化：每站最多 perDomain 条，让结果覆盖多个不同网站（避免只爬单一站点） */
function diversifyByDomain(
  results: SearchResult[],
  max: number,
  perDomain = 2,
): SearchResult[] {
  const hostCount: Record<string, number> = {};
  const out: SearchResult[] = [];
  for (const r of results) {
    let host = r.source || "";
    try {
      host = new URL(r.url).hostname.replace(/^www\./i, "");
    } catch {}
    // bilibili 站内源时效性/相关性优先，放宽每站条数（避免被"每站≤perDomain"稀释）
    const cap = host.includes("bilibili.com") ? 4 : perDomain;
    if ((hostCount[host] || 0) >= cap) continue;
    hostCount[host] = (hostCount[host] || 0) + 1;
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

// ======================== AI 配置读取 ========================

function getAICfg() {
  try {
    const bots = JSON.parse(localStorage.getItem("kimo_ai_bots") || "[]") as {
      endpoint: string;
      apiKey: string;
      model: string;
    }[];
    if (bots.length) return bots[0];
    const botCfg = JSON.parse(
      localStorage.getItem("kimo_ai_bot_config") || "null",
    );
    if (botCfg?.endpoint) return botCfg;
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("kimo_ai_local_")) continue;
      const lc = JSON.parse(localStorage.getItem(k) || "null");
      if (lc?.endpoint && lc?.apiKey && lc?.model) {
        return { endpoint: lc.endpoint, apiKey: lc.apiKey, model: lc.model };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ======================== 引擎 1：后端搜索 ========================

// ======================== 网页搜索：DeepSeek Search API ========================

/** 最近一次搜索失败原因（供 UI 提示「未配置 Key / 余额不足 / 限速」等） */
let lastSearchError = "";
export function getLastSearchError(): string {
  return lastSearchError;
}
export function clearLastSearchError(): void {
  lastSearchError = "";
}

/** DeepSeek 原始条目 → 统一 SearchResult（保留评分/权威度/发布时间/正文） */
function toResults(items: DsSearchItem[]): SearchResult[] {
  const mapped: SearchResult[] = [];
  for (const it of items) {
    const url = (it.url || "").trim();
    if (!url) continue;
    mapped.push({
      title: (it.title || "").trim(),
      url,
      description: (it.summary || it.snippet || "").trim(),
      source: (it.site_name || "").trim() || extractSource(url),
      engine: "deepseek",
      score: typeof it.rerank_score === "number" ? it.rerank_score : undefined,
      authority:
        typeof it.authority === "number" && it.authority >= 0
          ? it.authority
          : undefined,
      publishedAt: it.date || undefined,
      summary: it.summary || undefined,
      content: it.content || undefined,
      siteName: it.site_name || undefined,
      icon: it.site_icon || undefined,
    });
  }
  const unique = dedupeByUrl(mapped);
  // 官方口径：rerank_score < 1.5 为低质结果；若全部低于阈值则保留原结果（避免"搜到却全丢"）
  const quality = unique.filter((r) => (r.score ?? 2) >= 1.5);
  return quality.length ? quality : unique;
}

/**
 * 网页搜索（DeepSeek 自研搜索引擎，经 Worker `/api/deepseek/search` 代理）。
 *
 * - 按「成功请求次数」计费（与 count 无关）→ 一次取满所需条数，不做多引擎混排
 * - 查询语法：时敏话题追加 `after:<年>`，多语言查询追加 `lang:xx`
 * - 失败返回 []，由调用方回退 searchAI（AI 知识兜底）
 */
export async function searchWeb(
  query: string,
  limit: number,
  opts: {
    needContent?: boolean;
    oriQuestion?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SearchResult[]> {
  const type = detectQueryType(query);
  const lang = detectQueryLang(query);
  const q = buildSearchQuery(query, { fresh: type.fresh, lang });
  if (!q) return [];
  const res = await dsSearch(q, {
    count: Math.max(1, Math.min(limit, DS_MAX_COUNT)),
    needContent: !!opts.needContent,
    oriQuestion: opts.oriQuestion,
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
  });
  lastSearchError = res.error || "";
  return toResults(res.items).slice(0, limit);
}

/** @deprecated 旧名（多引擎时代）；搜索已统一为 DeepSeek，保留别名避免大面积改动 */
export const searchBackend = searchWeb;

// ======================== 兜底：AI 生成搜索结果 ========================

export async function searchAI(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const cfg = getAICfg();
  if (!cfg?.endpoint || !cfg?.apiKey || !cfg?.model) return [];
  // 推理模型（deepseek-v4-flash 等）会先消耗 token 在思考上：加大 max_tokens 且内容为空时重试一次，
  // 避免「思考占满 token → content 空 → 搜索兜底也空 → 重答不触发」的静默失败
  const tryOnce = async (): Promise<string> => {
    try {
      const res = await fetchWithTimeout(
        cfg.endpoint.replace(/\/+$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + cfg.apiKey,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              {
                role: "system",
                content:
                  "你是搜索引擎助手。今天是 " +
                  todayStr() +
                  "。用户查询后，请以JSON数组格式返回搜索结果，每条包含title、url、description字段。" +
                  "**只能输出你非常有把握真实存在、且与查询直接相关的网站 URL（如知名官网/百科/主流媒体域名）；若不确定某个 URL 是否真实存在，绝对不要编造或拼凑看似合理的链接**。" +
                  "最多返回" +
                  limit +
                  "条；若确实找不到可靠来源，请返回空数组 []。只返回JSON数组，不要其他内容。",
              },
              { role: "user", content: "查询：" + query },
            ],
            temperature: 0.3,
            max_tokens: resolveMaxTokens(cfg.model, 1200),
            stream: false,
          }),
        },
      );
      if (!res.ok) return "";
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return (j.choices?.[0]?.message?.content || "").trim();
    } catch {
      return "";
    }
  };
  const parseRaw = (raw: string): SearchResult[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, limit).map((it: Record<string, string>) => ({
          title: it.title || "",
          url: it.url || "",
          description: it.description || "",
          source: extractSource(it.url || ""),
          engine: "ai",
        }));
      }
    } catch {
      /* fall through */
    }
    return parseTextResults(raw, limit).map((r) => ({ ...r, engine: "ai" }));
  };
  let raw = await tryOnce();
  const first = parseRaw(raw);
  if (first.length > 0) return first;
  // 首次为空（content 空 / 模型返回空数组）→ 重试一次再兜底
  raw = await tryOnce();
  return parseRaw(raw);
}

function parseTextResults(raw: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const items = raw
    .split(/\n(?=(?:-\s|\d+[.、)]\s))/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const it of items) {
    if (results.length >= limit) break;
    let body = it.replace(/^(?:-\s|\d+[.、)]\s+)/, "").replace(/\*\*/g, "");
    const md = body.match(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/);
    const paren = body.match(/\(?(https?:\/\/[^\s)\]】>,;]+)/);
    let title = "";
    let url = "";
    if (md) {
      title = md[1].trim();
      url = md[2].replace(/[)\]】>]+$/, "");
      body = body.replace(/\[[^\]]*\]\(https?:\/\/[^\s)]+\)/, " ");
    } else if (paren) {
      url = paren[1];
      body = body.replace(/\(?https?:\/\/[^\s)\]】>,;]+\)?/, " ");
    }
    const lines = body
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const first = lines.shift() || "";
    if (!title) title = first.replace(/[\s()）【】\[\]—–-]+$/g, "").trim();
    const desc = lines.join(" ").replace(/\s+/g, " ").trim();
    if (title || url) {
      results.push({
        title: title || url,
        url: url || "",
        description: desc.slice(0, 300),
        source: extractSource(url),
        engine: "ai",
      });
    }
  }
  return results;
}

/** 搜索 + 直接答案（answer 由官方长摘要拼接，不额外调用模型） */
export interface SearchAnswerResult {
  results: SearchResult[];
  /** 官方摘要拼接的直接答案（注入 AI 上下文可显著提升准确度） */
  answer: string;
}

/**
 * Auto 模式联网搜索快路径：单次 DeepSeek 搜索（不取正文，短超时优先速度）。
 * 与完整搜索同一数据源与计费口径，仅缩减等待时间。
 */
export async function searchFast(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  return searchWeb(query, limit, { timeoutMs: 12000 });
}

/**
 * Auto 模式联网搜索专属路径：一次搜索 + 官方摘要拼接的直接答案。
 * answer 注入 AI 上下文让回答更准（DeepSeek 结果自带 600~800 字 summary）。
 */
export async function searchFastWithAnswer(
  query: string,
  limit: number,
): Promise<SearchAnswerResult> {
  const results = await searchWeb(query, limit, { timeoutMs: 12000 });
  const answer = results
    .slice(0, 3)
    .map((r) => (r.summary || r.description || "").trim())
    .filter(Boolean)
    .join("\n\n");
  return { results, answer };
}

/**
 * 判断 AI 请求错误是否为「内容安全/违规拒绝」。
 * 命中（400/403/422 + 内容安全关键词）时前端用友好提示兜底，避免用户看到"错误：…"红字。
 * （搜索/回答触及违规、敏感内容时，模型/网关常返回 400/403 内容策略错误）
 */
const CONTENT_BLOCK_RE =
  /content.?policy|moderation|safety|inappropriate|blocked|政治|色情|暴力|违法|违规|敏感|审核|不当|不适宜/i;
export function isContentBlocked(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err ?? "");
  return /(400|403|422)/.test(s) && CONTENT_BLOCK_RE.test(s);
}

/**
 * 搜索结果敏感内容过滤：标题/描述/URL 命中明确违规词（色情/赌博/毒品/违法等）的条目
 * 直接过滤掉——auto 折叠结果卡里违规内容「默默隐藏」，不展示也不外跳。
 * 仅用明确的违规词，避免误伤正常内容（如「成人教育」「暴力美学」等）。
 */
const SENSITIVE_RE =
  /(色情|情色|裸体|裸照|黄片|黄色网站|成人电影|成人视频|av资源|伦理片|大尺度|赌博|博彩|赌场|线上赌|毒品|冰毒|大麻|海洛因|可卡因|违禁品|非法集资|传销|邪教|血腥|恐怖袭击|枪支弹药)/i;
export function filterSensitiveResults(
  results: SearchResult[],
): SearchResult[] {
  return (results || []).filter((r) => {
    const hay = `${r.title || ""} ${r.description || ""} ${r.url || ""}`;
    return !SENSITIVE_RE.test(hay);
  });
}

// ======================== 抓取缓存（view 提速：同一批来源只抓一次） ========================

const FETCH_CACHE_MAX = 50;
const FETCH_CACHE_TTL = 5 * 60 * 1000;
const fetchCache = new Map<
  string,
  { res: FetchWebContentResult; ts: number }
>();

/**
 * 网页抓取（带会话内缓存）：webSearchWithContent 与 webSearchToArticle 会串行抓取同一批
 * 来源 URL（阶段1 content + 阶段2 文章），缓存命中直接复用，省去重复抓取耗时（view 提速）。
 * 仅缓存成功且非空结果（失败不缓存，允许下次重试）。
 */
export async function fetchWebContent(
  url: string,
  maxChars: number = MAX_CHARS_DEFAULT,
): Promise<FetchWebContentResult> {
  const u = url.trim();
  try {
    const hit = fetchCache.get(u);
    if (hit && Date.now() - hit.ts < FETCH_CACHE_TTL) return hit.res;
  } catch {
    /* ignore */
  }
  const res = await fetchWebContentDs(u, maxChars);
  if (res.content) {
    try {
      if (fetchCache.size >= FETCH_CACHE_MAX) {
        const oldest = [...fetchCache.entries()].sort(
          (a, b) => a[1].ts - b[1].ts,
        )[0];
        if (oldest) fetchCache.delete(oldest[0]);
      }
      fetchCache.set(u, { res, ts: Date.now() });
    } catch {
      /* ignore */
    }
  }
  return res;
}

/** 正文抓取：DeepSeek Fetch API（返回 Markdown，无需再解析 HTML） */
async function fetchWebContentDs(
  url: string,
  maxChars: number,
): Promise<FetchWebContentResult> {
  const empty: FetchWebContentResult = {
    url,
    finalUrl: url,
    contentType: "",
    title: "",
    retrievalMethod: "deepseek",
    truncated: false,
    content: "",
  };
  if (!/^https?:\/\//i.test(url)) return empty;
  const r = await dsFetch(url);
  const content = (r.content || "").trim();
  if (!content) return { ...empty, title: r.title || "" };
  const truncated = content.length > maxChars;
  return {
    url,
    finalUrl: url,
    contentType: "text/markdown",
    title: r.title || "",
    retrievalMethod: "deepseek",
    truncated,
    content: truncated ? content.slice(0, maxChars) : content,
  };
}

// ======================== 引擎表 / 聚合搜索 ========================

export const SEARCH_ENGINES: Record<string, SearchEngineExecutor> = {
  deepseek: searchWeb,
  ai: searchAI,
};

export async function searchMulti(
  query: string,
  engines: string[] = ["deepseek"],
  limit: number = 10,
): Promise<MultiSearchResult> {
  const perEngineLimit = Math.max(
    3,
    Math.ceil(limit / Math.max(1, engines.length)),
  );
  const allResults: SearchResult[] = [];
  const partialFailures: MultiSearchResult["partialFailures"] = [];

  const settled = await Promise.allSettled(
    engines.map(async (name) => {
      const executor = SEARCH_ENGINES[name];
      if (!executor) {
        partialFailures.push({
          engine: name,
          message: `不支持的搜索引擎: ${name}`,
        });
        return [];
      }
      try {
        return await executor(query, perEngineLimit);
      } catch (e) {
        partialFailures.push({
          engine: name,
          message: e instanceof Error ? e.message : String(e),
        });
        return [];
      }
    }),
  );

  for (const s of settled) {
    if (s.status === "fulfilled") allResults.push(...s.value);
  }

  return {
    query,
    engines,
    totalResults: allResults.length,
    results: dedupeByUrl(allResults).slice(0, limit),
    partialFailures,
  };
}

export function formatResults(results: SearchResult[]): string {
  if (!results.length) return "- 未找到结果\n  请尝试更换关键词或确保AI已配置";
  return results
    .map((r) => `- ${r.title} (${r.url})\n  ${r.description.slice(0, 300)}`)
    .join("\n");
}

// ======================== 向后兼容：webSearch ========================

export async function webSearch(query: string): Promise<string> {
  const results = await searchWeb(query, 6);
  if (results.length) return formatResults(results);

  // AI 知识兜底（DeepSeek 未配置 / 余额不足 / 无结果时，让模型凭既有知识给出可核查线索）
  const ai = await searchAI(query, 6);
  if (ai.length) return formatResults(ai);

  return "- 未找到结果\n  请确保AI已配置，或尝试输入完整网址直接访问";
}

// ======================== 网页抓取 ========================

/** 抓取网页正文（DeepSeek Fetch API；失败返回空串，不抛错） */
export async function fetchWebpage(url: string): Promise<string> {
  const result = await fetchWebContent(url);
  return result.content;
}

/** 可用搜索数据源（现固定为 DeepSeek，AI 作兜底） */
export function getAvailableEngines(): string[] {
  return Object.keys(SEARCH_ENGINES);
}

// ======================== 搜索 + 多结果内容抓取 ========================

/**
 * 增强搜索：获取搜索结果列表，并对前 maxSources 个来源抓取正文内容。
 * 返回「搜索结果列表 + 各来源内容摘要」，供 AI 筛选综合多个资料后作答。
 *
 * 格式（供 AI 参考，标注来源便于引用）：
 *   【搜索结果】
 *   1. 标题 (url) — 描述
 *   ...
 *   【来源内容 · N 个】
 *   来源1 (url)：正文摘要...
 *   ...
 */
export async function webSearchWithContent(
  query: string,
  maxSources: number = 3,
  perSourceChars: number = 2500,
): Promise<string> {
  // DeepSeek 单次请求即返回结构化结果 + 正文（need_content:true），
  // 不必像多引擎时代那样再对每个来源逐条 Fetch（同价，但省 N 次往返）。
  const results = await searchWeb(query, Math.max(maxSources, 8), {
    needContent: true,
    oriQuestion: query,
  });
  let list = results;
  if (!list.length) {
    const ai = await searchAI(query, 6);
    if (ai.length) list = ai;
  }
  if (!list.length) return "";

  const out: string[] = ["【搜索结果】"];
  list.slice(0, 8).forEach((r, i) => {
    const meta = [r.publishedAt?.slice(0, 10), r.source]
      .filter(Boolean)
      .join(" · ");
    out.push(
      `${i + 1}. ${r.title} (${r.url})${meta ? ` — ${meta}` : ""}\n   ${(r.description || "").slice(0, 200)}`,
    );
  });

  // 正文缺失时用 Fetch 补齐（个别站点 Search 抓不到正文）
  const targets = diversifyByDomain(
    dedupeByUrl(list).filter((r) => /^https?:\/\//i.test(r.url)),
    maxSources,
    2,
  );
  if (targets.length) {
    const contents = await Promise.all(
      targets.map(async (t) => {
        const inline = (t.content || "").trim();
        if (inline) return { title: t.title, content: inline };
        const c = await fetchWebContent(t.url, perSourceChars);
        return { title: c.title || t.title, content: c.content };
      }),
    );
    out.push(`\n【来源内容 · ${targets.length} 个】`);
    contents.forEach((c, i) => {
      out.push(
        c.content
          ? `\n来源${i + 1} (${targets[i].url}${c.title ? " | " + c.title : ""})：\n${c.content.slice(0, perSourceChars)}`
          : `\n来源${i + 1} (${targets[i].url})：内容抓取失败或为空`,
      );
    });
  }

  return out.join("\n");
}

// ======================== AI 生成 markdown 文章（综合筛选） ========================

/**
 * 深度搜索 + AI 综合筛选 → 标准 markdown 文章（含标题/分节/列表/引用/图片/来源）。
 * 流程：
 *   1. DeepSeek Search（need_content）一次拿到结果 + 正文
 *   2. 正文缺失的来源用 DeepSeek Fetch 补齐
 *   3. 配图改用图片搜索（DeepSeek 搜索不返回图片）
 *   4. 调用 AI 按标准格式综合生成文章
 */
export async function webSearchToArticle(
  query: string,
  maxSources: number = 6,
  seedUrls: string[] = [],
): Promise<{ article: string; sources: SearchResult[] }> {
  const cfg = getAICfg();
  if (!cfg?.endpoint || !cfg?.apiKey || !cfg?.model) {
    return { article: "", sources: [] };
  }

  // 1) 来源：优先复用上游已搜到的 URL（searchWithCache 串行流程，避免重复搜索重复计费）
  const toSeed = (u: string): SearchResult => {
    let host = "";
    try {
      host = new URL(u).hostname.replace(/^www\./i, "");
    } catch {
      host = u;
    }
    return {
      title: host,
      url: u,
      description: "",
      source: host,
      engine: "seed",
    };
  };
  let results: SearchResult[] = dedupeByUrl(seedUrls.map(toSeed));
  if (results.length < 3) {
    const found = await searchWeb(query, Math.max(maxSources, 8), {
      needContent: true,
      oriQuestion: query,
    });
    results = dedupeByUrl([...results, ...found]);
  }
  if (results.length < 3) {
    const ai = await searchAI(query, 6);
    results = dedupeByUrl([...results, ...ai]);
  }
  if (!results.length) return { article: "", sources: results };

  // 2) 正文：优先用 Search 内联的 content，缺失再 Fetch 补齐（按域名多样化）
  const targets = diversifyByDomain(
    results.filter((r) => /^https?:\/\//i.test(r.url)),
    maxSources,
    2,
  );
  const fetched = await Promise.all(
    targets.map(async (t) => {
      let content = (t.content || "").trim();
      if (!content) {
        const c = await fetchWebContent(t.url, 2200);
        content = c.content;
      }
      return { url: t.url, title: t.title, content };
    }),
  );

  const sourcesBlock = fetched
    .map(
      (f, i) =>
        `来源${i + 1} (${f.url} | ${f.title})：\n${(f.content || "").slice(0, 2200) || "(内容抓取失败或为空——资料有限，请勿编造该来源的细节，可明确标注资料不足)"}`,
    )
    .filter(Boolean)
    .join("\n\n");

  // 3) 配图：DeepSeek 搜索不返回图片 → 图片搜索补齐（动漫话题先转英文/罗马音标签）
  const imgs = await articleImages(query, results, cfg).catch(() => []);
  const imgsBlock = imgs.length
    ? "\n\n【可用配图】（插图时使用下列 URL）\n" +
      imgs.map((u) => `[图片]: ${u}`).join("\n")
    : "";

  // 4) AI 综合筛选生成标准 markdown 文章
  const sys =
    "你是资深内容研究员。今天是 " +
    todayStr() +
    "（检索时间）。基于用户提供的【搜索结果】与【来源内容】，筛选、交叉验证并综合多个资料，" +
    "用**标准 Markdown 格式**生成一篇结构化文章。要求：\n" +
    "- 首行 H1 标题（中文，概括主题）\n" +
    "- 开头 2-3 句引言摘要（加粗要点）\n" +
    "- 用 H2 分节（3-5 节），每节用有序/无序列表或短段落呈现关键信息\n" +
    "- 尽量引用具体数据/版本号/日期/数字/案例，内容充实有料，避免空泛套话；信息可能已过时请如实说明（资料检索于 " +
    todayStr() +
    "）\n" +
    "- **来源约束（重要）：文章中的事实、数据、日期只能来自【来源内容】与【搜索结果】；来源未覆盖的信息绝对不要编造，明确标注『资料有限，未能核实』；禁止凭空编造来源 URL、机构名、版本号或数据**\n" +
    "- 若提供了【可用配图】（[图片]: URL），请把图片分布到文章各处（封面放 H1 标题后，其余每节各插 1 张），用 `![配图](图片URL)` 插入，不要编造图片地址\n" +
    "- 引用事实时用 `> 引用` 块，末尾附「参考来源」列表（Markdown 链接，只能列真实来源）\n" +
    "- 安全合规：若主题涉及成人/敏感/争议内容，仅做客观克制的信息介绍，绝不输出露骨、色情、暴力、仇恨或违法违规内容；资料不足时如实说明\n" +
    "- 只输出文章正文，不要额外说明";
  const userMsg = `查询主题：${query}\n\n【搜索结果】\n${results
    .slice(0, 10)
    .map(
      (r, i) =>
        `${i + 1}. ${r.title} (${r.url})${r.engine === "ai" ? "（AI 补充，未经抓取验证）" : ""}\n   ${r.description?.slice(0, 200)}`,
    )
    .join(
      "\n",
    )}${imgsBlock}\n\n【来源内容】\n${sourcesBlock || "(未能抓取到来源正文。不要编造来源内容与数据，请仅基于搜索结果条目的标题/摘要作有限作答，并在文末注明『资料有限，未能核实』)"}`;

  // AI 调用（推理模型可能把 token 用尽在思考上，加大 max_tokens 并在 content 为空时重试一次）
  let article = "";
  const tryGenerate = async () => {
    try {
      const res = await fetchWithTimeout(
        cfg.endpoint.replace(/\/+$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + cfg.apiKey,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userMsg },
            ],
            temperature: 0.5,
            max_tokens: 4000,
            stream: false,
          }),
        },
        60000,
      );
      if (!res.ok) return "";
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return (j.choices?.[0]?.message?.content || "").trim();
    } catch {
      return "";
    }
  };
  article = await tryGenerate();
  if (!article) article = await tryGenerate();

  // 5) 补图兜底：AI 漏图时，封面插 H1 后 + 从最后一个 H2 往前各插 1 张（最多 3 张）
  if (article && imgs.length) {
    if (!article.includes("![") && /^#/.test(article)) {
      const nl = article.indexOf("\n");
      article =
        nl > 0
          ? article.slice(0, nl) +
            "\n\n![配图](" +
            imgs[0] +
            ")\n" +
            article.slice(nl)
          : article + "\n\n![配图](" + imgs[0] + ")";
    }
    const used = article.split("![").length - 1;
    const h2s = [...article.matchAll(/^##\s.+$/gm)].map((m) => m.index!);
    let added = 0;
    for (
      let k = h2s.length - 1;
      k >= 1 && added < 3 && used + added < imgs.length;
      k--
    ) {
      const img = imgs[used + added];
      article =
        article.slice(0, h2s[k]) +
        "\n\n![配图](" +
        img +
        ")\n" +
        article.slice(h2s[k]);
      added++;
    }
  }
  return { article, sources: results };
}

/**
 * 文章配图：DeepSeek 搜索不返回图片，改用图片搜索（现有 wiki/DDG/Pixiv 链路）。
 * 动漫/二次元话题先把中文名转英文或罗马音标签，否则 Danbooru/Safebooru 命中率为 0。
 */
async function articleImages(
  query: string,
  results: SearchResult[],
  cfg: { endpoint: string; apiKey: string; model: string },
): Promise<string[]> {
  const category = inferImageCategory(query);
  let keyword = query;
  if (category === "anime") {
    keyword = await animeSearchKeyword(query, cfg);
  }
  const found = await imageSearch(keyword, category, 3);
  let urls = imageUrls(found, 3);
  if (!urls.length && keyword !== query) {
    urls = imageUrls(await imageSearch(query, category, 3), 3);
  }
  // 站点名兜底：用权威来源的域名做主题图（Wikimedia 常有对应条目图）
  if (!urls.length && results.length) {
    const host = results[0]?.source || "";
    if (host) urls = imageUrls(await imageSearch(host, "photo", 2), 2);
  }
  return urls;
}

// ======================== 搜索/文章历史缓存（避免重复生成） ========================

interface SearchCacheEntry {
  content: string;
  article: string;
  sources: SearchResult[];
  time: number;
  loading: boolean;
  /** 标记 loading 的时间戳：搜索被中断（关页/报错）时条目可能永久停在 loading，靠它判定过期并重试 */
  loadingAt?: number;
}

const SEARCH_CACHE_KEY = "kimo_search_cache_v1";
const SEARCH_CACHE_MAX = 30;
const SEARCH_CACHE_TTL = 60 * 60 * 1000; // 默认 1 小时（保证能获取当天信息，可在设置中调整）
/** loading 条目超过该时长视为"卡死"（搜索被中断），清理后允许重新搜索 */
const LOADING_STALE_MS = 5 * 60 * 1000;

function searchCacheKey(q: string): string {
  return q.trim().toLowerCase();
}

function loadSearchCache(): Record<string, SearchCacheEntry> {
  try {
    const r = JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || "{}");
    return r && typeof r === "object" ? r : {};
  } catch {
    return {};
  }
}

function saveSearchCache(map: Record<string, SearchCacheEntry>): void {
  try {
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* 忽略 */
  }
}

/** 读取缓存（生成中返回 loading 标记；过期自动清理） */
export function readSearchCache(
  query: string,
): (SearchCacheEntry & { cached: boolean }) | null {
  const map = loadSearchCache();
  const e = map[searchCacheKey(query)];
  if (!e) return null;
  // 生成中：返回 loading，不当作完成；但若卡死超时（搜索被中断）则清理，允许重新搜索
  if (e.loading) {
    const startedAt = e.loadingAt || e.time || 0;
    if (Date.now() - startedAt > LOADING_STALE_MS) {
      delete map[searchCacheKey(query)];
      saveSearchCache(map);
      return null;
    }
    return { ...e, cached: false, loading: true };
  }
  // 过期清理（TTL 默认 1 小时；bilibili 站内源时效性要求更高 → 30min）
  const hasBili = (e.sources || []).some((s) => {
    try {
      return /bilibili\.com/i.test(new URL(s.url || "").hostname);
    } catch {
      return false;
    }
  });
  const ttl = hasBili ? 30 * 60 * 1000 : cacheTtlMs() || SEARCH_CACHE_TTL;
  if (Date.now() - e.time > ttl) {
    delete map[searchCacheKey(query)];
    saveSearchCache(map);
    return null;
  }
  return { ...e, cached: true };
}

/** 写入缓存（保留最近 SEARCH_CACHE_MAX 条） */
export function writeSearchCache(
  query: string,
  entry: Partial<SearchCacheEntry>,
): void {
  const map = loadSearchCache();
  const key = searchCacheKey(query);
  const prev = map[key] || {};
  const merged: SearchCacheEntry = { ...prev, ...entry, time: Date.now() };
  // 进入 loading 时记录起始时间（用于"卡死"判定）；完成时清除
  if (entry.loading === true) merged.loadingAt = Date.now();
  else if (entry.loading === false) delete merged.loadingAt;
  map[key] = merged;
  // 限制条数：超限删最旧
  const keys = Object.keys(map);
  if (keys.length > SEARCH_CACHE_MAX) {
    keys
      .sort((a, b) => (map[a].time || 0) - (map[b].time || 0))
      .slice(0, keys.length - SEARCH_CACHE_MAX)
      .forEach((k) => delete map[k]);
  }
  saveSearchCache(map);
}

/** 清除某条缓存 */
export function clearSearchCache(query?: string): void {
  const map = loadSearchCache();
  if (query) delete map[searchCacheKey(query)];
  else {
    Object.keys(map).forEach((k) => delete map[k]);
  }
  saveSearchCache(map);
}

/** 从已抓取的搜索内容里提取来源 URL（供文章生成复用，避免并发重复搜索） */
function extractSourceUrls(content: string, max = 4): string[] {
  if (!content) return [];
  const urls: string[] = [];
  const re = /https?:\/\/[^\s)\]】>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) && urls.length < max) {
    const u = m[0].replace(/[)\]】>]+$/, "");
    if (/^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

/**
 * 带缓存的深度搜索 + AI 文章（供浏览面板使用）：
 * - 命中缓存直接返回（不重复生成）
 * - 未命中则搜索+抓取+AI 生成，完成后自动写入历史
 * - 生成中标记 loading，避免并发重复生成
 */
export type SearchWithCacheResult = {
  content: string;
  article: string;
  sources: SearchResult[];
  time: number;
  cached: boolean;
  loading: boolean;
  fresh: boolean;
};

export async function searchWithCache(
  query: string,
  opts: {
    maxSources?: number;
    perSourceChars?: number;
    /** 强制刷新：绕过缓存重新搜索 + 生成（实时更新用） */
    force?: boolean;
  } = {},
): Promise<SearchWithCacheResult> {
  // 非强制刷新时先查缓存
  if (!opts.force) {
    const hit = readSearchCache(query);
    // 命中缓存：有文章（或没有内容）直接返回；有内容但文章为空（上次生成失败）→ 补生成文章，
    // 避免空文章长期占位导致永远不生成
    if (hit && (hit.article || !hit.content)) {
      return { ...hit, loading: !!hit.loading, fresh: false };
    }
    if (hit) {
      writeSearchCache(query, { loading: true });
      try {
        const articleRes = await webSearchToArticle(
          query,
          opts.maxSources ?? 6,
          extractSourceUrls(hit.content, opts.maxSources ?? 6),
        );
        const entry: SearchCacheEntry = {
          content: hit.content,
          article: articleRes.article || "",
          sources:
            articleRes.sources?.length > 0 ? articleRes.sources : hit.sources,
          time: Date.now(),
          loading: false,
        };
        writeSearchCache(query, entry);
        return { ...entry, loading: false, cached: true, fresh: false };
      } catch {
        writeSearchCache(query, { loading: false });
        return { ...hit, loading: false, cached: true, fresh: false };
      }
    }
  }

  // 标记生成中（同关键词并发只生成一次）
  writeSearchCache(query, { loading: true });

  try {
    // 先抓内容，再复用其来源生成文章（串行：避免并发重复搜索被限流导致文章为空）
    const content = await webSearchWithContent(
      query,
      opts.maxSources ?? 5,
      opts.perSourceChars ?? 2200,
    );
    const articleRes = await webSearchToArticle(
      query,
      opts.maxSources ?? 6,
      extractSourceUrls(content, opts.maxSources ?? 6),
    );
    const entry: SearchCacheEntry = {
      content: content || "",
      article: articleRes.article || "",
      sources: articleRes.sources || [],
      time: Date.now(),
      loading: false,
    };
    writeSearchCache(query, entry);
    return { ...entry, loading: false, cached: false, fresh: true };
  } catch {
    writeSearchCache(query, { loading: false });
    return {
      content: "",
      article: "",
      sources: [],
      time: Date.now(),
      cached: false,
      loading: false,
      fresh: true,
    };
  }
}
