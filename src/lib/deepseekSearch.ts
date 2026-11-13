// ===== DeepSeek 网页搜索 / 抓取（Search / Fetch API）=====
// 官方文档：https://api-docs.deepseek.com/zh-cn/guides/search/
//   POST https://api.deepseek.com/v1/tools/search  { query, count, ori_question?, need_content?, localization? }
//   POST https://api.deepseek.com/v1/tools/fetch   { url }
// 计费：Search / Fetch 按「成功请求次数」计费（各 5 元 / 1000 次），count 不影响单价。
// 因此正文优先用 Search 的 need_content:true 一次取回，避免为每个来源再发 Fetch。
//
// 架构：浏览器不直连 api.deepseek.com（无 CORS 放行），统一走 Worker 代理
//   POST /api/deepseek/search
//   POST /api/deepseek/fetch
// API Key 放请求头 `x-deepseek-key`（不进 URL，避免进日志/CDN 记录）。

/** 代理路径（Worker 转发到 api.deepseek.com/v1/tools/*） */
export const DS_SEARCH_PATH = "/api/deepseek/search";
export const DS_FETCH_PATH = "/api/deepseek/fetch";

/** Search 单次请求的 count 上限（官方 1~50） */
export const DS_MAX_COUNT = 50;
/** Search 超时（官方限速 100 QPS，正常 1~5s 返回） */
export const DS_SEARCH_TIMEOUT_MS = 20000;
/** Fetch 超时（官方限速 25 QPS） */
export const DS_FETCH_TIMEOUT_MS = 15000;

/** 搜索结果条目（字段含义见官方文档） */
export interface DsSearchItem {
  /** 排序分数 0~3，>=1.5 视为优质结果 */
  rerank_score?: number;
  title?: string;
  url?: string;
  /** 短摘要 100~200 字，适合前端展示 */
  snippet?: string;
  /** 长摘要 600~800 字，适合给模型阅读 */
  summary?: string;
  /** 网页正文（need_content 为 false 时为空串） */
  content?: string;
  site_name?: string | null;
  site_icon?: string | null;
  /** 发布时间（UTC RFC3339），未知为 null */
  date?: string | null;
  /** 权威性 0~4（-1 未知），>=3 为极权威 */
  authority?: number;
}

export interface DsSearchOptions {
  /** 返回条数 1~50，默认 10 */
  count?: number;
  /** 是否返回网页正文（默认 false） */
  needContent?: boolean;
  /** 触发搜索的用户原始问题（1~128 字），帮助理解搜索意图 */
  oriQuestion?: string;
  /** 用于优先返回本地化搜索结果的 IP 地址 */
  localization?: string;
  timeoutMs?: number;
  /** 测试注入 */
  fetchImpl?: typeof fetch;
}

export interface DsSearchResponse {
  items: DsSearchItem[];
  /** 命中的代理/上游错误（items 为空时给出原因） */
  error?: string;
  status?: number;
}

export interface DsFetchResponse {
  title: string;
  content: string;
  error?: string;
  status?: number;
}

/** 能提供 DeepSeek Key 的 AI 配置（endpoint 形如 https://api.deepseek.com） */
export interface DeepseekKeySource {
  endpoint: string;
  apiKey: string;
}

// ── Key 解析 ─────────────────────────────────────────────
// 优先用调用方注入的当前生效 AI 配置（AIChat 的 effCfg：本机自定义模型 / 站点机器人），
// 都没有时回落 localStorage 里的机器人配置（供后台脚本、测试使用）。

let injectedProvider: (() => DeepseekKeySource | null) | null = null;

/** 由 AIChat 注入「当前生效 AI 配置」读取器；传 null 取消注入 */
export function setDeepseekKeyProvider(
  fn: (() => DeepseekKeySource | null) | null,
): void {
  injectedProvider = fn;
}

/** endpoint 是否指向 DeepSeek（官方域名，兼容自建反代带 deepseek 字样） */
export function isDeepseekEndpoint(endpoint?: string): boolean {
  return /deepseek/i.test(endpoint || "");
}

