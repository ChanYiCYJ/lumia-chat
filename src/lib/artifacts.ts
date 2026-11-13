/**
 * 每会话独立「产物（artifact）」数据层
 * ------------------------------------------------------------------
 * 产物 = 一次对话里被 AI 生成/引用的可复用内容：
 *  - article：联网搜索后生成的文章（原 View 单篇模型 → 现在是列表里的一项）
 *  - doc：AI 输出/优化后的文档正文（原 [EDIT:]）
 *  - search：一次搜索结果集（标题+来源，正文摘要）
 *  - kb：知识库条目快照（保存后仍以知识库为真相源，这里只是会话内索引）
 *  - image：图片搜索结果
 *  - note：AI 主动写入的笔记/摘要
 *
 * 存储：localStorage key `kimo_ai_artifacts_<pageId>`，结构 Record<sessionId, Artifact[]>。
 * 旧的 `kimo_search_cache_v1`（话题 → 文章）保留为底层缓存，不做破坏性迁移；
 * 本模块提供 `migrateArtifactsFromSearchCache` 幂等回填历史 View 文章。
 */

export type ArtifactKind =
  | "article"
  | "doc"
  | "search"
  | "web"
  | "kb"
  | "image"
  | "note";

/** 产物类型清单（筛选 chip / 工具枚举共用，保持展示顺序） */
export const ARTIFACT_KINDS: ArtifactKind[] = [
  "article",
  "search",
  "doc",
  "web",
  "kb",
  "image",
  "note",
];

export interface ArtifactSource {
  title: string;
  url: string;
}

/** Agent 面板浏览完成后交给 AIChat 落库的产物输入（View 合并进产物的入口） */
export interface BrowseArtifactInput {
  kind: "article" | "web";
  title: string;
  content: string;
  topic?: string;
  url?: string;
  sources?: ArtifactSource[];
}

export interface Artifact {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  /** 文章类产物的主题（搜索关键词），用于去重与再次检索 */
  topic?: string;
  /** 网页产物的原始地址（产物面板可切「网页预览 / 阅读模式」） */
  url?: string;
  content: string;
  sources?: ArtifactSource[];
  /** 关联的对话消息下标（工具卡点击定位用） */
  msgIdx?: number;
  createdAt: number;
  updatedAt: number;
}

/** 单篇正文上限（localStorage 总量约 5MB，超长内容按上限截断） */
const MAX_CONTENT = 200_000;
/** 每会话产物上限，超出淘汰最旧 */
const MAX_PER_SESSION = 30;

const ARTIFACTS_KEY = (pageId: number) => `kimo_ai_artifacts_${pageId}`;
const VIEW_TOPIC_KEY = (pageId: number) => `kimo_ai_viewtopic_${pageId}`;
const SEARCH_CACHE_KEY = "kimo_search_cache_v1";

const KIND_LABEL: Record<ArtifactKind, string> = {
  article: "文章",
  search: "搜索",
  web: "网页",
  doc: "文档",
  kb: "知识条",
  image: "图片",
  note: "笔记",
};

export function artifactKindLabel(kind: ArtifactKind): string {
  return KIND_LABEL[kind] ?? "产物";
}

/** 产物对应可打开的网页地址：网页产物优先 url，其次首个来源 */
export function artifactUrl(artifact: Artifact): string {
  if (artifact.url) return artifact.url;
  return artifact.sources?.find((s) => !!s.url)?.url || "";
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 配额满 / 隐私模式：静默降级 */
  }
}

function clampContent(content: string): string {
  const text = content || "";
  return text.length > MAX_CONTENT ? text.slice(0, MAX_CONTENT) : text;
}

function normalize(artifact: Artifact): Artifact {
  return {
    ...artifact,
    content: clampContent(artifact.content || ""),
    createdAt: artifact.createdAt || Date.now(),
    updatedAt: artifact.updatedAt || artifact.createdAt || Date.now(),
  };
}

/** 读取全部会话的产物映射 */
export function loadArtifactMap(pageId: number): Record<string, Artifact[]> {
  const map = readJson<Record<string, Artifact[]>>(ARTIFACTS_KEY(pageId), {});
  if (!map || typeof map !== "object") return {};
  const out: Record<string, Artifact[]> = {};
  for (const [sessionId, list] of Object.entries(map)) {
    if (!Array.isArray(list)) continue;
    out[sessionId] = list
      .filter((a): a is Artifact => !!a && typeof a === "object" && !!a.id)
      .map(normalize);
  }
  return out;
}

export function saveArtifactMap(
  pageId: number,
  map: Record<string, Artifact[]>,
): void {
  writeJson(ARTIFACTS_KEY(pageId), map);
}

/** 某会话的产物列表（新的在前；同毫秒时后写入的排前） */
export function listArtifacts(pageId: number, sessionId: string): Artifact[] {
  const list = loadArtifactMap(pageId)[sessionId] || [];
  return list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a.updatedAt - x.a.updatedAt || y.i - x.i)
    .map((x) => x.a);
}

export function findArtifact(
  pageId: number,
  sessionId: string,
  id: string,
): Artifact | undefined {
  return (loadArtifactMap(pageId)[sessionId] || []).find((a) => a.id === id);
}

