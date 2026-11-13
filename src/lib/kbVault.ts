/**
 * 知识库「Vault」能力（Obsidian 风格）：双链、标签、全文搜索片段、最近更新
 * ------------------------------------------------------------------
 * 纯函数，便于单测；UI 见 components/KbInsightPanel.tsx。
 * Notion 双向同步仍由 kbStore 负责，这里只提供可视化所需的链接/索引信息。
 */
import type { KbEntryRecord } from "./kb";

export interface WikiLink {
  target: string;
  alias?: string;
}

const WIKI_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const TAG_RE = /(^|[\s(（[【])#([\p{L}\p{N}_/-]{1,40})/gu;

/** 解析 [[页面]] / [[页面|别名]]（按 target 去重，忽略大小写） */
export function parseWikiLinks(content: string): WikiLink[] {
  const out: WikiLink[] = [];
  const seen = new Set<string>();
  WIKI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(content || ""))) {
    const target = m[1].trim();
    const key = target.toLowerCase();
    if (!target || seen.has(key)) continue;
    seen.add(key);
    out.push({ target, alias: m[2]?.trim() || undefined });
  }
  return out;
}

/** 解析 #标签（支持中英文、/ 与 -；排除 # 紧跟纯数字的序号） */
export function extractTags(content: string): string[] {
  const out = new Set<string>();
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(content || ""))) {
    const tag = m[2].trim();
    if (!tag || /^\d+$/.test(tag)) continue;
    out.add(tag);
  }
  return [...out];
}

export interface KbLinkRef {
  /** 目标条目 id（不存在 = 死链） */
  id?: string;
  name: string;
  exists: boolean;
}

export interface KbGraph {
  /** 当前笔记指向的其他笔记 */
  outgoing: KbLinkRef[];
  /** 指向当前笔记的其他笔记 */
  backlinks: KbLinkRef[];
  /** 当前笔记中指向不存在页面的链接 */
  dead: string[];
}

export function buildKbGraph(
  entries: KbEntryRecord[],
  active: KbEntryRecord,
): KbGraph {
  const byName = new Map<string, KbEntryRecord>();
  for (const e of entries) byName.set(e.name.trim().toLowerCase(), e);

  const outgoing: KbLinkRef[] = [];
  const dead: string[] = [];
  for (const link of parseWikiLinks(active.content)) {
    const hit = byName.get(link.target.toLowerCase());
    if (hit) {
      if (hit.id !== active.id)
        outgoing.push({ id: hit.id, name: hit.name, exists: true });
    } else {
      dead.push(link.target);
    }
  }

  const backlinks: KbLinkRef[] = [];
  const activeKey = active.name.trim().toLowerCase();
  for (const e of entries) {
    if (e.id === active.id) continue;
    if (
      parseWikiLinks(e.content).some(
        (l) => l.target.trim().toLowerCase() === activeKey,
      )
    ) {
      backlinks.push({ id: e.id, name: e.name, exists: true });
    }
  }
  return { outgoing, backlinks, dead };
}

export interface KbSearchHit {
  entry: KbEntryRecord;
  /** 命中片段（标题命中时为空） */
  snippet: string;
  score: number;
}

function snippetOf(content: string, q: string): string {
  const text = (content || "").replace(/\s+/g, " ");
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return "";
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + q.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** 全文搜索：标题命中权重更高；返回命中片段 */
export function searchKb(
  entries: KbEntryRecord[],
  query: string,
  limit = 20,
): KbSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: KbSearchHit[] = [];
  for (const e of entries) {
    const inTitle = e.name.toLowerCase().includes(q);
    const inContent = e.content.toLowerCase().includes(q);
    if (!inTitle && !inContent) continue;
    hits.push({
      entry: e,
      snippet: inContent ? snippetOf(e.content, q) : "",
      score: (inTitle ? 2 : 0) + (inContent ? 1 : 0),
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 最近更新（无 updatedAt，用 notionSyncedAt/createdAt 近似） */
export function recentKb(entries: KbEntryRecord[], limit = 5): KbEntryRecord[] {
  return [...entries]
    .sort(
      (a, b) =>
        (b.notionSyncedAt || b.createdAt) - (a.notionSyncedAt || a.createdAt),
    )
    .slice(0, limit);
}

export function allTags(
  entries: KbEntryRecord[],
): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of entries)
    for (const t of extractTags(e.content)) map.set(t, (map.get(t) || 0) + 1);
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
