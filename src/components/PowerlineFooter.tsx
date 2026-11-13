/**
 * Powerline 状态栏（pi-powerline-footer 的 Web 版）
 * ------------------------------------------------------------------
 * 一行显示当前会话的运行态：模型 / 模式 / 上下文 token / 提示词缓存命中 / 待办。
 * 数据来源都是真实值：usage 来自 pi-ai 归一化的 AssistantMessage.usage（含 cacheRead），
 * 待办来自 todos.ts；不做装饰性假数据。
 */
import { useMemo } from "react";
import type { TokenUsage } from "../lib/agent/piRunner";
import { todoStats } from "../lib/todos";

const MODE_LABEL: Record<string, string> = {
  fast: "快速",
  auto: "智能",
  deep: "深度",
};

const MODE_DOT: Record<string, string> = {
  fast: "bg-gray-400",
  auto: "bg-accent",
  deep: "bg-amber-500",
};

const fmt = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}m`;
};

export function PowerlineFooter({
  model,
  mode,
  usage,
  className = "",
}: {
  model?: string;
  mode: "fast" | "auto" | "deep";
  usage?: TokenUsage;
  className?: string;
}) {
  const todos = useMemo(() => todoStats(), [usage]);
  const cachePct =
    usage && usage.cacheRead > 0 && usage.input + usage.cacheRead > 0
      ? Math.round((usage.cacheRead / (usage.input + usage.cacheRead)) * 100)
      : null;

  return (
    <div
      className={
        "flex min-w-0 items-center justify-center gap-1.5 overflow-hidden text-[10px] leading-4 text-fg-muted/80 " +
        className
      }
      title="模型 · 模式 · 上下文 token · 提示词缓存命中 · 待办"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${MODE_DOT[mode] || "bg-gray-400"}`}
      />
      <span className="max-w-[26%] truncate">{model || "默认模型"}</span>
      <span className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
      <span className="shrink-0">{MODE_LABEL[mode] || mode}</span>
      {usage && usage.totalTokens > 0 && (
        <>
          <span className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
          <span
            className="shrink-0 tabular-nums"
            title="本次提问累计 token（输入 / 输出）"
          >
            ↑{fmt(usage.input)} ↓{fmt(usage.output)}
          </span>
        </>
      )}
      {cachePct !== null && (
        <>
          <span className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
          <span
            className="shrink-0 tabular-nums text-emerald-600/80 dark:text-emerald-400/80"
            title={`提示词缓存命中 ${fmt(usage!.cacheRead)} / ${fmt(usage!.cacheRead + usage!.input)}`}
          >
            缓存 {cachePct}%
          </span>
        </>
      )}
      {todos.open > 0 && (
        <>
          <span className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
          <span
            className={
              todos.overdue > 0 ? "shrink-0 text-amber-600" : "shrink-0"
            }
            title="未完成待办"
          >
            待办 {todos.open}
            {todos.overdue > 0 ? `（逾期 ${todos.overdue}）` : ""}
          </span>
        </>
      )}
    </div>
  );
}
