import { describe, it, expect, beforeEach } from "vitest";
import {
  clearSessionArtifacts,
  findArtifact,
  formatArtifactsBrief,
  latestArtifact,
  listArtifacts,
  loadArtifactMap,
  migrateArtifactsFromSearchCache,
  removeArtifact,
  upsertArtifact,
} from "../artifacts";

const PAGE = 7;

describe("artifacts 每会话产物", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("按会话隔离存取", () => {
    upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "article",
      title: "番剧盘点",
      content: "A",
    });
    upsertArtifact(PAGE, {
      sessionId: "s2",
      kind: "article",
      title: "另一篇",
      content: "B",
    });
    expect(listArtifacts(PAGE, "s1")).toHaveLength(1);
    expect(listArtifacts(PAGE, "s2")).toHaveLength(1);
    expect(listArtifacts(PAGE, "s1")[0].title).toBe("番剧盘点");
  });

  it("同 topic 或同标题命中时更新而不是新建", () => {
    const a = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "article",
      title: "主题 A",
      topic: "topic-a",
      content: "第一版",
    });
    const b = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "article",
      title: "主题 A 改名",
      topic: "topic-a",
      content: "第二版",
    });
    expect(b.id).toBe(a.id);
    const list = listArtifacts(PAGE, "s1");
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("第二版");
    expect(list[0].title).toBe("主题 A 改名");
  });

  it("显式 id 命中时更新指定产物", () => {
    const a = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "note",
      title: "笔记",
      content: "v1",
    });
    const b = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "doc",
      title: "完全不同标题",
      content: "v2",
      id: a.id,
    });
    expect(b.id).toBe(a.id);
    expect(findArtifact(PAGE, "s1", a.id)?.content).toBe("v2");
    expect(listArtifacts(PAGE, "s1")).toHaveLength(1);
  });

  it("删除与清空会话产物", () => {
    const a = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "kb",
      title: "知识条目",
      content: "x",
    });
    removeArtifact(PAGE, "s1", a.id);
    expect(listArtifacts(PAGE, "s1")).toHaveLength(0);

    upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "kb",
      title: "另一条",
      content: "y",
    });
    clearSessionArtifacts(PAGE, "s1");
    expect(loadArtifactMap(PAGE).s1).toBeUndefined();
  });

  it("按 updatedAt 倒序返回并给出最近一条", () => {
    const first = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "search",
      title: "旧",
      content: "1",
    });
    const second = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "search",
      title: "新",
      content: "2",
    });
    // 确保时间戳不同（真实实现用 Date.now()，同毫秒时靠数组顺序兜底）
    expect(listArtifacts(PAGE, "s1")[0].id).toBe(second.id);
    expect(latestArtifact(PAGE, "s1", "search")?.id).toBe(second.id);
    expect(findArtifact(PAGE, "s1", first.id)?.title).toBe("旧");
  });

  it("从旧 View 缓存幂等迁移历史文章", () => {
    localStorage.setItem(
      "kimo_ai_viewtopic_7",
      JSON.stringify({ s1: "2026 新番" }),
    );
    localStorage.setItem(
      "kimo_search_cache_v1",
      JSON.stringify({
        "2026 新番": {
          article: "# 新番\n正文",
          sources: [{ title: "来源", url: "https://example.com" }],
        },
      }),
    );
    expect(migrateArtifactsFromSearchCache(PAGE)).toBe(1);
    const list = listArtifacts(PAGE, "s1");
    expect(list[0].kind).toBe("article");
    expect(list[0].content).toContain("新番");
    expect(list[0].sources?.[0].url).toBe("https://example.com");
    // 再次迁移不重复
    expect(migrateArtifactsFromSearchCache(PAGE)).toBe(0);
    expect(listArtifacts(PAGE, "s1")).toHaveLength(1);
  });

  it("产物清单摘要包含类型与 id", () => {
    const a = upsertArtifact(PAGE, {
      sessionId: "s1",
      kind: "article",
      title: "标题",
      content: "c",
    });
    const brief = formatArtifactsBrief(listArtifacts(PAGE, "s1"));
    expect(brief).toContain("文章");
    expect(brief).toContain("标题");
    expect(brief).toContain(a.id);
    expect(formatArtifactsBrief([])).toBe("");
  });
});