export interface UpsertArtifactInput {
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  content: string;
  topic?: string;
  url?: string;
  sources?: ArtifactSource[];
  msgIdx?: number;
  /** 指定则直接更新该产物 */
  id?: string;
}

/**
 * 写入/更新产物。
 * 去重规则：① 显式 id 命中；② 同 kind 且 topic 相同；③ 同 kind 且标题相同。
 * 命中即更新内容与 updatedAt，避免同一篇文章/文档在列表里堆积多份。
 */
export function upsertArtifact(
  pageId: number,
  input: UpsertArtifactInput,
): Artifact {
  const map = loadArtifactMap(pageId);
  const list = map[input.sessionId] || [];
  const now = Date.now();
  const key = (input.topic || input.title || "").trim().toLowerCase();
  const existing =
    (input.id ? list.find((a) => a.id === input.id) : undefined) ||
    list.find(
      (a) =>
        a.kind === input.kind &&
        key !== "" &&
        ((a.topic || "").trim().toLowerCase() === key ||
          a.title.trim().toLowerCase() === key),
    );

  let artifact: Artifact;
  if (existing) {
    artifact = normalize({
      ...existing,
      title: input.title || existing.title,
      content: input.content ?? existing.content,
      topic: input.topic ?? existing.topic,
      url: input.url ?? existing.url,
      sources: input.sources ?? existing.sources,
      msgIdx: input.msgIdx ?? existing.msgIdx,
      updatedAt: now,
    });
  } else {
    artifact = normalize({
      id: input.id || uid(),
      sessionId: input.sessionId,
      kind: input.kind,
      title: input.title || "未命名产物",
      topic: input.topic,
      url: input.url,
      content: input.content || "",
      sources: input.sources,
      msgIdx: input.msgIdx,
      createdAt: now,
      updatedAt: now,
    });
  }

  const nextList = existing
    ? list.map((a) => (a.id === artifact.id ? artifact : a))
    : [...list, artifact];
  // 超限淘汰最旧（先按 updatedAt 升序淘汰）
  const trimmed =
    nextList.length > MAX_PER_SESSION
      ? [...nextList]
          .sort((a, b) => a.updatedAt - b.updatedAt)
          .slice(nextList.length - MAX_PER_SESSION)
      : nextList;

  map[input.sessionId] = trimmed;
  saveArtifactMap(pageId, map);
  return artifact;
}

export function removeArtifact(
  pageId: number,
  sessionId: string,
  id: string,
): void {
  const map = loadArtifactMap(pageId);
  const list = map[sessionId] || [];
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return;
  if (next.length) map[sessionId] = next;
  else delete map[sessionId];
  saveArtifactMap(pageId, map);
}

export function clearSessionArtifacts(pageId: number, sessionId: string): void {
  const map = loadArtifactMap(pageId);
  if (!map[sessionId]) return;
  delete map[sessionId];
  saveArtifactMap(pageId, map);
}

/** 当前会话最近一条某类型产物（View 面板默认选中） */
export function latestArtifact(
  pageId: number,
  sessionId: string,
  kind?: ArtifactKind,
): Artifact | undefined {
  const list = listArtifacts(pageId, sessionId);
  return kind ? list.find((a) => a.kind === kind) : list[0];
}

/**
 * 幂等迁移：把旧的「话题 → 文章」缓存回填成 article 产物。
 * 迁移范围：`kimo_ai_viewtopic_<pageId>` 里记录的每个会话的话题；
 * 若缓存里没有该话题的文章则跳过。已有的同 topic 产物不会重复创建。
 */
export function migrateArtifactsFromSearchCache(pageId: number): number {
  const topics = readJson<Record<string, string>>(VIEW_TOPIC_KEY(pageId), {});
  const cache = readJson<
    Record<
      string,
      {
        article?: string;
        content?: string;
        sources?: { title?: string; url?: string }[];
        time?: number;
      }
    >
  >(SEARCH_CACHE_KEY, {});
  let created = 0;
  for (const [sessionId, topic] of Object.entries(topics)) {
    if (!sessionId || !topic) continue;
    const entry = cache[topic];
    const article = entry?.article || entry?.content || "";
    if (!article.trim()) continue;
    const existing = listArtifacts(pageId, sessionId).some(
      (a) => a.kind === "article" && (a.topic || "").trim() === topic.trim(),
    );
    if (existing) continue;
    upsertArtifact(pageId, {
      sessionId,
      kind: "article",
      title: topic,
      topic,
      content: article,
      sources: (entry?.sources || [])
        .filter((s) => !!s?.url)
        .map((s) => ({ title: s.title || s.url || "", url: s.url || "" })),
    });
    created += 1;
  }
  return created;
}

/** 供提示词使用的产物清单（省 token：只给 id/类型/标题） */
export function formatArtifactsBrief(list: Artifact[], max = 20): string {
  if (!list.length) return "";
  return list
    .slice(0, max)
    .map(
      (a) =>
        `- [${artifactKindLabel(a.kind)}] ${a.title}（id: ${a.id}${
          a.topic && a.topic !== a.title ? `，主题: ${a.topic}` : ""
        }）`,
    )
    .join("\n");
}
