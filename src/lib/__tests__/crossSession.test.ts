import { describe, it, expect } from "vitest";
import { buildCrossSessionDigest } from "../crossSession";

const s = (
  id: string,
  title: string,
  createdAt: number,
  msgs: [string, string][],
) => ({
  id,
  title,
  createdAt,
  messages: msgs.flatMap(([u, a]) => [
    { role: "user", content: u },
    { role: "assistant", content: a },
  ]),
});

describe("跨会话记忆摘要", () => {
  it("排除当前会话并保留其他会话的要点", () => {
    const text = buildCrossSessionDigest(
      [
        s("a", "代号", 1, [["我的代号是阿尔法", "记住了，阿尔法"]]),
        s("b", "当前", 2, [["别的", "回答"]]),
      ],
      "b",
    );
    expect(text).toContain("其他会话的记忆");
    expect(text).toContain("阿尔法");
    expect(text).not.toContain("会话「当前」");
  });

  it("按创建时间取最近会话，限制轮数", () => {
    const text = buildCrossSessionDigest(
      [
        s("a", "旧会话", 1, [["旧问题", "旧回答"]]),
        s("b", "新会话", 3, [
          ["第一问", "一"],
          ["第二问", "二"],
          ["第三问", "三"],
        ]),
      ],
      "c",
      { maxSessions: 1, exchanges: 2 },
    );
    expect(text).toContain("新会话");
    expect(text).not.toContain("旧会话");
    expect(text).toContain("第三问");
    expect(text).not.toContain("第一问");
  });

  it("没有其他会话时返回空串，且清理 Markdown", () => {
    expect(buildCrossSessionDigest([], "x")).toBe("");
    const text = buildCrossSessionDigest(
      [s("a", "课件", 1, [["讲一下向量", "## 核心定义\n`代码` **重点**"]])],
      "b",
    );
    expect(text).toContain("核心定义");
    expect(text).not.toContain("##");
    expect(text).not.toContain("`");
  });
});
