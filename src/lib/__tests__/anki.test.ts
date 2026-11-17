import { describe, it, expect, beforeEach } from "vitest";
import { createSubject, loadSubjects } from "../study";
import { createAgentTools } from "../agent/plugins";
import { loadCards, gradeCard, dueCards } from "../srs";

const ctx = { pageId: 1, sessionId: "anki", mode: "auto" as const, webEnabled: true };

function tool(name: string) {
  const t = createAgentTools(ctx).find((x) => x.name === name);
  if (!t) throw new Error(`missing ${name}`);
  return t;
}

const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

beforeEach(() => localStorage.clear());

describe("Anki 式复习插件", () => {
  it("建卡去重、查到期、评分后不再到期", async () => {
    const s = createSubject("线性代数", "", [{ title: "向量" }])!;
    const added = await tool("anki_add_cards").execute("1", {
      subject: "线性代数",
      node: "向量",
      cards: [
        { front: "什么是向量的线性组合？", back: "若干向量乘标量再相加" },
        { front: "什么是向量的线性组合？", back: "重复题" },
        { front: "向量加法满足交换律吗？", back: "满足" },
      ],
    });
    expect(text(added)).toContain("已添加 2 张");
    expect(loadCards()).toHaveLength(2);

    const due = await tool("anki_due").execute("2", { subject: "线性代数" });
    expect(text(due)).toContain("2 张到期");
    expect(text(due)).toContain("线性组合");

    loadCards().forEach((c) => gradeCard(c.id, "good"));
    expect(dueCards(s.id)).toHaveLength(0);
    const after = await tool("anki_due").execute("3", {});
    expect(text(after)).toContain("今天没有到期卡片");
    expect(loadSubjects()[0].nodes[0].status).toBe("doing");
  });

  it("科目/知识点不存在时明确报错", async () => {
    await expect(
      tool("anki_add_cards").execute("1", {
        subject: "不存在",
        node: "x",
        cards: [{ front: "a", back: "b" }],
      }),
    ).rejects.toThrow("没有找到科目");
  });
});
