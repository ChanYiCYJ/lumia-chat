/**
 * 待办清单（rpiv-todo 的轻量实现）
 * ------------------------------------------------------------------
 * 纯数据 + 纯函数；存储 localStorage `kimo_todos_v1`。
 * 工具层见 agent/plugins/todoPlugin.ts；UI 只在 powerline 状态栏显示未完成数。
 */

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  /** 可选截止时间（ms） */
  due?: number;
  /** 1=高 2=中 3=低 */
  priority?: 1 | 2 | 3;
}

export const TODOS_KEY = "kimo_todos_v1";

function uid(): string {
  return (
    "t" +
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 5)
  );
}

export function loadTodos(): Todo[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TODOS_KEY) || "[]");
    return Array.isArray(raw)
      ? (raw as Todo[]).filter((t) => t && typeof t.text === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveTodos(list: Todo[]): void {
  try {
    localStorage.setItem(TODOS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略配额错误 */
  }
}

export function addTodo(
  text: string,
  opts: { due?: number; priority?: 1 | 2 | 3 } = {},
  now = Date.now(),
): Todo | null {
  const t = (text || "").trim();
  if (!t) return null;
  const todo: Todo = {
    id: uid(),
    text: t.slice(0, 200),
    done: false,
    createdAt: now,
    due: opts.due,
    priority: opts.priority,
  };
  saveTodos([...loadTodos(), todo]);
  return todo;
}

export function toggleTodo(id: string, done?: boolean): Todo | undefined {
  const list = loadTodos();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return undefined;
  list[idx] = { ...list[idx], done: done ?? !list[idx].done };
  saveTodos(list);
  return list[idx];
}

export function removeTodo(id: string): boolean {
  const list = loadTodos();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  saveTodos(next);
  return true;
}

export function clearDone(): number {
  const list = loadTodos();
  const next = list.filter((t) => !t.done);
  saveTodos(next);
  return list.length - next.length;
}

export interface TodoStats {
  total: number;
  open: number;
  done: number;
  overdue: number;
}

export function todoStats(now = Date.now(), list?: Todo[]): TodoStats {
  const all = list || loadTodos();
  const open = all.filter((t) => !t.done);
  return {
    total: all.length,
    open: open.length,
    done: all.length - open.length,
    overdue: open.filter((t) => t.due != null && t.due < now).length,
  };
}

/** 给模型看的清单文本 */
export function formatTodos(list: Todo[], now = Date.now()): string {
  if (!list.length) return "（暂无待办）";
  const rank = (p?: number) => p || 3;
  return [...list]
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) || rank(a.priority) - rank(b.priority),
    )
    .map((t, i) => {
      const due =
        t.due == null
          ? ""
          : ` · ${t.due < now && !t.done ? "已逾期 " : ""}${new Date(t.due).toLocaleDateString("zh-CN")}`;
      return `${i + 1}. [${t.done ? "x" : " "}] ${t.text}（id: ${t.id}${due}）`;
    })
    .join("\n");
}
