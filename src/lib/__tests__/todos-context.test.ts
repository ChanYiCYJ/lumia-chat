import { describe, it, expect, beforeEach } from "vitest";
import {
  addTodo,
  clearDone,
  formatTodos,
  loadTodos,
  removeTodo,
  todoStats,
  toggleTodo,
} from "../todos";
import { fitMessages, estimateTokens, messagesChars } from "../contextMode";
import { createAgentTools } from "../agent/plugins";

const ctx = {
  pageId: 3,
  sessionId: "todo-s",
  mode: "auto" as const,
  webEnabled: true,
};

function tool(name: string) {
  const found = createAgentTools(ctx).find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

const text = (res: { content: unknown[] }) =>
  (res.content[0] as { text: string }).text;

describe("待办（rpiv-todo）", () => {
  beforeEach(() => localStorage.clear());

  it("新增 / 勾选 / 删除 / 清理已完成", () => {
    const a = addTodo("写周报", { priority: 1 });
    const b = addTodo("   ", {});
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    expect(todoStats().open).toBe(1);

    toggleTodo(a!.id, true);
    expect(todoStats()).toMatchObject({ total: 1, open: 0, done: 1 });
    expect(clearDone()).toBe(1);
    expect(loadTodos()).toHaveLength(0);

    const c = addTodo("回邮件")!;
    expect(removeTodo(c.id)).toBe(true);
    expect(removeTodo(c.id)).toBe(false);
  });

  it("逾期统计与清单文本", () => {
    const now = Date.now();
    addTodo("逾期项", { due: now - 86_400_000 });
    addTodo("未来项", { due: now + 86_400_000 });
    const s = todoStats(now);
    expect(s.overdue).toBe(1);
    const t = formatTodos(loadTodos(), now);
    expect(t).toContain("已逾期");
    expect(t).toContain("逾期项");
  });

  it("插件工具：add → list → done", async () => {
    const added = await tool("todo_add").execute("1", {
      text: "整理插件文档",
      priority: 1,
    });
    expect(text(added)).toContain("剩余 1 项");
    const listed = await tool("todo_list").execute("2", {});
    expect(text(listed)).toContain("整理插件文档");
    const id = /id: (t[a-z0-9]+)/.exec(text(listed))?.[1];
    expect(id).toBeTruthy();
    const done = await tool("todo_done").execute("3", { id, done: true });
    expect(text(done)).toContain("已完成");
    expect(todoStats().open).toBe(0);
  });
});

describe("context-mode", () => {
  const msg = (role: string, content: string) => ({ role, content });

  it("预算足够时原样返回", () => {
    const list = [
      msg("system", "S"),
      msg("user", "hi"),
      msg("assistant", "yo"),
    ];
    expect(fitMessages(list, 1000)).toBe(list);
  });

  it("超预算时从早期裁剪，保留 system 与最近消息 + 标记", () => {
    const list = [
      msg("system", "S"),
      msg("user", "u1" + "x".repeat(500)),
      msg("assistant", "a1" + "x".repeat(500)),
      msg("user", "u2"),
      msg("assistant", "a2"),
    ];
    const out = fitMessages(list, 700);
    expect(out.length).toBeLessThanOrEqual(list.length);
    expect(out[0].content).toBe("S");
    expect(out[1].role).toBe("system");
    expect(String(out[1].content)).toContain("上下文裁剪");
    expect(out.at(-1)?.content).toBe("a2");
    // 最早的消息被丢弃
    expect(out.some((m) => String(m.content).startsWith("u1"))).toBe(false);
  });

  it("tool 消息不会被裁掉（保持配对）", () => {
    const list = [
      msg("system", "S"),
      msg("tool", "t".repeat(400)),
      msg("user", "u" + "x".repeat(400)),
      msg("assistant", "a"),
    ];
    const out = fitMessages(list, 300);
    expect(out.some((m) => m.role === "tool")).toBe(true);
  });

  it("token 估算与字符统计", () => {
    expect(estimateTokens("你好world")).toBe(2 + 2); // 2 CJK + ceil(5/4)
    expect(messagesChars([msg("user", "abc")])).toBe(3);
  });
});
