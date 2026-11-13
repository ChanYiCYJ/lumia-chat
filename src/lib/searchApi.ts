/**
 * 搜索相关时间工具
 * ------------------------------------------------------------------
 * 搜索数据源已统一为 DeepSeek Search API（见 deepseekSearch.ts），
 * 不再需要第三方平台（Tavily / SearXNG）的配置与连通性测试。
 * 本模块只保留与搜索共用的时间辅助函数（纯函数，便于单测）。
 */

/** 搜索/文章缓存时效（分钟）：默认 1 小时（保证能获取当天信息） */
export const SEARCH_CACHE_TTL_MIN = 60;

/** 缓存时效（毫秒） */
export function cacheTtlMs(): number {
  return SEARCH_CACHE_TTL_MIN * 60 * 1000;
}

/** 当天日期（YYYY-MM-DD），供提示词注入与文章时效标注 */
export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 时敏查询检测：含 今天/最新/新闻/发布 等词 → 需要当天/近期数据（触发 news 主题 + 短时窗） */
const FRESH_RE =
  /今天|今日|最新|新闻|突发|实时|刚刚|昨天|昨日|新作|上市|发布|发售|更新|近期|today|now|recent|latest|news|break/i;
export function isFreshQuery(q: string): boolean {
  return FRESH_RE.test(q || "");
}
