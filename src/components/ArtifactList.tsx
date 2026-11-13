import { useMemo, useState } from "react";
import type { Artifact, ArtifactKind } from "../lib/artifacts";
import { ARTIFACT_KINDS, artifactKindLabel } from "../lib/artifacts";
import { ArtifactKindIcon } from "./ArtifactDetail";

const KIND_STYLE: Record<ArtifactKind, string> = {
  article: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  search: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  web: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  doc: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  kb: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  image: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  note: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  } catch {
    return "";
  }
}

/** 正文摘要（去 Markdown 标记，用于卡片预览） */
function snippetOf(content: string, max = 90): string {
  const text = (content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_~[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function FilterChip({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-[10px] transition " +
        (active
          ? "border-accent/40 bg-accent/10 font-medium text-fg"
          : "border-line bg-surface text-fg-muted hover:text-fg")
      }
    >
      {icon}
      <span>{label}</span>
      {count != null && <span className="text-[9px] opacity-70">{count}</span>}
    </button>
  );
}

/**
 * 会话产物列表（产物面板顶部）
 * ------------------------------------------------------------------
 * 纯展示 + 回调，状态由 AIChat 持有（单实例数据源，避免双面板实例不同步）。
 * 本次升级：类型筛选 chip + 标题/正文搜索 + 卡片式条目（图标/类型/时间/来源数）。
 */
export function ArtifactList({
  items,
  activeId,
  onSelect,
  onDelete,
}: {
  items: Artifact[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [kind, setKind] = useState<"all" | ArtifactKind>("all");
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<ArtifactKind, number>();
    for (const a of items) map.set(a.kind, (map.get(a.kind) || 0) + 1);
    return map;
  }, [items]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter(
      (a) =>
        (kind === "all" || a.kind === kind) &&
        (!kw ||
          a.title.toLowerCase().includes(kw) ||
          (a.topic || "").toLowerCase().includes(kw) ||
          a.content.toLowerCase().includes(kw)),
    );
  }, [items, kind, q]);

  if (!items.length) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-sunken text-fg-muted">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 5h16v14H4z" />
            <path d="M8 9h8M8 13h5" />
          </svg>
        </span>
        <p className="text-xs font-medium text-fg">还没有产物</p>
        <p className="max-w-[220px] text-[11px] leading-relaxed text-fg-muted">
          让 AI 生成文章、搜索资料或写入文档后，会以卡片形式出现在这里
        </p>
      </div>
    );
  }

  const kinds = ARTIFACT_KINDS.filter((k) => (counts.get(k) || 0) > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具条：类型 chips（可横向滑动）+ 搜索开关 */}
      <div className="shrink-0 border-b border-line/70 px-2 py-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterChip
            active={kind === "all"}
            label={`全部 ${items.length}`}
            onClick={() => setKind("all")}
          />
          {kinds.map((k) => (
            <FilterChip
              key={k}
              active={kind === k}
              label={artifactKindLabel(k)}
              count={counts.get(k)}
              icon={
                <ArtifactKindIcon kind={k} className="h-2.5 w-2.5 opacity-70" />
              }
              onClick={() => setKind(kind === k ? "all" : k)}
            />
          ))}
          <button
            onClick={() => setSearchOpen((v) => !v)}
            title="搜索产物"
            aria-label="搜索产物"
            className={
              "ml-auto grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full border transition " +
              (searchOpen
                ? "border-accent/40 bg-accent/10 text-fg"
                : "border-transparent text-fg-muted hover:bg-sunken hover:text-fg")
            }
          >
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
          </button>
        </div>
        {searchOpen && (
          <div className="mt-1.5 flex h-7 items-center gap-1.5 rounded-control border border-line bg-surface px-2">
            <svg
              className="h-3 w-3 shrink-0 text-fg-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题或正文…"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-fg outline-none placeholder:text-fg-muted"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="shrink-0 cursor-pointer text-[10px] text-fg-muted hover:text-fg"
                aria-label="清空搜索"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="px-3 py-6 text-center text-[11px] text-fg-muted">
          没有匹配的产物
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          {shown.map((a) => {
            const active = a.id === activeId;
            return (
              <li key={a.id}>
                <div
                  className={
                    "group relative rounded-card border transition " +
                    (active
                      ? "border-accent/40 bg-accent/[0.06]"
                      : "border-line bg-surface hover:border-line-strong hover:bg-sunken/50")
                  }
                >
                  <button
                    onClick={() => onSelect(a.id)}
                    className="flex w-full cursor-pointer items-start gap-2.5 p-2.5 pr-8 text-left"
                  >
                    <span
                      className={
                        "mt-0.5 grid h-7 w-7 shrink-0 place-content-center rounded-[9px] " +
                        (KIND_STYLE[a.kind] || KIND_STYLE.note)
                      }
                    >
                      <ArtifactKindIcon kind={a.kind} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-xs font-medium text-fg">
                        {a.title || "未命名产物"}
                      </span>
                      {snippetOf(a.content) && (
                        <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-relaxed text-fg-muted">
                          {snippetOf(a.content)}
                        </span>
                      )}
                      <span className="mt-1 flex items-center gap-1 text-[9px] text-fg-muted">
                        <span className="rounded-full bg-sunken px-1.5 py-px">
                          {artifactKindLabel(a.kind)}
                        </span>
                        <span>{formatTime(a.updatedAt)}</span>
                        {(a.sources?.length || 0) > 0 && (
                          <span>· {a.sources?.length} 源</span>
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(a.id)}
                    title="删除产物"
                    aria-label="删除产物"
                    className="absolute right-1.5 top-1.5 grid h-6 w-6 cursor-pointer place-content-center rounded-[6px] text-fg-muted opacity-0 transition hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  >
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
