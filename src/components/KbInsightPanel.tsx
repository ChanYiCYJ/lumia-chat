/**
 * 知识库右栏（Obsidian 风格）：搜索片段 / 反向链接 / 出链 / 最近 / 标签 / Notion 同步
 * 只在全屏知识库页显示（lg 以上）。
 */
import { useMemo, useState } from "react";
import type { KbEntryRecord } from "../lib/kb";
import { allTags, buildKbGraph, recentKb, searchKb } from "../lib/kbVault";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          {title}
        </h3>
        {count != null && (
          <span className="text-[10px] text-fg-muted">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function LinkRow({
  name,
  exists,
  onClick,
}: {
  name: string;
  exists: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!exists}
      className={
        "flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left text-[11px] transition " +
        (exists
          ? "cursor-pointer text-fg hover:bg-sunken"
          : "cursor-default text-fg-muted/60 line-through")
      }
      title={exists ? "打开页面" : "页面不存在"}
    >
      <span className="h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
      <span className="truncate">{name}</span>
    </button>
  );
}

export function KbInsightPanel({
  entries,
  active,
  onOpen,
  onTag,
  notionReady,
  syncedCount,
  unsyncedCount,
  syncing,
  onSync,
  visible = true,
}: {
  entries: KbEntryRecord[];
  active?: KbEntryRecord;
  onOpen: (id: string) => void;
  onTag?: (tag: string) => void;
  notionReady: boolean;
  syncedCount: number;
  unsyncedCount: number;
  syncing?: boolean;
  onSync?: () => void;
  visible?: boolean;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchKb(entries, q, 8), [entries, q]);
  const graph = useMemo(
    () => (active ? buildKbGraph(entries, active) : null),
    [entries, active],
  );
  const recent = useMemo(() => recentKb(entries, 4), [entries]);
  const tags = useMemo(() => allTags(entries).slice(0, 12), [entries]);

  if (!visible) return null;

  return (
    <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface p-3 lg:flex">
      <div className="flex items-center gap-1.5 rounded-control border border-line bg-sunken px-2 py-1">
        <svg
          className="h-3.5 w-3.5 shrink-0 text-fg-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="全文搜索…"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      {q.trim() && (
        <div className="mt-1.5 space-y-1">
          {hits.length === 0 && (
            <p className="px-1 text-[10px] text-fg-muted">没有匹配内容</p>
          )}
          {hits.map((h) => (
            <button
              key={h.entry.id}
              onClick={() => onOpen(h.entry.id)}
              className="w-full cursor-pointer rounded-[8px] border border-line bg-surface px-2 py-1.5 text-left transition hover:bg-sunken"
            >
              <div className="truncate text-[11px] font-medium text-fg">
                {h.entry.name}
              </div>
              {h.snippet && (
                <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-fg-muted">
                  {h.snippet}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {active && graph && (
        <div className="mt-3 space-y-3">
          <Section title="反向链接" count={graph.backlinks.length}>
            {graph.backlinks.length ? (
              graph.backlinks.map((l) => (
                <LinkRow
                  key={l.id || l.name}
                  name={l.name}
                  exists
                  onClick={() => l.id && onOpen(l.id)}
                />
              ))
            ) : (
              <p className="px-1 text-[10px] text-fg-muted">
                还没有页面链接到这里
              </p>
            )}
          </Section>
          <Section
            title="出链"
            count={graph.outgoing.length + graph.dead.length}
          >
            {graph.outgoing.length === 0 && graph.dead.length === 0 && (
              <p className="px-1 text-[10px] text-fg-muted">
                用 [[页面名]] 建立双链
              </p>
            )}
            {graph.outgoing.map((l) => (
              <LinkRow
                key={l.id || l.name}
                name={l.name}
                exists
                onClick={() => l.id && onOpen(l.id)}
              />
            ))}
            {graph.dead.map((name) => (
              <LinkRow key={name} name={`${name}（未创建）`} exists={false} />
            ))}
          </Section>
        </div>
      )}

      <div className="mt-4">
        <Section title="最近更新">
          {recent.length === 0 ? (
            <p className="px-1 text-[10px] text-fg-muted">暂无页面</p>
          ) : (
            recent.map((e) => (
              <LinkRow
                key={e.id}
                name={e.name}
                exists
                onClick={() => onOpen(e.id)}
              />
            ))
          )}
        </Section>
      </div>

      <div className="mt-4">
        <Section title="标签" count={tags.length}>
          {tags.length === 0 ? (
            <p className="px-1 text-[10px] text-fg-muted">
              在正文里写 #标签 即可
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <button
                  key={t.tag}
                  onClick={() => onTag?.(t.tag)}
                  className="cursor-pointer rounded-full border border-line bg-sunken px-2 py-0.5 text-[10px] text-fg-muted transition hover:text-fg"
                >
                  #{t.tag} {t.count > 1 ? `·${t.count}` : ""}
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 rounded-control border border-line bg-sunken p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-fg-muted">
            Notion 同步
          </span>
          <span
            className={
              "text-[10px] " +
              (notionReady
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-fg-muted")
            }
          >
            {notionReady ? `${syncedCount}/${entries.length}` : "未连接"}
          </span>
        </div>
        {notionReady ? (
          unsyncedCount > 0 ? (
            <button
              disabled={syncing}
              onClick={onSync}
              className="mt-1.5 w-full cursor-pointer rounded-control border border-line bg-surface px-2 py-1 text-[10px] text-fg-muted transition hover:text-fg disabled:opacity-50"
            >
              {syncing ? "同步中…" : `同步 ${unsyncedCount} 条到 Notion`}
            </button>
          ) : (
            <p className="mt-1 text-[10px] text-fg-muted">全部已同步</p>
          )
        ) : (
          <p className="mt-1 text-[10px] leading-relaxed text-fg-muted">
            设置 → Notion 填 Token 后自动双向同步
          </p>
        )}
      </div>
    </aside>
  );
}
