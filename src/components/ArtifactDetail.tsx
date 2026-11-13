import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact, ArtifactKind } from "../lib/artifacts";
import { artifactKindLabel, artifactUrl } from "../lib/artifacts";

/** 产物类型图标（列表/详情共用，尺寸由 className 控制） */
export function ArtifactKindIcon({
  kind,
  className = "h-3.5 w-3.5",
}: {
  kind: ArtifactKind;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "article":
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          <path d="M8 7h8M8 11h8M8 15h5" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      );
    case "web":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 014 9 15 15 0 01-4 9 15 15 0 01-4-9 15 15 0 014-9z" />
        </svg>
      );
    case "doc":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h6" />
        </svg>
      );
    case "kb":
      return (
        <svg {...common}>
          <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 4h11l5 5v11H4z" />
          <path d="M15 4v5h5M8 13h8M8 17h5" />
        </svg>
      );
  }
}

const KIND_TONE: Record<ArtifactKind, string> = {
  article: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
  search: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
  web: "bg-cyan-50 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-300",
  doc: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300",
  kb: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300",
  image: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
  note: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300",
};

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = Math.max(0, now - ts);
    if (diff < 60_000) return "刚刚";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    const sameDay = d.toDateString() === new Date().toDateString();
    if (sameDay)
      return `今天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    return d.toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function wordCount(text: string): number {
  return (text || "").replace(/\s+/g, "").length;
}

const PanelMarkdown = memo(function PanelMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <div className="markdown-body kimo-panel">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
});

/** 从 Markdown 中提取图片直链（图片产物展示用） */
function extractImages(md: string, max = 12): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) && out.length < max) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** 图标操作按钮：hover 显示 title；accent=主操作，danger=删除 */
function IconAction({
  label,
  onClick,
  children,
  accent,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={
        "grid h-6 w-6 place-content-center rounded-md transition active:scale-95 disabled:opacity-40 " +
        (accent
          ? "text-accent hover:bg-accent/10"
          : danger
            ? "text-gray-300 hover:bg-red-50 hover:text-red-500 dark:text-gray-600 dark:hover:bg-red-900/20"
            : "text-fg-muted hover:bg-sunken hover:text-fg")
      }
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        {children}
      </svg>
    </button>
  );
}

/**
 * 产物详情：统一阅读/操作视图（合并原 View 文章页与产物详情）。
 * - 文章/文档/网页/知识条/笔记：Markdown 正文
 * - 搜索：检索摘要 + 来源卡
 * - 图片：图片网格
 * 操作：复制、保存知识库、让 AI 继续优化、重新生成、删除
 */
export const ArtifactDetail = memo(function ArtifactDetail({
  artifact,
  busy,
  onSaveToKb,
  onDelete,
  onRegenerate,
  onAsk,
  onOpenKb,
  onBack,
}: {
  artifact: Artifact;
  busy?: boolean;
  onSaveToKb?: () => void;
  onDelete?: () => void;
  onRegenerate?: () => void;
  /** 把「基于该产物继续对话」的提示词发回聊天（让 Agent 主动接续） */
  onAsk?: (text: string) => void;
  onOpenKb?: () => void;
  /** 返回产物列表（列表/详情切换） */
  onBack?: () => void;
}) {
  const images = useMemo(
    () => (artifact.kind === "image" ? extractImages(artifact.content) : []),
    [artifact.kind, artifact.content],
  );
  const sources = artifact.sources || [];
  const words = wordCount(artifact.content);
  const hasText = !!artifact.content.trim();
  /** 网页产物可打开的地址（原网页 / 阅读模式切换） */
  const pageUrl = artifactUrl(artifact);
  /** 网页产物视图：read=抓取正文，web=嵌入原网页 */
  const [view, setView] = useState<"read" | "web">("read");
  // 切换产物时回到阅读模式，避免把上一页的预览状态带过来
  useEffect(() => setView("read"), [artifact.id]);

  const copy = () => {
    if (!hasText) return;
    void navigator.clipboard?.writeText(artifact.content).catch(() => {});
  };

  return (
    <article className="flex min-h-full flex-col">
      {/* 头部：返回 + 类型 + 标题 + 操作（图钉式单行，不占垂直空间） */}
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-line/70 bg-surface/95 px-2 py-1.5 backdrop-blur">
        {onBack && (
          <IconAction label="返回产物列表" onClick={onBack}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 12H5m7-7l-7 7 7 7"
            />
          </IconAction>
        )}
        <span
          className={
            "grid h-6 w-6 shrink-0 place-content-center rounded-[7px] " +
            (KIND_TONE[artifact.kind] || KIND_TONE.note)
          }
        >
          <ArtifactKindIcon kind={artifact.kind} className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12.5px] font-semibold leading-snug text-fg">
            {artifact.title || "未命名产物"}
          </h3>
          <p className="truncate text-[9px] text-fg-muted">
            {[
              artifactKindLabel(artifact.kind),
              formatTime(artifact.updatedAt),
              words > 0 ? `${words} 字` : "",
              sources.length > 0 ? `${sources.length} 源` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* 操作：图标按钮（hover 提示），主操作「续优化」保留描边高亮 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {onAsk && artifact.kind === "article" && (
            <IconAction
              label="让 AI 续优化"
              onClick={() => onAsk(`继续优化这篇文章：${artifact.title}`)}
              accent
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
              />
            </IconAction>
          )}
          {pageUrl && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              title="在新标签打开网页"
              aria-label="在新标签打开网页"
              className="grid h-6 w-6 place-content-center rounded-md text-fg-muted transition hover:bg-sunken hover:text-fg active:scale-95"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 6.75h4.5M6 17.25h11.25V12"
                />
              </svg>
            </a>
          )}
          {hasText && (
            <IconAction label="复制正文" onClick={copy}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </IconAction>
          )}
          {onSaveToKb && hasText && (
            <IconAction label="保存到知识库" onClick={onSaveToKb}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
              />
            </IconAction>
          )}
          {onOpenKb && artifact.kind === "kb" && (
            <IconAction label="打开知识库" onClick={onOpenKb}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </IconAction>
          )}
          {onRegenerate && artifact.kind === "article" && (
            <IconAction
              label={busy ? "重新生成中…" : "重新生成"}
              onClick={onRegenerate}
              disabled={busy}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992V4.356m-1.32 9.372a7.5 7.5 0 11-2.036-5.257l3.348 3.348"
              />
            </IconAction>
          )}
          {onDelete && (
            <IconAction label="删除产物" onClick={onDelete} danger>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"
              />
            </IconAction>
          )}
        </div>
      </header>

      {/* 网页产物：阅读模式 / 原网页预览切换（部分站点禁止嵌入时提示新标签打开） */}
      {artifact.kind === "web" && pageUrl && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line/70 px-2.5 py-1">
          <div className="flex rounded-control border border-line bg-sunken p-0.5">
            {(
              [
                ["read", "阅读"],
                ["web", "网页"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={
                  "rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium transition " +
                  (view === k
                    ? "bg-surface text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-none"
                    : "text-fg-muted hover:text-fg")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <span className="min-w-0 flex-1 truncate text-[9px] text-fg-muted">
            {pageUrl}
          </span>
        </div>
      )}

      {/* 正文：面板内使用紧凑排版（kimo-artifact 覆盖 18px 正文为 13px） */}
      <div
        className={
          view === "web" && artifact.kind === "web" && pageUrl
            ? "flex-1 p-2"
            : "kimo-artifact mx-auto w-full max-w-[72ch] flex-1 px-4 py-4 sm:px-5"
        }
      >
        {view === "web" && artifact.kind === "web" && pageUrl ? (
          <div className="flex flex-col gap-1">
            <iframe
              src={pageUrl}
              title={artifact.title || "网页预览"}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer"
              className="h-[62vh] min-h-[360px] w-full rounded-[8px] border border-line bg-white"
            />
            <p className="px-0.5 text-[9px] leading-relaxed text-fg-muted">
              若预览区空白或提示拒绝连接，说明该站点禁止被嵌入，请点右上角「在新标签打开网页」。
            </p>
          </div>
        ) : artifact.kind === "image" && images.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {images.map((src) => (
              <a
                key={src}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-[10px] border border-line bg-sunken"
              >
                <img
                  src={src}
                  alt={artifact.title}
                  loading="lazy"
                  className="h-24 w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
              </a>
            ))}
          </div>
        ) : hasText ? (
          <PanelMarkdown content={artifact.content} />
        ) : (
          <p className="py-6 text-center text-xs text-gray-300 dark:text-gray-600">
            这个产物还没有正文
          </p>
        )}

        {/* 来源卡：搜索/文章产物统一以卡片列出，可点击直达 */}
        {sources.length > 0 && (
          <section className="mt-5 border-t border-line/70 pt-3">
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
              参考来源 · {sources.length}
            </h4>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {sources.map((s, i) => (
                <li key={`${s.url}-${i}`}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-full flex-col gap-0.5 rounded-control border border-line bg-surface p-2 transition hover:border-line-strong hover:bg-sunken/60"
                  >
                    <span className="line-clamp-2 text-[11px] font-medium leading-snug text-fg">
                      {s.title || s.url}
                    </span>
                    <span className="truncate text-[9px] text-fg-muted">
                      {i + 1}.{" "}
                      {(() => {
                        try {
                          return new URL(s.url).hostname.replace(/^www\./, "");
                        } catch {
                          return s.url;
                        }
                      })()}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
});