function readStoredAiCfg(): DeepseekKeySource | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const bots = JSON.parse(
      localStorage.getItem("kimo_ai_bots") || "[]",
    ) as Array<{ endpoint?: string; apiKey?: string }>;
    if (Array.isArray(bots) && bots.length) {
      const b = bots[0];
      if (b?.endpoint && b?.apiKey) {
        return { endpoint: b.endpoint, apiKey: b.apiKey };
      }
    }
    const botCfg = JSON.parse(
      localStorage.getItem("kimo_ai_bot_config") || "null",
    ) as { endpoint?: string; apiKey?: string } | null;
    if (botCfg?.endpoint && botCfg?.apiKey) {
      return { endpoint: botCfg.endpoint, apiKey: botCfg.apiKey };
    }
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("kimo_ai_local_")) continue;
      const lc = JSON.parse(localStorage.getItem(k) || "null") as {
        endpoint?: string;
        apiKey?: string;
      } | null;
      if (lc?.endpoint && lc?.apiKey) {
        return { endpoint: lc.endpoint, apiKey: lc.apiKey };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 读取当前可用的 DeepSeek 凭据。
 * 只有 endpoint 指向 DeepSeek（官方域名或自建反代带 deepseek 字样）且填了 Key 才可用——
 * 用 Kimi/OpenAI 的 Key 去调 DeepSeek 搜索只会 401，因此直接判为不可用（联网走 AI 兜底）。
 */
export function resolveDeepseekCfg(): DeepseekKeySource | null {
  let cfg: DeepseekKeySource | null = null;
  try {
    cfg = injectedProvider ? injectedProvider() : null;
  } catch {
    cfg = null;
  }
  if (!cfg || !cfg.endpoint || !cfg.apiKey) cfg = readStoredAiCfg();
  if (!cfg || !cfg.apiKey || !isDeepseekEndpoint(cfg.endpoint)) return null;
  return cfg;
}

/** 是否已配置可用的 DeepSeek Key */
export function hasDeepseekKey(): boolean {
  return !!resolveDeepseekCfg()?.apiKey;
}

// ── 错误文案 ─────────────────────────────────────────────

/** 把 HTTP 状态/上游错误转成给用户看的中文说明 */
export function deepseekErrorText(status?: number, message?: string): string {
  const detail = (message || "").trim();
  switch (status) {
    case 400:
      return `搜索请求参数不合法${detail ? `（${detail}）` : ""}`;
    case 401:
    case 403:
      return "DeepSeek API Key 无效或已失效，请在设置 → 模型 API 中检查";
    case 402:
      return "DeepSeek 账号余额不足，搜索服务暂不可用";
    case 408:
      return "搜索请求超时，请稍后重试";
    case 413:
      return "请求内容过大";
    case 429:
      return "搜索请求过于频繁（已达 DeepSeek 限速），请稍后重试";
    case 500:
    case 504:
      return "DeepSeek 搜索服务异常，请稍后重试";
    default:
      if (status && status >= 500) return "DeepSeek 搜索服务异常，请稍后重试";
      return detail || "搜索服务暂不可用";
  }
}

function isRetryable(status?: number): boolean {
  return status === 408 || status === 429 || (!!status && status >= 500);
}

async function readErrorInfo(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string };
      if (typeof j.error === "string") return j.error;
      if (j.error?.message) return j.error.message;
    } catch {
      /* 非 JSON，原文返回 */
    }
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

// ── 并发去重（同一 query 同时只发一次请求，避免 agent/预搜重复计费）──

const inflightSearch = new Map<string, Promise<DsSearchResponse>>();

// ── 核心请求 ─────────────────────────────────────────────

async function postJson(
  path: string,
  key: string,
  body: unknown,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-deepseek-key": key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调用 DeepSeek Search（经 Worker 代理）。
 * 不抛错：失败时返回 `{ items: [], error }`，由调用方决定降级（AI 兜底等）。
 */
export async function dsSearch(
  query: string,
  opts: DsSearchOptions = {},
): Promise<DsSearchResponse> {
  const q = (query || "").trim().slice(0, 128);
  if (!q) return { items: [], error: "搜索关键词为空" };

  const cfg = resolveDeepseekCfg();
  if (!cfg) {
    return {
      items: [],
      error: "未配置 DeepSeek API Key（联网搜索复用模型 API 配置）",
    };
  }

  const count = Math.max(1, Math.min(DS_MAX_COUNT, opts.count ?? 10));
  const needContent = !!opts.needContent;
  const body: Record<string, unknown> = {
    query: q,
    count,
    need_content: needContent,
  };
  const ori = (opts.oriQuestion || "").trim().slice(0, 128);
  if (ori) body.ori_question = ori;
  if (opts.localization) body.localization = opts.localization;

  const dedupeKey = JSON.stringify(body);
  const existing = inflightSearch.get(dedupeKey);
  if (existing) return existing;

  const run = async (): Promise<DsSearchResponse> => {
    const fetchImpl = opts.fetchImpl || fetch;
    const timeoutMs = opts.timeoutMs ?? DS_SEARCH_TIMEOUT_MS;
    let lastStatus: number | undefined;
    let lastMsg = "";
    // 408/429/5xx 退避重试一次（官方建议）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await postJson(
          DS_SEARCH_PATH,
          cfg.apiKey,
          body,
          timeoutMs,
          fetchImpl,
        );
        if (!res.ok) {
          lastStatus = res.status;
          lastMsg = await readErrorInfo(res);
          if (attempt === 0 && isRetryable(res.status)) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          return {
            items: [],
            status: lastStatus,
            error: deepseekErrorText(lastStatus, lastMsg),
          };
        }
        const json = (await res.json().catch(() => null)) as {
          results?: DsSearchItem[];
        } | null;
        const items = Array.isArray(json?.results) ? json.results : [];
        return {
          items: items.filter((it) => !!it && typeof it.url === "string"),
        };
      } catch (e) {
        lastMsg = String((e as Error)?.message || e);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        return { items: [], error: `搜索请求失败：${lastMsg}` };
      }
    }
    return {
      items: [],
      status: lastStatus,
      error: deepseekErrorText(lastStatus, lastMsg),
    };
  };

  const promise = run().finally(() => inflightSearch.delete(dedupeKey));
  inflightSearch.set(dedupeKey, promise);
  return promise;
}

