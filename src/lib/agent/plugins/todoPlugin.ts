/**
 * 待办插件（rpiv-todo）：让 AI 能记住用户的多步任务并推进
 */
import type { AgentPlugin } from "./types";
import {
  addTodo,
  clearDone,
  formatTodos,
  loadTodos,
  todoStats,
  toggleTodo,
  removeTodo,
} from "../../todos";
import { fail, ok } from "./shared";

const plugin: AgentPlugin = {
  id: "todo",
  name: "待办清单",
  priority: 35,

  ui: {
    todo_add: { type: "待办" },
    todo_list: { type: "待办" },
    todo_done: { type: "待办" },
    todo_remove: { type: "待办" },
    todo_clear: { type: "待办" },
  },

  promptLines: () =>
    `- 【待办】用户布置多步任务、或说“记一下要做…”/“别忘了”时，用 todo_add 记一条；完成后 todo_done 勾掉。
- 用户问“还有什么没做/进度”时用 todo_list；一次性清理已完成用 todo_clear。不要把一句话拆成很多条待办。
`,

  tools: () => [
    {
      name: "todo_add",
      label: "加待办",
      description: "新增一条待办（可带截止日期与优先级）。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "待办内容（一句话）" },
          due: {
            type: "string",
            description: "可选截止日期，YYYY-MM-DD",
          },
          priority: {
            type: "number",
            description: "优先级：1=高 2=中 3=低",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as { text?: string; due?: string; priority?: number };
        const due = p.due ? Date.parse(p.due) : undefined;
        if (p.due && Number.isNaN(due)) fail("due 格式应为 YYYY-MM-DD");
        const priority = ([1, 2, 3] as number[]).includes(Number(p.priority))
          ? (Number(p.priority) as 1 | 2 | 3)
          : undefined;
        const todo = addTodo(String(p.text || ""), { due, priority });
        if (!todo) fail("text 不能为空");
        const s = todoStats();
        return ok(`已加入待办：${todo.text}（剩余 ${s.open} 项）`, {
          id: todo.id,
        });
      },
    },
    {
      name: "todo_list",
      label: "看待办",
      description: "列出待办清单（未完成优先，含 id 便于完成/删除）。",
      parameters: {
        type: "object",
        properties: {
          includeDone: { type: "boolean", description: "是否包含已完成" },
        },
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const includeDone = !!(raw as { includeDone?: boolean }).includeDone;
        const list = loadTodos().filter((t) => includeDone || !t.done);
        return ok(formatTodos(list), { count: list.length });
      },
    },
    {
      name: "todo_done",
      label: "完成待办",
      description: "按 id 勾选/取消一条待办。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "待办 id（todo_list 返回）" },
          done: { type: "boolean", description: "true=完成 false=取消完成" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const p = raw as { id?: string; done?: boolean };
        const t = toggleTodo(String(p.id || ""), p.done);
        if (!t) fail("没有找到该待办");
        return ok(`${t.done ? "已完成" : "已恢复"}：${t.text}`, { id: t.id });
      },
    },
    {
      name: "todo_remove",
      label: "删除待办",
      description: "按 id 删除一条待办。",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const id = String((raw as { id?: string }).id || "");
        if (!removeTodo(id)) fail("没有找到该待办");
        return ok("已删除待办", { id });
      },
    },
    {
      name: "todo_clear",
      label: "清理已完成",
      description: "清除所有已完成的待办。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const n = clearDone();
        return ok(n ? `已清理 ${n} 条已完成待办` : "没有已完成的待办", {
          removed: n,
        });
      },
    },
  ],
};

export default plugin;
