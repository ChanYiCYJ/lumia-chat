import { memo } from "react";

/**
 * 统一「Agent 活动卡」
 * ------------------------------------------------------------------
 * 把原先三块分散的 UI 合并成一张卡：
 *  1. 加载气泡（三点跳动）
 *  2. 「正在搜索…」胶囊
 *  3. 「已获取 N 条资料」搜索卡
 * 同一张卡按阶段推进（搜索 → 阅读来源 → 撰写），完成后原地变成结果摘要卡，
 * 不会出现「加载卡消失→另一张结果卡出现」的跳变。
 *
 * 同时供聊天区（本轮执行中）与 Agent 产物面板（后台浏览/生成中）复用。
 */
export type ActivityPhase = "search" | "read" | "generate" | "done" | "error";

const PHASE_INDEX: Record<ActivityPhase, number> = {
  search: 0,
  read: 1,
  generate: 2,
  done: 3,
  error: 3,
};

const PHASE_LABEL: Record<ActivityPhase, string> = {
  search: "正在搜索资料…",
  read: "正在阅读来源…",
  generate: "正在撰写内容…",
  done: "已完成",
  error: "执行未完成",
};

const STEPS = ["搜索", "阅读", "撰写"] as const;

function StepDots({ phase }: { phase: ActivityPhase }) {
  const idx = PHASE_INDEX[phase];
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((label, i) => {
        const done = idx > i;
        const active = idx === i && phase !== "done" && phase !== "error";
        return (
          <div key={label} className="flex items-center gap-1.5">
            {i > 0 && (
              <span
                className={
                  "h-px w-4 " +
                  (done || idx > i
                    ? "bg-accent/50"
                    : "bg-line dark:bg-gray-700")
                }
              />
            )}
            <span className="flex items-center gap-1">
              <span
                className={
                  "grid h-3.5 w-3.5 place-content-center rounded-full border " +
                  (done
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : active
                      ? "border-accent/60 text-accent"
                      : "border-line text-transparent dark:border-gray-700")
                }
              >
                {done ? (
                  <svg
                    className="h-2 w-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : active ? (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-current" />
                )}
              </span>
              <span
                className={
                  "text-[10px] font-medium " +
                  (done || active
                    ? "text-fg-muted"
                    : "text-gray-300 dark:text-gray-600")
                }
              >
                {label}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface ActivitySource {
  title?: string;
  url: string;
}

/** 实时活动行（工具调用）：让用户看到 Agent 具体在做什么，而不是只有一个加载圈 */
export interface ActivityItem {
  label: string;
  detail?: string;
  done?: boolean;
}

export const AgentActivityCard = memo(function AgentActivityCard({
  phase,
  query,
  note,
  sources,
  activities,
  chars,
  error,
  showSteps = true,
  onRetry,
  onOpen,
  openLabel = "查看产物",
}: {
  phase: ActivityPhase;
  /** 搜索主题/关键词（标题主文案） */
  query?: string;
  /** 额外一行说明（如「文章生成较慢，可稍后重试」） */
  note?: string;
  sources?: ActivitySource[];
  /** 本轮工具调用（按执行顺序），替代骨架屏展示真实活动 */
  activities?: ActivityItem[];
  /** 已生成字数（完成态展示） */
  chars?: number;
  error?: string;
  /** 是否展示「搜索→阅读→撰写」阶段条（普通聊天生成时不需要） */
  showSteps?: boolean;
  onRetry?: () => void;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const running = phase !== "done" && phase !== "error";
  const count = sources?.length || 0;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={
            "mt-0.5 grid h-6 w-6 shrink-0 place-content-center rounded-full " +
            (phase === "error"
              ? "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
              : phase === "done"
                ? "bg-accent/12 text-accent"
                : "bg-sunken text-fg-muted")
          }
        >
          {running ? (
            <svg
              className="h-3.5 w-3.5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : phase === "done" ? (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
              {phase === "error"
                ? error || "搜索失败"
                : query
                  ? `${PHASE_LABEL[phase]} · ${query}`
                  : PHASE_LABEL[phase]}
            </p>
            {!running && (
              <span className="shrink-0 text-[10px] text-fg-muted">
                {phase === "done" ? "完成" : "未完成"}
              </span>
            )}
          </div>

          {running && showSteps && (
            <div className="mt-1.5">
              <StepDots phase={phase} />
            </div>
          )}

          {(count > 0 || chars || note) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-fg-muted">
              {count > 0 && (
                <span className="inline-flex items-center gap-1">
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
                  </svg>
                  {count} 个来源
                </span>
              )}
              {!!chars && <span>{chars} 字</span>}
              {note && <span className="text-gray-400">{note}</span>}
            </div>
          )}

          {activities && activities.length > 0 && (
            <ul className="mt-2 space-y-1">
              {activities.slice(-4).map((a, i) => (
                <li
                  key={`${a.label}-${i}`}
                  className="flex items-center gap-1.5 text-[10px]"
                >
                  <span
                    className={
                      "h-1 w-1 shrink-0 rounded-full " +
                      (a.done ? "bg-accent" : "animate-pulse bg-fg-muted")
                    }
                  />
                  <span className="shrink-0 font-medium text-fg-muted">
                    {a.label}
                  </span>
                  {a.detail && (
                    <span className="min-w-0 truncate text-gray-400 dark:text-gray-500">
                      {a.detail}
                    </span>
                  )}
                  {!a.done && (
                    <span className="shrink-0 text-gray-300 dark:text-gray-600">
                      执行中…
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {running && (!activities || activities.length === 0) && (
            <div className="mt-2 space-y-1.5">
              <div className="h-2 w-4/5 animate-pulse rounded bg-sunken dark:bg-gray-800" />
              <div className="h-2 w-3/5 animate-pulse rounded bg-sunken dark:bg-gray-800" />
            </div>
          )}

          {!running && (onRetry || onOpen) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {onOpen && phase === "done" && (
                <button
                  onClick={onOpen}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-medium text-fg-muted transition hover:border-line-strong hover:text-fg active:scale-95"
                >
                  {openLabel}
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              )}
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-medium text-fg-muted transition hover:border-line-strong hover:text-fg active:scale-95"
                >
                  重新执行
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