/** 抓取单个网页正文（Markdown），经 Worker 代理。失败返回空 content + error。 */
export async function dsFetch(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DsFetchResponse> {
  const target = (url || "").trim();
  if (!/^https?:\/\//i.test(target)) {
    return { title: "", content: "", error: "无效的网页地址" };
  }
  const cfg = resolveDeepseekCfg();
  if (!cfg) {
    return { title: "", content: "", error: "未配置 DeepSeek API Key" };
  }
  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await postJson(
      DS_FETCH_PATH,
      cfg.apiKey,
      { url: target },
      opts.timeoutMs ?? DS_FETCH_TIMEOUT_MS,
      fetchImpl,
    );
    if (!res.ok) {
      const msg = await readErrorInfo(res);
      return {
        title: "",
        content: "",
        status: res.status,
        error: deepseekErrorText(res.status, msg),
      };
    }
    const j = (await res.json().catch(() => null)) as {
      title?: string;
      content?: string;
    } | null;
    return {
      title: (j?.title || "").trim(),
      content: (j?.content || "").trim(),
    };
  } catch (e) {
    return {
      title: "",
      content: "",
      error: `网页抓取失败：${String((e as Error)?.message || e)}`,
    };
  }
}

// ── 查询构造（利用官方搜索语法）─────────────────────────
// site: / -site: / -"短语" / "精确短语" / lang: / after: / before:

const LANG_SYNTAX: Record<string, string> = {
  zh: "lang:zh,en",
  en: "lang:en",
  ja: "lang:ja,en",
  ko: "lang:ko,en",
};

/**
 * 在原始查询上叠加官方搜索语法。
 * - fresh：时敏话题 → 追加 `after:<今年>`（DeepSeek 按发布时间过滤，比改写措辞稳妥）
 * - lang：限制结果语言（中文查询保留英文结果，避免漏掉一手资料）
 * - official：权威优先 → 指定优先站点
 */
export function buildSearchQuery(
  raw: string,
  opts: {
    fresh?: boolean;
    lang?: string;
    official?: boolean;
    year?: number;
  } = {},
): string {
  const base = (raw || "").replace(/\s+/g, " ").trim();
  if (!base) return "";
  const parts = [base];
  if (opts.lang && LANG_SYNTAX[opts.lang] && !/\blang:/i.test(base)) {
    parts.push(LANG_SYNTAX[opts.lang]);
  }
  if (opts.official && !/\bsite:/i.test(base)) {
    parts.push(
      "site:github.com OR site:developer.mozilla.org OR site:wikipedia.org",
    );
  }
  if (opts.fresh && !/\bafter:/i.test(base)) {
    const year = opts.year ?? new Date().getFullYear();
    parts.push(`after:${year}`);
  }
  const out = parts.join(" ").replace(/\s+/g, " ").trim();
  // 官方限制 128 字符：超长时丢弃语法后缀而非截断查询词
  return out.length <= 128 ? out : base.slice(0, 128);
}

/** 结果相对值：>=1.5 分视为优质（官方口径） */
export function isQualityItem(item: DsSearchItem): boolean {
  if (typeof item.rerank_score !== "number") return true;
  return item.rerank_score >= 1.5;
}

/** 结果权威性分档：>=3 极权威 / 2 可信 / 其余一般 */
export function authorityTier(item: DsSearchItem): "high" | "medium" | "low" {
  const a = typeof item.authority === "number" ? item.authority : -1;
  if (a >= 3) return "high";
  if (a >= 2) return "medium";
  return "low";
}
