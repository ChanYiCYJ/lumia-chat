import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addCards,
  cardsForNode,
  dueCards,
  gradeCard,
  intervalLabel,
  loadCards,
  parseCards,
  removeCardsForNode,
  schedule,
  srsStats,
} from "../srs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const base = { interval: 0, ease: 2.3, reps: 0, lapses: 0 };

describe("SRS 调度", () => {
  it("新卡评分推进间隔", () => {
    const good = schedule(base, "good", 0);
    expect(good.interval).toBe(1);
    expect(good.reps).toBe(1);
    expect(good.due).toBe(86_400_000);

    const again = schedule(base, "again", 0);
    expect(again.interval).toBe(0);
    expect(again.lapses).toBe(1);
    expect(again.due).toBe(10 * 60_000);

    const easy = schedule(base, "easy", 0);
    expect(easy.interval).toBe(3);
    expect(easy.ease).toBeGreaterThan(base.ease);
  });

  it("间隔按易度增长，hard 与 again 降级", () => {
    const grown = schedule({ ...base, interval: 10, ease: 2.3, reps: 3 }, "good", 0);
    expect(grown.interval).toBe(23);
    const hard = schedule({ ...base, interval: 10, ease: 2.3, reps: 3 }, "hard", 0);
    expect(hard.interval).toBe(12);
    expect(hard.ease).toBeLessThan(2.3);
    expect(intervalLabel({ ...base, id: "x", subjectId: "", nodeId: "", front: "", back: "", due: 0, createdAt: 0, updatedAt: 0 } as never, "good")).toBe("1 天");
  });
});

describe("卡片存储", () => {
  it("添加去重 + 按节点/到期筛选 + 评分落库", () => {
    expect(addCards("s1", "n1", [{ front: "什么是向量", back: "带方向的量" }])).toBe(1);
    expect(addCards("s1", "n1", [{ front: "什么是向量", back: "重复" }])).toBe(0);
    expect(cardsForNode("n1")).toHaveLength(1);
    expect(dueCards("s1")).toHaveLength(1);

    const card = loadCards()[0];
    gradeCard(card.id, "good");
    expect(dueCards("s1")).toHaveLength(0); // 到期日推到明天
    expect(srsStats("s1")).toMatchObject({ total: 1, due: 0 });

    removeCardsForNode("n1");
    expect(loadCards()).toHaveLength(0);
  });
});

describe("解析 AI 出的题", () => {
  it("识别问/答（含编号、粗体、多题）", () => {
    const text = `1. 问：**向量的线性组合是什么？**
答：若干向量乘以标量再相加。

问：矩阵乘法满足交换律吗？
答：一般不满足。`;
    const cards = parseCards(text);
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toContain("线性组合");
    expect(cards[1].back).toContain("不满足");
  });

  it("没有问答题时返回空，不去猜", () => {
    expect(parseCards("这是一段课件，没有题目。")).toEqual([]);
  });
});
