/**
 * 学习工作台：科目 → 知识点 → 课件（自动生成） → 练习（Anki 式间隔重复）
 * ------------------------------------------------------------------
 * 设计约束：
 *   - 没有「生成课件」按钮：打开知识点就自动生成，失败才出现重试
 *   - 课件与练习是两个页面（tab），练习自动出题并转成复习卡
 *   - 评分按 Again/Hard/Good/Easy 调度，科目页显示到期复习，形成循环
 *   - 视觉只有分隔线与文字，不堆彩色卡片
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  NODE_TYPE_LABEL,
  addNodes,
  createSubject,
  lessonPrompt,
  loadSubjects,
  moveNode,
  quizPrompt,
  removeNode,
  removeSubject,
  subjectProgress,
  updateNode,
  updateSubject,
} from "../lib/study";
import type { StudyNode, StudyNodeType, StudySubject } from "../lib/study";
import {
  addCards,
  cardsForNode,
  dueCards,
  gradeCard,
  intervalLabel,
  parseCards,
  removeCardsForNode,
  removeCardsForSubject,
} from "../lib/srs";
import type { Grade, StudyCard } from "../lib/srs";
import { useToast } from "../lib/toast";
import { ConfirmDialog } from "./ConfirmDialog";

const inputCls =
  "w-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-fg outline-none transition placeholder:text-fg-muted focus:border-accent";

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

function IconButton({
  label,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        "grid h-6 w-6 cursor-pointer place-items-center rounded-[6px] text-fg-muted transition hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-30 " +
        (danger ? "hover:bg-danger/10 hover:text-danger" : "hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <article className="mt-4 text-[13.5px] leading-7 text-fg [&_code]:rounded [&_code]:bg-sunken [&_code]:px-1 [&_h1]:my-3 [&_h1]:text-base [&_h2]:my-3 [&_h2]:text-sm [&_h3]:my-2 [&_h3]:text-sm [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-sunken [&_pre]:p-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}

const GRADES: { grade: Grade; label: string; cls: string }[] = [
  { grade: "again", label: "忘记", cls: "text-danger hover:bg-danger/10" },
  { grade: "hard", label: "模糊", cls: "text-amber-600 hover:bg-amber-500/10" },
  { grade: "good", label: "记住", cls: "text-emerald-600 hover:bg-emerald-500/10" },
  { grade: "easy", label: "简单", cls: "text-sky-600 hover:bg-sky-500/10" },
];

/** 单张卡复习（练习页与全局复习共用） */
function CardRunner({
  cards,
  emptyText,
  onGraded,
  onFinished,
}: {
  cards: StudyCard[];
  emptyText: string;
  onGraded?: () => void;
  onFinished?: (reviewed: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const card = cards[idx];

  if (!cards.length) {
    return <p className="mt-6 text-center text-xs text-fg-muted">{emptyText}</p>;
  }

  if (!card) {
    return (
      <div className="mt-8 space-y-3 text-center">
        <p className="text-sm font-medium text-fg">本轮完成 · {reviewed} 张</p>
        <p className="text-[11px] text-fg-muted">
          已按评分排进复习队列，下次打开会在「今日复习」里出现。
        </p>
        {onFinished && (
          <button
            onClick={() => onFinished(reviewed)}
            className="cursor-pointer rounded-control border border-line px-3 py-1.5 text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
          >
            完成
          </button>
        )}
      </div>
    );
  }

  const advance = (grade: Grade) => {
    gradeCard(card.id, grade);
    setRevealed(false);
    setReviewed((n) => n + 1);
    setIdx((n) => n + 1);
    onGraded?.();
  };

  return (
    <div className="mx-auto mt-5 w-full max-w-xl">
      <div className="flex items-center justify-between text-[10px] text-fg-muted">
        <span>
          {idx + 1} / {cards.length}
        </span>
        <span>
          复习 {card.reps} 次{card.lapses ? ` · 遗忘 ${card.lapses}` : ""}
        </span>
      </div>
      <button
        onClick={() => setRevealed(true)}
        className="mt-2 flex min-h-[140px] w-full cursor-pointer flex-col items-start justify-center rounded-card border border-line bg-surface px-5 py-6 text-left transition hover:border-line-strong"
      >
        <span className="text-[15px] font-medium leading-relaxed text-fg">
          {card.front}
        </span>
        {!revealed && (
          <span className="mt-3 text-[10px] text-fg-muted">点一下看答案</span>
        )}
      </button>
      {revealed ? (
        <>
          <div className="mt-3 rounded-card bg-sunken px-4 py-3 text-[13px] leading-relaxed text-fg">
            {card.back}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {GRADES.map((g) => (
              <button
                key={g.grade}
                onClick={() => advance(g.grade)}
                className={
                  "cursor-pointer rounded-control border border-line px-1 py-2 text-center transition " +
                  g.cls
                }
              >
                <span className="block text-[11px] font-medium">{g.label}</span>
                <span className="block text-[9px] opacity-70">
                  {intervalLabel(card, g.grade)}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="mt-3 w-full cursor-pointer rounded-control border border-line py-2 text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
        >
          显示答案
        </button>
      )}
    </div>
  );
}

export function StudyWorkspace({
  onGenerate,
}: {
  onGenerate: (prompt: string) => Promise<string>;
}) {
  const { toast, success } = useToast();
  const [subjects, setSubjects] = useState<StudySubject[]>(loadSubjects);
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [nodeId, setNodeId] = useState<string | undefined>();
  const [tab, setTab] = useState<"lesson" | "practice">("lesson");
  const [, force] = useState(0);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonErr, setLessonErr] = useState("");
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizErr, setQuizErr] = useState("");
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [contentEdit, setContentEdit] = useState(false);
  const [contentDraft, setContentDraft] = useState("");
  const [reviewCards, setReviewCards] = useState<StudyCard[] | null>(null);
  const attemptedRef = useRef<Set<string>>(new Set());

  // 新建/编辑/添加等弹窗
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [outline, setOutline] = useState("");
  const [outlineBusy, setOutlineBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [subjectEdit, setSubjectEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: string;
    onConfirm: () => void;
  } | null>(null);

  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) || subjects[0],
    [subjects, subjectId],
  );
  const node = subject?.nodes.find((n) => n.id === nodeId);
  const progress = subject ? subjectProgress(subject) : null;
  const dueAll = dueCards().length;
  const dueSubject = subject ? dueCards(subject.id).length : 0;
  const nodeDue = node ? dueCards(subject?.id).filter((c) => c.nodeId === node.id).length : 0;

  const refresh = () => {
    setSubjects(loadSubjects());
    force((n) => n + 1);
  };

  const saveLesson = (s: StudySubject, n: StudyNode, text: string) => {
    const clean = text
      .trim()
      .replace(/^```(?:markdown|md)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    if (clean.length < 80) throw new Error("课件太短，重新生成一次");
    if (/作为一个?\s*AI|我无法|以下是为你准备/.test(clean)) {
      throw new Error("课件内容不合规，重新生成一次");
    }
    updateNode(s.id, n.id, {
      content: clean,
      status: n.status === "todo" ? "doing" : n.status,
    });
    refresh();
  };

  const genLesson = async (s: StudySubject, n: StudyNode) => {
    setLessonBusy(true);
    setLessonErr("");
    try {
      const text = await onGenerate(lessonPrompt(s, n));
      saveLesson(s, n, text);
      success("课件已生成");
    } catch (e) {
      setLessonErr(e instanceof Error ? e.message : "生成失败，请重试");
    } finally {
      setLessonBusy(false);
    }
  };

  const genQuiz = async (s: StudySubject, n: StudyNode) => {
    setQuizBusy(true);
    setQuizErr("");
    try {
      const text = await onGenerate(quizPrompt(s, n));
      const pairs = parseCards(text);
      if (!pairs.length) throw new Error("没有解析到「问/答」，换模型或重试");
      const added = addCards(s.id, n.id, pairs);
      if (!added) throw new Error("题目与已有练习重复，先复习已有的卡片");
      setCards(cardsForNode(n.id));
      if (n.status === "todo") updateNode(s.id, n.id, { status: "doing" });
      refresh();
      success(`已生成 ${added} 张复习卡`);
    } catch (e) {
      setQuizErr(e instanceof Error ? e.message : "出题失败，请重试");
    } finally {
      setQuizBusy(false);
    }
  };

  // 打开知识点：自动生成课件（已有内容直接显示）
  useEffect(() => {
    attemptedRef.current = new Set();
    setContentEdit(false);
    setContentDraft("");
    setQuizErr("");
    setLessonErr("");
    setTab("lesson");
  }, [nodeId]);

  useEffect(() => {
    if (!node || !subject) return;
    const list = cardsForNode(node.id);
    setCards(list);
    if (node.content.trim()) return;
    if (attemptedRef.current.has(node.id + ":lesson")) return;
    attemptedRef.current.add(node.id + ":lesson");
    void genLesson(subject, node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, subject?.id]);

  // 切到练习：没有卡片就自动出题
  useEffect(() => {
    if (tab !== "practice" || !node || !subject) return;
    const list = cardsForNode(node.id);
    setCards(list);
    if (list.length || attemptedRef.current.has(node.id + ":quiz")) return;
    attemptedRef.current.add(node.id + ":quiz");
    void genQuiz(subject, node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, node?.id, subject?.id]);

  const openNode = (id: string) => {
    setNodeId(id);
  };

  const askDeleteSubject = (s: StudySubject) =>
    setConfirm({
      title: `删除科目「${s.name}」？`,
      message: `会删除 ${s.nodes.length} 个知识点及其复习卡，无法恢复。`,
      onConfirm: () => {
        removeSubject(s.id);
        removeCardsForSubject(s.id);
        setConfirm(null);
        setSubjectId(undefined);
        setNodeId(undefined);
        refresh();
        toast("已删除科目");
      },
    });

  const askDeleteNode = (s: StudySubject, n: StudyNode) =>
    setConfirm({
      title: `删除知识点「${n.title}」？`,
      message: "课件与该知识点的复习卡会一起删除。",
      onConfirm: () => {
        removeNode(s.id, n.id);
        removeCardsForNode(n.id);
        setConfirm(null);
        setNodeId(undefined);
        refresh();
        toast("已删除知识点");
      },
    });

  const create = () => {
    const lines = outline
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [title, type] = l.split("|");
        const t = (type || "").trim().toLowerCase();
        return {
          title,
          type: (t === "practice" || t === "lab" ? t : "concept") as StudyNodeType,
        };
      });
    const s = createSubject(name, goal, lines);
    if (!s) {
      toast("请填写科目名称", "error");
      return;
    }
    setName("");
    setGoal("");
    setOutline("");
    setNewOpen(false);
    setSubjectId(s.id);
    refresh();
    success(`已创建科目「${s.name}」`);
  };

  const genOutline = async () => {
    if (!name.trim()) {
      toast("先填科目名", "error");
      return;
    }
    setOutlineBusy(true);
    try {
      const text = await onGenerate(
        [
          `科目：${name.trim()}`,
          `学习目标：${goal.trim() || "从入门到能独立应用"}`,
          "设计 6-10 个知识点的顺序路线，先易后难、前后有依赖。",
          "只输出每行一条：标题|concept 或 practice 或 lab；不要编号、不要解释、不要空行。",
        ].join("\n"),
      );
      const lines = text
        .split("\n")
        .map((l) => l.replace(/^[-\d.、*\s]+/, "").trim())
        .filter(Boolean);
      if (!lines.length) throw new Error("空内容");
      setOutline(lines.slice(0, 12).join("\n"));
      success("大纲已生成");
    } catch (e) {
      toast(`生成失败：${e instanceof Error ? e.message : "请重试"}`, "error");
    } finally {
      setOutlineBusy(false);
    }
  };

  const saveSubject = () => {
    if (!subject) return;
    if (!editName.trim()) {
      toast("科目名称不能为空", "error");
      return;
    }
    updateSubject(subject.id, { name: editName, goal: editGoal });
    setSubjectEdit(false);
    refresh();
    success("已保存");
  };

  const startReview = (sid?: string) => {
    const list = dueCards(sid).slice(0, 20);
    if (!list.length) {
      toast("今天没有到期的复习", "error");
      return;
    }
    setReviewCards(list);
  };

  const current = progress?.current;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-base font-semibold text-fg">学习</h1>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            科目 · 课件 · 练习 · 复习
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {dueAll > 0 && (
            <button
              onClick={() => startReview()}
              className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
            >
              今日复习 {dueAll}
            </button>
          )}
          <button
            className="cursor-pointer rounded-control border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
            onClick={() => setNewOpen(true)}
          >
            + 新建科目
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 科目 */}
        <aside className="shrink-0 overflow-y-auto border-b border-line p-3 lg:w-56 lg:border-b-0 lg:border-r">
          {subjects.length === 0 && (
            <p className="px-1 py-3 text-[11px] leading-relaxed text-fg-muted">
              还没有科目。新建一个，或直接对 AI 说「我想学线性代数」。
            </p>
          )}
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
                      setNodeId(undefined);
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
                  <div className="absolute right-1 top-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton
                      label={`删除科目 ${s.name}`}
                      danger
                      onClick={() => askDeleteSubject(s)}
                    >
                      <TrashIcon className="h-3 w-3" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {/* 空态 */}
          {!subject && (
            <div className="grid h-full place-items-center text-center">
              <p className="text-xs text-fg-muted">
                选择左侧科目，或新建一个开始学习。
              </p>
            </div>
          )}

          {/* 知识点详情：课件 / 练习 */}
          {subject && node && (
            <div className="mx-auto w-full max-w-2xl">
              <button
                onClick={() => setNodeId(undefined)}
                className="cursor-pointer text-[11px] text-fg-muted transition hover:text-fg"
              >
                ← {subject.name}
              </button>
              <div className="mt-2 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold leading-snug text-fg">
                    {node.title}
                  </h2>
                  <p className="mt-0.5 text-[10px] text-fg-muted">
                    {NODE_TYPE_LABEL[node.type]} ·{" "}
                    {node.status === "done"
                      ? "已完成"
                      : node.status === "doing"
                        ? "学习中"
                        : "未开始"}
                    {cards.length > 0 && ` · ${cards.length} 张卡`}
                    {nodeDue > 0 && ` · ${nodeDue} 待复习`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => {
                      updateNode(subject.id, node.id, {
                        status: node.status === "done" ? "todo" : "done",
                      });
                      refresh();
                    }}
                    className="cursor-pointer rounded-control border border-line px-2 py-1 text-[10px] text-fg-muted transition hover:bg-sunken hover:text-fg"
                  >
                    {node.status === "done" ? "标记未完成" : "标记完成"}
                  </button>
                  <IconButton
                    label="删除知识点"
                    danger
                    onClick={() => askDeleteNode(subject, node)}
                  >
                    <TrashIcon className="h-3 w-3" />
                  </IconButton>
                </div>
              </div>

              {/* 课件 / 练习：两个页面 */}
              <div className="mt-3 flex w-full gap-0.5 rounded-control border border-line bg-sunken p-0.5">
                {(
                  [
                    ["lesson", "课件"],
                    ["practice", `练习${cards.length ? ` ${cards.length}` : ""}`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={
                      "flex-1 cursor-pointer rounded-[7px] px-2 py-1 text-[11px] transition " +
                      (tab === k
                        ? "bg-surface font-medium text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-none"
                        : "text-fg-muted hover:text-fg")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "lesson" && (
                <div>
                  {lessonBusy ? (
                    <p className="mt-6 animate-pulse text-xs text-fg-muted">
                      正在生成课件…
                    </p>
                  ) : lessonErr ? (
                    <div className="mt-4 rounded-control border border-danger/30 bg-danger/5 px-3 py-2.5 text-[11px] text-danger">
                      {lessonErr}
                      <button
                        onClick={() => void genLesson(subject, node)}
                        className="ml-2 cursor-pointer underline underline-offset-2"
                      >
                        重试
                      </button>
                    </div>
                  ) : contentEdit ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        autoFocus
                        value={contentDraft}
                        onChange={(e) => setContentDraft(e.target.value)}
                        rows={16}
                        className={inputCls + " font-mono text-[11px] leading-relaxed"}
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => {
                            updateNode(subject.id, node.id, { content: contentDraft });
                            setContentEdit(false);
                            refresh();
                            success("已保存");
                          }}
                          className="cursor-pointer rounded-control bg-fg px-2.5 py-1 text-[11px] text-surface hover:opacity-90"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setContentEdit(false)}
                          className="cursor-pointer rounded-control border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-sunken"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : node.content ? (
                    <>
                      <Markdown content={node.content} />
                      <button
                        onClick={() => {
                          setContentDraft(node.content);
                          setContentEdit(true);
                        }}
                        className="mt-4 cursor-pointer text-[10px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                      >
                        手动修正课件
                      </button>
                    </>
                  ) : (
                    !lessonErr && (
                      <p className="mt-6 text-xs text-fg-muted">
                        暂无课件，稍等或点上方重试。
                      </p>
                    )
                  )}
                </div>
              )}

              {tab === "practice" && (
                <div>
                  {quizBusy ? (
                    <p className="mt-6 animate-pulse text-xs text-fg-muted">
                      正在出 3 道题…
                    </p>
                  ) : quizErr ? (
                    <div className="mt-4 rounded-control border border-danger/30 bg-danger/5 px-3 py-2.5 text-[11px] text-danger">
                      {quizErr}
                      <button
                        onClick={() => void genQuiz(subject, node)}
                        className="ml-2 cursor-pointer underline underline-offset-2"
                      >
                        重试
                      </button>
                    </div>
                  ) : cards.length ? (
                    <CardRunner
                      key={`${node.id}-${cards.length}`}
                      cards={cards}
                      emptyText="这个知识点还没有复习卡。"
                      onGraded={refresh}
                      onFinished={() => {
                        refresh();
                        success("练习完成，已排入复习");
                      }}
                    />
                  ) : (
                    <p className="mt-6 text-xs text-fg-muted">
                      暂无练习，回到这里会自动生成。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 科目概览 */}
          {subject && !node && (
            <div className="mx-auto w-full max-w-2xl">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-fg">{subject.name}</h2>
                  {subject.goal && (
                    <p className="mt-0.5 text-[11px] text-fg-muted">{subject.goal}</p>
                  )}
                  <p className="mt-1 text-[11px] tabular-nums text-fg-muted">
                    {progress?.done}/{progress?.total} 完成
                    {dueSubject > 0 && ` · ${dueSubject} 张待复习`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {dueSubject > 0 && (
                    <button
                      onClick={() => startReview(subject.id)}
                      className="cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
                    >
                      复习 {dueSubject}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditName(subject.name);
                      setEditGoal(subject.goal);
                      setSubjectEdit(true);
                    }}
                    className="cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => setAddOpen(true)}
                    className="cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg"
                  >
                    + 知识点
                  </button>
                  <button
                    onClick={() => askDeleteSubject(subject)}
                    className="cursor-pointer rounded-control px-2 py-1 text-[11px] text-danger transition hover:bg-danger/10"
                  >
                    删除
                  </button>
                </div>
              </div>

              {current && (
                <button
                  onClick={() => openNode(current.id)}
                  className="mt-3 flex w-full cursor-pointer items-center gap-3 rounded-control border border-line px-3 py-2.5 text-left transition hover:border-line-strong hover:bg-sunken"
                >
                  <span className="text-[10px] text-fg-muted">继续</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
                    {current.title}
                  </span>
                  <span className="text-[10px] text-fg-muted">
                    {NODE_TYPE_LABEL[current.type]} →
                  </span>
                </button>
              )}

              <ul className="mt-3 divide-y divide-line/60">
                {subject.nodes.map((n, i) => {
                  const nCards = cardsForNode(n.id);
                  const nDue = nCards.filter((c) => c.due <= Date.now()).length;
                  return (
                    <li key={n.id} className="group relative">
                      <button
                        onClick={() => openNode(n.id)}
                        className="flex w-full cursor-pointer items-center gap-2 px-1 py-2 pr-20 text-left transition hover:bg-sunken"
                      >
                        <span className="w-5 shrink-0 text-center text-[10px] text-fg-muted">
                          {n.status === "done" ? "✓" : i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-fg">
                          {n.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-fg-muted">
                          {NODE_TYPE_LABEL[n.type]}
                          {n.content ? " · 有课件" : ""}
                          {nCards.length ? ` · ${nCards.length} 卡` : ""}
                          {nDue ? ` · ${nDue} 待复习` : ""}
                        </span>
                      </button>
                      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                        <IconButton
                          label="上移"
                          disabled={i === 0}
                          onClick={() => {
                            moveNode(subject.id, n.id, -1);
                            refresh();
                          }}
                        >
                          ↑
                        </IconButton>
                        <IconButton
                          label="下移"
                          disabled={i === subject.nodes.length - 1}
                          onClick={() => {
                            moveNode(subject.id, n.id, 1);
                            refresh();
                          }}
                        >
                          ↓
                        </IconButton>
                        <IconButton
                          label={`删除知识点 ${n.title}`}
                          danger
                          onClick={() => askDeleteNode(subject, n)}
                        >
                          <TrashIcon className="h-3 w-3" />
                        </IconButton>
                      </div>
                    </li>
                  );
                })}
                {subject.nodes.length === 0 && (
                  <li className="px-1 py-6 text-center text-[11px] text-fg-muted">
                    还没有知识点。加一个，打开就会自动生成课件。
                  </li>
                )}
              </ul>
            </div>
          )}
        </main>
      </div>

      {/* 全局/科目复习 */}
      {reviewCards && (
        <div className="fixed inset-0 z-[97] flex items-start justify-center overflow-y-auto bg-black/30 p-4 py-10">
          <div className="relative w-full max-w-xl rounded-sheet border border-line bg-surface p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-fg">复习</h3>
                <p className="mt-0.5 text-[11px] text-fg-muted">
                  {reviewCards.length} 张到期卡片 · 按真实记忆程度评分
                </p>
              </div>
              <button
                onClick={() => {
                  setReviewCards(null);
                  refresh();
                }}
                className="cursor-pointer rounded-control px-2 py-1 text-[11px] text-fg-muted hover:bg-sunken hover:text-fg"
              >
                关闭
              </button>
            </div>
            <CardRunner
              cards={reviewCards}
              emptyText="没有到期卡片。"
              onGraded={refresh}
              onFinished={() => {
                setReviewCards(null);
                refresh();
                success("复习完成");
              }}
            />
          </div>
        </div>
      )}

      {/* 新建科目 */}
      {newOpen && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setNewOpen(false)} />
          <div className="relative w-full max-w-md rounded-sheet border border-line bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">新建科目</h3>
            <div className="mt-3 space-y-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="科目名，例如：线性代数"
                className={inputCls}
              />
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="学习目标（可选）"
                className={inputCls}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-fg-muted">
                  知识点（每行一个，可写 标题|concept/practice/lab）
                </span>
                <button
                  disabled={outlineBusy || !name.trim()}
                  onClick={() => void genOutline()}
                  className="cursor-pointer rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-muted transition hover:text-fg disabled:opacity-40"
                >
                  {outlineBusy ? "生成中…" : "AI 生成大纲"}
                </button>
              </div>
              <textarea
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                rows={5}
                placeholder={"向量与线性组合|concept\n矩阵乘法|practice"}
                className={inputCls}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setNewOpen(false)}
                className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-xs text-fg-muted hover:bg-sunken"
              >
                取消
              </button>
              <button
                onClick={create}
                className="flex-1 cursor-pointer rounded-control bg-fg px-3 py-2 text-xs font-medium text-surface hover:opacity-90"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加知识点 */}
      {addOpen && subject && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAddOpen(false)} />
          <div className="relative w-full max-w-md rounded-sheet border border-line bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">添加知识点</h3>
            <textarea
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              rows={4}
              placeholder={"每行一个：标题|concept/practice/lab\n例如：矩阵乘法|practice"}
              className={inputCls + " mt-3"}
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setAddOpen(false)}
                className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-xs text-fg-muted hover:bg-sunken"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const nodes = addText
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => {
                      const [title, type] = l.split("|");
                      const t = (type || "").trim().toLowerCase();
                      return {
                        title,
                        type: (t === "practice" || t === "lab"
                          ? t
                          : "concept") as StudyNodeType,
                      };
                    });
                  const n = addNodes(subject.id, nodes);
                  if (n <= 0) {
                    toast("请输入至少一个知识点", "error");
                    return;
                  }
                  setAddText("");
                  setAddOpen(false);
                  refresh();
                  success(`已添加 ${n} 个知识点`);
                }}
                className="flex-1 cursor-pointer rounded-control bg-fg px-3 py-2 text-xs font-medium text-surface hover:opacity-90"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑科目 */}
      {subjectEdit && subject && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSubjectEdit(false)} />
          <div className="relative w-full max-w-md rounded-sheet border border-line bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">编辑科目</h3>
            <div className="mt-3 space-y-2">
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="科目名称"
                className={inputCls}
              />
              <input
                value={editGoal}
                onChange={(e) => setEditGoal(e.target.value)}
                placeholder="学习目标（可选）"
                className={inputCls}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setSubjectEdit(false)}
                className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-xs text-fg-muted hover:bg-sunken"
              >
                取消
              </button>
              <button
                onClick={saveSubject}
                className="flex-1 cursor-pointer rounded-control bg-fg px-3 py-2 text-xs font-medium text-surface hover:opacity-90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

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
