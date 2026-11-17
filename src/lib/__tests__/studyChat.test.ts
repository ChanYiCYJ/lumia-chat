import { describe, it, expect, beforeEach } from "vitest";
import { createSubject } from "../study";
import {
  cardFromToolResult,
  errorFromToolResult,
  normalizeStudyCards,
  pendingCardForTool,
  resolveStudyTarget,
  reviveStudyCards,
} from "../studyChat";

beforeEach(() => localStorage.clear());

describe("学习卡片引用（对话内）", () => {
  it("只接受已知类型，最多 6 张", () => {
    expect(
      normalizeStudyCards([
        { kind: "lesson", subjectId: "s1", nodeId: "n1" },
        { kind: "unknown" },
        null,
        "x",
        { kind: "review", pending: true, error: "超时" },
      ]),
    ).toEqual([
      { kind: "lesson", subjectId: "s1", nodeId: "n1", pending: false },
      { kind: "review", pending: true, error: "超时" },
    ]);
    expect(
      normalizeStudyCards(Array.from({ length: 10 }, () => ({ kind: "plan" }))),
    ).toHaveLength(6);
    expect(normalizeStudyCards("not-array")).toEqual([]);
  });

  it("会话恢复时丢掉生成中/失败态", () => {
    expect(
      reviveStudyCards([
        { kind: "lesson", subjectId: "s1", nodeId: "n1" },
        { kind: "lesson", pending: true },
        { kind: "lesson", error: "失败" },
      ]),
    ).toHaveLength(1);
  });

  it("工具结果 → 卡片引用；错误文本压成一行", () => {
    expect(
      cardFromToolResult({
        content: [{ type: "text", text: "ok" }],
        details: { card: { kind: "practice", subjectId: "s1", nodeId: "n1" } },
      }),
    ).toEqual({ kind: "practice", subjectId: "s1", nodeId: "n1", pending: false });
    expect(cardFromToolResult({ details: {} })).toBeNull();
    expect(
      errorFromToolResult({
        content: [{ type: "text", text: "没有找到科目：\n物理" }],
      }),
    ).toBe("没有找到科目： 物理");
    expect(errorFromToolResult(null)).toBe("生成失败");
  });

  it("按名字/id 解析科目与知识点（节点可模糊匹配）", () => {
    const s = createSubject("线性代数", "", [
      { title: "向量与线性组合" },
      { title: "矩阵乘法" },
    ])!;
    expect(
      resolveStudyTarget([s], "线性代数", "矩阵").node?.title,
    ).toBe("矩阵乘法");
    expect(resolveStudyTarget([s], s.id).node?.title).toBe("向量与线性组合");
    expect(resolveStudyTarget([s], "不存在")).toEqual({});
  });

  it("工具开始 → 占位卡片（带正确的 id）", () => {
    const s = createSubject("概率论", "", [{ title: "条件概率" }])!;
    expect(pendingCardForTool("study_teach", { subject: "概率论" })).toEqual({
      kind: "lesson",
      subjectId: s.id,
      nodeId: s.nodes[0].id,
      pending: true,
    });
    expect(
      pendingCardForTool("anki_add_cards", { subject: "概率论", node: "条件概率" })
        ?.kind,
    ).toBe("practice");
    expect(pendingCardForTool("anki_due", {})).toMatchObject({
      kind: "review",
      pending: true,
    });
    expect(pendingCardForTool("study_add_subject", { name: "新科目" })).toMatchObject({
      kind: "plan",
      pending: true,
    });
    expect(pendingCardForTool("web_search", {})).toBeNull();
  });
});
