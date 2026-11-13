import { describe, it, expect } from "vitest";
import {
  allTags,
  buildKbGraph,
  extractTags,
  parseWikiLinks,
  recentKb,
  searchKb,
} from "../kbVault";
import type { KbEntryRecord } from "../kb";

const e = (
  id: string,
  name: string,
  content: string,
  extra: Partial<KbEntryRecord> = {},
): KbEntryRecord => ({
  id,
  name,
  content,
  createdAt: 1,
  ...extra,
});

describe("知识库 Vault 能力", () => {
  it("解析双链与别名", () => {
    expect(
      parseWikiLinks("见 [[线性代数]] 和 [[矩阵|矩阵笔记]]，重复 [[线性代数]]"),
    ).toEqual([
      { target: "线性代数", alias: undefined },
      { target: "矩阵", alias: "矩阵笔记" },
    ]);
  });

  it("提取标签（忽略纯数字/标题井号）", () => {
    const tags = extractTags("今天学了 #线代 #math/linear 第 #3 章\n# 标题");
    expect(tags).toContain("线代");
    expect(tags).toContain("math/linear");
    expect(tags).not.toContain("3");
  });

  it("出链/反向链接/死链", () => {
    const a = e("a", "向量", "参考 [[矩阵]] 与 [[不存在页]]");
    const b = e("b", "矩阵", "见 [[向量|向量笔记]]");
    const g = buildKbGraph([a, b], a);
    expect(g.outgoing.map((x) => x.name)).toEqual(["矩阵"]);
    expect(g.dead).toEqual(["不存在页"]);
    expect(buildKbGraph([a, b], b).backlinks.map((x) => x.name)).toEqual([
      "向量",
    ]);
  });

  it("全文搜索带片段，标题命中权重更高", () => {
    const list = [
      e("a", "线性代数", "特征值分解"),
      e("b", "笔记", "这里讲了线性代数的特征值"),
    ];
    const hits = searchKb(list, "线性代数");
    expect(hits[0].entry.id).toBe("a");
    expect(hits[1].snippet).toContain("线性代数");
  });

  it("最近更新与标签统计", () => {
    const list = [
      e("a", "A", "#x", { createdAt: 1, notionSyncedAt: 10 }),
      e("b", "B", "#x #y", { createdAt: 100 }),
    ];
    expect(recentKb(list)[0].id).toBe("b");
    expect(allTags(list)[0]).toEqual({ tag: "x", count: 2 });
  });
});
