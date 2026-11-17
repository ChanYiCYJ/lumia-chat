/**
 * 学习库（AI 的后台数据）
 * ------------------------------------------------------------------
 * 学习的主舞台在对话里：课件、练习、复习都以卡片实时出现。
 * 这个页面只做「数据管理 + 观察」，类似知识库：
 *   - 看科目进度、知识点、课件摘要、卡片数量与到期情况
 *   - 删除科目/知识点（级联清理复习卡）
 *   - 想继续学习 → 一键回到对话，由 AI 生成卡片
 * 这里不再生成课件、不再出题、不再跑复习：避免两套流程互相打架。
 */
import { useMemo, useState } from "react";
import {
  NODE_TYPE_LABEL,
  loadSubjects,
  removeNode,
  removeSubject,
  subjectProgress,
} from "../lib/study";
import type { StudySubject } from "../lib/study";
import {
  cardsForNode,
  dueCards,
  removeCardsForNode,
  removeCardsForSubject,
  srsStats,
} from "../lib/srs";
import { useToast } from "../lib/toast";
import { ConfirmDialog } from "./ConfirmDialog";

function TrashIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  );
}

export function StudyWorkspace({
  onAsk,
  focusSubjectId,
}: {
  /** 回到对话并发送一条消息（继续学习 / 讲这节 / 复习） */
  onAsk: (text: string) => void;
  focusSubjectId?: string;
}) {
  const { toast } = useToast();
  const [version, setVersion] = useState(0);
  const [subjectId, setSubjectId] = useState(focusSubjectId);
  const [openNodeId, setOpenNodeId] = useState<string>();
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: string;
    onConfirm: () => void;
  } | null>(null);

  const subjects = useMemo(() => loadSubjects(), [version]);
  const subject =
    (subjectId ? subjects.find((s) => s.id === subjectId) : undefined) ||
    subjects[0];
  const progress = subject ? subjectProgress(subject) : null;
  const stats = srsStats();
  const dueAll = dueCards().length;
  const refresh = () => setVersion((v) => v + 1);

  const askDeleteSubject = (s: StudySubject) =>
    setConfirm({
      title: `删除科目「${s.name}」？`,
      message: `${s.nodes.length} 个知识点及其复习卡会一起删除，无法恢复。`,
      onConfirm: () => {
        removeSubject(s.id);
        removeCardsForSubject(s.id);
        setConfirm(null);
        setSubjectId(undefined);
        setOpenNodeId(undefined);
        refresh();
        toast("已删除科目");
      },
    });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-fg">学习库</h1>
          <p className="mt-0.5 truncate text-[11px] text-fg-muted">
            科目 · 知识点 · 卡片（课件与练习在对话里生成）
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-fg-muted">
          <span>{stats.total} 张卡</span>
          {dueAll > 0 && <span className="text-accent">{dueAll} 待复习</span>}
          <button
            onClick={() => onAsk("今天要复习什么")}
            className="cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
          >
            在对话里复习
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 科目 */}
        <aside className="shrink-0 overflow-y-auto border-b border-line p-2.5 lg:w-52 lg:border-b-0 lg:border-r">
          {subjects.length === 0 ? (
            <p className="px-1 py-3 text-[11px] leading-relaxed text-fg-muted">
              还没有内容。回到对话说「我想学线性代数」，AI
              会建科目、排路线并生成课件卡片。
            </p>
          ) : (
            <div className="space-y-0.5">
              {subjects.map((s) => {
                const p = subjectProgress(s);
                const due = dueCards(s.id).length;
                const on = subject?.id === s.id;
                return (
                  <div key={s.id} className="group relative">
                    <button
                      onClick={() => {
                        setSubjectId(s.id);
                        setOpenNodeId(undefined);
                      }}
                      className={
                        "w-full cursor-pointer rounded-[7px] px-2 py-1.5 pr-8 text-left transition " +
                        (on
                          ? "bg-sunken text-fg"
                          : "text-fg-muted hover:bg-sunken hover:text-fg")
                      }
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs">{s.name}</span>
                        <span className="shrink-0 text-[10px] tabular-nums opacity-70">
                          {p.done}/{p.total}
                        </span>
                      </span>
                      {due > 0 && (
                        <span className="mt-0.5 block text-[9px] text-accent">
                          {due} 张待复习
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => askDeleteSubject(s)}
                      aria-label={`删除科目 ${s.name}`}
                      title="删除科目"
                      className="absolute right-1 top-1.5 grid h-6 w-6 cursor-pointer place-items-center rounded-[6px] text-fg-muted opacity-0 transition hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* 科目详情 */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {!subject ? (
            <div className="grid h-full place-items-center text-center">
              <div className="max-w-sm">
                <p className="text-xs leading-relaxed text-fg-muted">
                  学习库是 AI 的后台：它读取这里的大纲与进度，把课件、练习、复习
                  做成对话卡片。先回对话里说一句「我想学…」。
                </p>
                <button
                  onClick={() => onAsk("我想学线性代数")}
                  className="mt-3 cursor-pointer rounded-control border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
                >
                  让 AI 建一个科目
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-2xl">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-fg">
                    {subject.name}
                  </h2>
                  {subject.goal && (
                    <p className="mt-0.5 text-[11px] text-fg-muted">
                      {subject.goal}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] tabular-nums text-fg-muted">
                    {progress?.done}/{progress?.total} 完成 ·{" "}
                    {srsStats(subject.id).total} 张卡 ·{" "}
                    {dueCards(subject.id).length} 待复习
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() =>
                      onAsk(
                        progress?.current
                          ? `讲课件：${subject.name} / ${progress.current.title}`
                          : `继续学：${subject.name}`,
                      )
                    }
                    className="cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
                  >
                    {progress?.current
                      ? `学「${progress.current.title}」`
                      : "继续学"}
                  </button>
                  <button
                    onClick={() => askDeleteSubject(subject)}
                    className="cursor-pointer rounded-control px-2 py-1 text-[11px] text-danger transition hover:bg-danger/10"
                  >
                    删除
                  </button>
                </div>
              </div>

              <ul className="mt-3 divide-y divide-line/60">
                {subject.nodes.map((n, i) => {
                  const nCards = cardsForNode(n.id);
                  const nDue = nCards.filter((c) => c.due <= Date.now()).length;
                  const open = openNodeId === n.id;
                  return (
                    <li key={n.id} className="group">
                      <div className="relative">
                        <button
                          onClick={() => setOpenNodeId(open ? undefined : n.id)}
                          className="flex w-full cursor-pointer items-center gap-2 px-1 py-2 pr-20 text-left transition hover:bg-sunken"
                        >
                          <span className="w-5 shrink-0 text-center text-[10px] text-fg-muted">
                            {n.status === "done" ? "✓" : i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-fg">
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">
                            {NODE_TYPE_LABEL[n.type]}
                            {n.content ? " · 课件" : ""}
                            {nCards.length ? ` · ${nCards.length} 卡` : ""}
                            {nDue ? ` · ${nDue} 待复习` : ""}
                          </span>
                        </button>
                        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            onClick={() =>
                              onAsk(`讲课件：${subject.name} / ${n.title}`)
                            }
                            title="让 AI 讲这节"
                            className="cursor-pointer rounded-[6px] px-1.5 py-1 text-[10px] text-fg-muted transition hover:bg-sunken hover:text-fg"
                          >
                            学
                          </button>
                          <button
                            onClick={() =>
                              setConfirm({
                                title: `删除知识点「${n.title}」？`,
                                message: "课件与该知识点的复习卡会一起删除。",
                                onConfirm: () => {
                                  removeNode(subject.id, n.id);
                                  removeCardsForNode(n.id);
                                  setConfirm(null);
                                  refresh();
                                  toast("已删除知识点");
                                },
                              })
                            }
                            aria-label={`删除知识点 ${n.title}`}
                            title="删除知识点"
                            className="grid h-6 w-6 cursor-pointer place-items-center rounded-[6px] text-fg-muted transition hover:bg-danger/10 hover:text-danger"
                          >
                            <TrashIcon className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {open && (
                        <div className="mb-2 ml-7 mr-1 rounded-control border border-line/70 bg-sunken/40 px-3 py-2">
                          {n.content ? (
                            <p className="line-clamp-4 text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted">
                              {n.content
                                .replace(/[#*`>]/g, "")
                                .slice(0, 400)}
                            </p>
                          ) : (
                            <p className="text-[11px] text-fg-muted">
                              还没有课件，点「学」让 AI 生成。
                            </p>
                          )}
                          {nCards.length > 0 && (
                            <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-fg-muted">
                              卡片：
                              {nCards
                                .slice(0, 3)
                                .map((c) => c.front)
                                .join(" / ")}
                              {nCards.length > 3
                                ? ` 等 ${nCards.length} 张`
                                : ""}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                {subject.nodes.length === 0 && (
                  <li className="px-1 py-6 text-center text-[11px] text-fg-muted">
                    还没有知识点。对 AI 说「给「{subject.name}」加几个知识点」。
                  </li>
                )}
              </ul>

              <p className="mt-4 text-[10px] leading-relaxed text-fg-muted">
                这里只管理数据。课件、出题、复习都在对话卡片里完成，评分会自动排进间隔重复。
              </p>
            </div>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ""}
        message={confirm?.message}
        confirmText="删除"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm()}
      />
    </div>
  );
}
