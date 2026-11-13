import { describe, it, expect, beforeEach } from "vitest";
import {
  addNodes,
  clearNodeContent,
  createSubject,
  lessonPrompt,
  loadSubjects,
  moveNode,
  quizPrompt,
  removeNode,
  removeSubject,
  subjectProgress,
  updateNode,
  updateSubject,
} from "../study";
import { createAgentTools } from "../agent/plugins";

const ctx = {
  pageId: 1,
  sessionId: "study",
  mode: "auto" as const,
  webEnabled: true,
};

function tool(name: string) {
  const t = createAgentTools(ctx).find((x) => x.name === name);
  if (!t) throw new Error(`missing ${name}`);
  return t;
}

const text = (r: { content: unknown[] }) =>
  (r.content[0] as { text: string }).text;

beforeEach(() => localStorage.clear());

describe("学习系统（数据层）", () => {
  it("建科目 + 大纲 + 进度", () => {
    const s = createSubject("线性代数", "搞懂特征值", [
      { title: "向量", type: "concept" },
      { title: "矩阵乘法", type: "practice" },
    ]);
    expect(s).toBeTruthy();
    expect(loadSubjects()).toHaveLength(1);
    const p = subjectProgress(s!);
    expect(p).toMatchObject({ total: 2, done: 0, pct: 0 });
    expect(p.current?.title).toBe("向量");

    updateNode(s!.id, s!.nodes[0].id, { status: "done" });
    expect(subjectProgress(loadSubjects()[0]).pct).toBe(50);
  });

  it("只依赖已完成节点的节点才会成为 current", () => {
    const s = createSubject("测试", "", [{ title: "A" }, { title: "B" }])!;
    // B 依赖 A
    updateNode(s.id, s.nodes[1].id, { deps: [s.nodes[0].id] });
    expect(subjectProgress(loadSubjects()[0]).current?.title).toBe("A");
    updateNode(s.id, s.nodes[0].id, { status: "done" });
    expect(subjectProgress(loadSubjects()[0]).current?.title).toBe("B");
  });

  it("添加/删除", () => {
    const s = createSubject("C++", "", [])!;
    expect(addNodes(s.id, [{ title: "指针", type: "lab" }])).toBe(1);
    expect(loadSubjects()[0].nodes[0].type).toBe("lab");
    expect(removeSubject(s.id)).toBe(true);
    expect(loadSubjects()).toHaveLength(0);
  });

  it("编辑科目 / 删除知识点 / 清空课件 / 排序", () => {
    const s = createSubject("旧的", "目标", [
      { title: "A" },
      { title: "B" },
      { title: "C" },
    ])!;
    expect(updateSubject(s.id, { name: "新的", goal: "新目标" })).toMatchObject(
      {
        name: "新的",
        goal: "新目标",
      },
    );

    const cur = loadSubjects()[0];
    const [a, b, c] = cur.nodes;
    updateNode(s.id, c.id, { deps: [a.id] });

    // 上移 / 下移
    expect(moveNode(s.id, b.id, -1)).toBe(true);
    expect(loadSubjects()[0].nodes.map((n) => n.title)).toEqual([
      "B",
      "A",
      "C",
    ]);
    expect(moveNode(s.id, b.id, -1)).toBe(false);

    // 删除 A，依赖里也要清掉
    expect(removeNode(s.id, a.id)).toBe(true);
    const after = loadSubjects()[0];
    expect(after.nodes.map((n) => n.title)).toEqual(["B", "C"]);
    expect(after.nodes.find((n) => n.title === "C")?.deps).toEqual([]);

    // 清空课件不动节点
    updateNode(s.id, after.nodes[0].id, { content: "## 课件" });
    expect(clearNodeContent(s.id, after.nodes[0].id)).toBe(true);
    expect(loadSubjects()[0].nodes[0].content).toBe("");
  });

  it("提示词包含关键结构", () => {
    const s = createSubject("概率论", "考试", [{ title: "条件概率" }])!;
    const p = lessonPrompt(s, s.nodes[0]);
    expect(p).toContain("直觉");
    expect(p).toContain("常见误区");
    expect(p).toContain("练习");
    expect(quizPrompt(s, s.nodes[0])).toContain("答案");
  });
});

describe("学习插件（工具层）", () => {
  it("study_add_subject → study_list → study_mark", async () => {
    const added = await tool("study_add_subject").execute("1", {
      name: "机器学习",
      goal: "入门",
      outline: ["线性回归|concept", "梯度下降|practice"],
    });
    expect(text(added)).toContain("已创建科目");

    const list = await tool("study_list").execute("2", {});
    expect(text(list)).toContain("机器学习");
    expect(text(list)).toContain("线性回归");

    const marked = await tool("study_mark").execute("3", {
      subject: "机器学习",
      node: "线性回归",
      status: "done",
    });
    expect(text(marked)).toContain("已标记");
    expect(subjectProgress(loadSubjects()[0]).pct).toBe(50);
  });
});
