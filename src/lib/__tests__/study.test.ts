import { describe, it, expect, beforeEach } from "vitest";
import {
  addNodes,
  clearNodeContent,
  createSubject,
  lessonPrompt,
  loadSubjects,
  moveNode,
  normalizeLesson,
  quizPrompt,
  removeNode,
  removeSubject,
  subjectProgress,
  updateNode,
  updateSubject,
} from "../study";
import { createAgentTools } from "../agent/plugins";
import { loadCards } from "../srs";

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
    expect(p).toContain("核心定义");
    expect(p).toContain("常见误区");
    expect(p).toContain("练习");
    expect(p).toContain("不要开场白");
    expect(quizPrompt(s, s.nodes[0])).toContain("问：");
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
    expect(
      (added as unknown as { details: { card: unknown } }).details.card,
    ).toEqual({ kind: "plan", subjectId: loadSubjects()[0].id });

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

  it("同名科目只补知识点，不重复创建", async () => {
    await tool("study_add_subject").execute("1", {
      name: "机器学习",
      outline: ["线性回归", "梯度下降"],
    });
    const again = await tool("study_add_subject").execute("2", {
      name: "机器学习",
      outline: ["线性回归", "正则化"],
    });
    expect(text(again)).toContain("已存在");
    expect(text(again)).toContain("1 个知识点");
    expect(loadSubjects()).toHaveLength(1);
    expect(loadSubjects()[0].nodes).toHaveLength(3);
  });
});

const LESSON =
  "# 线性回归\n\n" + "最小二乘用残差平方和最小化来求参数。".repeat(6);
const QUIZ =
  "问：梯度下降的更新方向？\n答：负梯度方向\n问：学习率过大？\n答：会震荡不收敛\n问：为什么要归一化？\n答：让各维尺度一致";

/** 带后台生成能力的工具上下文（system 区分课件/出题） */
const genCtx = {
  ...ctx,
  generate: async (system: string) =>
    system.includes("学习教练") ? LESSON : QUIZ,
};

function genTool(name: string, extra: object = {}) {
  const t = createAgentTools({ ...genCtx, ...extra }).find(
    (x) => x.name === name,
  );
  if (!t) throw new Error(`missing ${name}`);
  return t;
}

type WithCard = {
  details: { card: { kind: string; subjectId: string; nodeId: string } };
};

describe("学习插件（对话卡片）", () => {
  it("study_teach 生成课件并返回课件卡；已有课件不重复生成", async () => {
    const s = createSubject("机器学习", "", [{ title: "线性回归" }])!;
    const r = (await genTool("study_teach").execute("1", {
      subject: "机器学习",
      node: "线性回归",
    })) as unknown as WithCard;
    expect(r.details.card).toEqual({
      kind: "lesson",
      subjectId: s.id,
      nodeId: s.nodes[0].id,
    });
    const saved = loadSubjects()[0].nodes[0];
    expect(saved.content).toContain("最小二乘");
    expect(saved.status).toBe("doing");

    let called = 0;
    const again = await genTool("study_teach", {
      generate: async () => {
        called += 1;
        return LESSON;
      },
    }).execute("2", { subject: "机器学习", node: "线性回归" });
    expect(text(again)).toContain("已有课件");
    expect(called).toBe(0);
  });

  it("study_practice 出题建卡并返回练习卡；已有卡片直接复用", async () => {
    const s = createSubject("机器学习", "", [{ title: "梯度下降" }])!;
    const r = (await genTool("study_practice").execute("1", {
      subject: "机器学习",
      node: "梯度下降",
    })) as unknown as WithCard;
    expect(r.details.card).toEqual({
      kind: "practice",
      subjectId: s.id,
      nodeId: s.nodes[0].id,
    });
    expect(loadCards()).toHaveLength(3);

    const again = await genTool("study_practice").execute("2", {
      subject: "机器学习",
      node: "梯度下降",
    });
    expect(text(again)).toContain("已有 3 张练习卡");
    expect(loadCards()).toHaveLength(3);
  });

  it("缺少后台生成能力 / 课件不合规时明确报错", async () => {
    createSubject("测试科目", "", [{ title: "A" }]);
    await expect(
      tool("study_teach").execute("1", { subject: "测试科目" }),
    ).rejects.toThrow("后台生成");
    expect(() => normalizeLesson("太短")).toThrow("课件太短");
    expect(() => normalizeLesson("作为一个 AI 我无法" + "x".repeat(100))).toThrow(
      "不合规",
    );
  });
});
