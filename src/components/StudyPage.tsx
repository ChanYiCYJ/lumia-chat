/**
 * 学习页（借鉴 StudyMate：科目 → 知识点路线图 → 课件 → 练习 → 进度）
 * ------------------------------------------------------------------
 * AI 通过 onGenerate(prompt) 生成课件/题目，内容直接存进本地学习数据。
 * 页面由侧边栏「学习」进入，占满主区域（保留侧边栏与顶栏）。
 */
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  NODE_TYPE_LABEL,
  addNodes,
  clearNodeContent,
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
import { useToast } from "../lib/toast";
import { ConfirmDialog } from "./ConfirmDialog";

const TYPE_STYLE: Record<StudyNodeType, string> = {
  concept: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  practice:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  lab: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
};

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div
        className="h-full rounded-full bg-accent transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

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

/** 列表行内的轻量图标按钮 */
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

export function StudyPage({
  onGenerate,
}: {
  /** 调用模型生成文本（失败抛错） */
  onGenerate: (prompt: string) => Promise<string>;
}) {
  const { toast, success } = useToast();
  const [, setTick] = useState(0);
  const subjects = loadSubjects();
  const [subjectId, setSubjectId] = useState<string | undefined>(
    subjects[0]?.id,
  );
  const [nodeId, setNodeId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [outline, setOutline] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  /** 危险操作确认（删除科目/知识点/课件） */
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: string;
    onConfirm: () => void;
  } | null>(null);
  /** 科目信息编辑弹窗 */
  const [subjectEdit, setSubjectEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editGoal, setEditGoal] = useState("");
  /** 知识点重命名 */
  const [nodeEdit, setNodeEdit] = useState(false);
  const [nodeTitle, setNodeTitle] = useState("");
  /** 课件手改 */
  const [contentEdit, setContentEdit] = useState(false);
  const [contentDraft, setContentDraft] = useState("");
  const [outlineBusy, setOutlineBusy] = useState(false);

  const subject: StudySubject | undefined = useMemo(
    () => subjects.find((s) => s.id === subjectId) || subjects[0],
    [subjects, subjectId],
  );
  const node: StudyNode | undefined = subject?.nodes.find(
    (n) => n.id === nodeId,
  );
  const progress = subject ? subjectProgress(subject) : null;

  const refresh = () => setTick((t) => t + 1);

  /** 保存知识点标题 */
  const saveNodeTitle = () => {
    if (!subject || !node) return;
    const t = nodeTitle.trim();
    if (!t) {
      toast("标题不能为空", "error");
      return;
    }
    updateNode(subject.id, node.id, { title: t });
    setNodeEdit(false);
    refresh();
  };

  /** 删除科目（二次确认） */
  const askDeleteSubject = (s: StudySubject) => {
    setConfirm({
      title: `删除科目「${s.name}」？`,
      message: `将同时删除 ${s.nodes.length} 个知识点和已生成的课件，且无法恢复。`,
      onConfirm: () => {
        removeSubject(s.id);
        setConfirm(null);
        setSubjectId(undefined);
        setNodeId(undefined);
        setContentEdit(false);
        refresh();
        toast("已删除科目");
      },
    });
  };

  /** 删除知识点（二次确认） */
  const askDeleteNode = (s: StudySubject, n: StudyNode) => {
    setConfirm({
      title: `删除知识点「${n.title}」？`,
      message: "课件与练习会一起删除，且无法恢复。",
      onConfirm: () => {
        removeNode(s.id, n.id);
        setConfirm(null);
        setNodeId(undefined);
        setContentEdit(false);
        refresh();
        toast("已删除知识点");
      },
    });
  };

  /** 用 AI 填充知识点大纲（新建科目时） */
  const genOutline = async () => {
    const n = name.trim();
    if (!n) {
      toast("请先填写科目名称", "error");
      return;
    }
    if (outlineBusy) return;
    setOutlineBusy(true);
    try {
      const text = await onGenerate(
        [
          `科目：${n}`,
          `学习目标：${goal.trim() || "从入门到能独立应用"}`,
          "请设计一份 6-10 个知识点的学习路线图，先易后难、前后有依赖关系。",
          "只输出每行一条，格式：标题|concept 或 practice 或 lab；不要编号、不要解释、不要空行。",
        ].join("\n"),
      );
      const lines = text
        .split("\n")
        .map((l) => l.replace(/^[-*\d.、\s]+/, "").trim())
        .filter(Boolean);
      if (!lines.length) throw new Error("空内容");
      setOutline(lines.slice(0, 12).join("\n"));
      success("大纲已生成，可修改后创建");
    } catch (e) {
      toast(`生成失败：${e instanceof Error ? e.message : "请重试"}`, "error");
    } finally {
      setOutlineBusy(false);
    }
  };

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
          type: (t === "practice" || t === "lab"
            ? t
            : "concept") as StudyNodeType,
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

  const gen = async (kind: "lesson" | "quiz") => {
    if (!subject || !node || busy) return;
    setBusy(true);
    try {
      const text = await onGenerate(
        kind === "lesson"
          ? lessonPrompt(subject, node)
          : quizPrompt(subject, node),
      );
      if (!text.trim()) throw new Error("空内容");
      updateNode(subject.id, node.id, {
        content:
          kind === "lesson"
            ? text
            : `${node.content ? node.content + "\n\n---\n\n" : ""}## 练习\n\n${text}`,
        status: node.status === "todo" ? "doing" : node.status,
      });
      refresh();
      success(kind === "lesson" ? "课件已生成" : "练习题已生成");
    } catch (e) {
      toast(`生成失败：${e instanceof Error ? e.message : "请重试"}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-fg">学习</h1>
          <p className="mt-1 text-xs text-fg-muted">
            科目 → 知识点路线图 → AI 课件 → 练习，进度保存在本机
          </p>
        </div>
        <button
          className="cursor-pointer rounded-control bg-fg px-3 py-1.5 text-xs font-medium text-surface transition hover:opacity-90"
          onClick={() => setNewOpen(true)}
        >
          + 新建科目
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 科目列表 */}
        <aside className="shrink-0 overflow-y-auto border-b border-line p-3 lg:w-64 lg:border-b-0 lg:border-r">
          {subjects.length === 0 && (
            <p className="px-1 py-4 text-[11px] leading-relaxed text-fg-muted">
              还没有科目。点右上角「新建科目」，或在对话里说「我想学线性代数」让
              AI 建课。
            </p>
          )}
          <div className="space-y-1.5">
            {subjects.map((s) => {
              const p = subjectProgress(s);
              const on = subject?.id === s.id;
              return (
                <div key={s.id} className="group relative">
                  <button
                    onClick={() => {
                      setSubjectId(s.id);
                      setNodeId(undefined);
                      setNodeEdit(false);
                      setContentEdit(false);
                    }}
                    className={
                      "w-full cursor-pointer rounded-control border px-2.5 py-2 pr-8 text-left transition " +
                      (on
                        ? "border-accent/40 bg-accent/10"
                        : "border-line bg-surface hover:bg-sunken")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-fg">
                        {s.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-fg-muted">
                        {p.done}/{p.total}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar pct={p.pct} />
                    </div>
                  </button>
                  <div className="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
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

        {/* 科目详情 / 节点 */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {!subject ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <p className="text-sm text-fg-muted">
                选择一个科目，或新建一个开始学习。
              </p>
            </div>
          ) : node ? (
            <div className="mx-auto max-w-3xl px-6 py-5">
              <button
                className="mb-3 cursor-pointer text-[11px] text-fg-muted transition hover:text-fg"
                onClick={() => setNodeId(undefined)}
              >
                ← 返回路线图
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {nodeEdit ? (
                  <>
                    <input
                      autoFocus
                      value={nodeTitle}
                      onChange={(e) => setNodeTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveNodeTitle();
                        if (e.key === "Escape") setNodeEdit(false);
                      }}
                      className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2 py-1 text-sm text-fg outline-none focus:border-accent"
                    />
                    <button
                      onClick={saveNodeTitle}
                      className="cursor-pointer rounded-control bg-fg px-2 py-1 text-[11px] font-medium text-surface hover:opacity-90"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setNodeEdit(false)}
                      className="cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted hover:bg-sunken"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold text-fg">
                      {node.title}
                    </h2>
                    <IconButton
                      label="重命名知识点"
                      onClick={() => {
                        setNodeTitle(node.title);
                        setNodeEdit(true);
                      }}
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" />
                      </svg>
                    </IconButton>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${TYPE_STYLE[node.type]}`}
                    >
                      {NODE_TYPE_LABEL[node.type]}
                    </span>
                    <span className="text-[10px] text-fg-muted">
                      {node.status === "done"
                        ? "已完成"
                        : node.status === "doing"
                          ? "学习中"
                          : "未开始"}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  disabled={busy}
                  onClick={() => void gen("lesson")}
                  className="cursor-pointer rounded-control border border-line bg-surface px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:text-fg disabled:opacity-50"
                >
                  {busy
                    ? "生成中…"
                    : node.content
                      ? "重新生成课件"
                      : "生成课件"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void gen("quiz")}
                  className="cursor-pointer rounded-control border border-line bg-surface px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:text-fg disabled:opacity-50"
                >
                  出题考我
                </button>
                <button
                  onClick={() => {
                    updateNode(subject.id, node.id, {
                      status: node.status === "done" ? "todo" : "done",
                    });
                    refresh();
                  }}
                  className="cursor-pointer rounded-control border border-line bg-surface px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:text-fg"
                >
                  {node.status === "done" ? "标记未完成" : "标记完成"}
                </button>
                <button
                  onClick={() => {
                    setContentDraft(node.content);
                    setContentEdit((v) => !v);
                  }}
                  className="cursor-pointer rounded-control border border-line bg-surface px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:text-fg"
                >
                  {contentEdit ? "退出编辑" : "编辑内容"}
                </button>
                {node.content && (
                  <button
                    onClick={() =>
                      setConfirm({
                        title: "清空课件内容？",
                        message: "只清空这节课的课件/练习，知识点本身保留。",
                        onConfirm: () => {
                          clearNodeContent(subject.id, node.id);
                          setConfirm(null);
                          setContentEdit(false);
                          refresh();
                          toast("已清空课件");
                        },
                      })
                    }
                    className="cursor-pointer rounded-control border border-line bg-surface px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:text-fg"
                  >
                    清空课件
                  </button>
                )}
                <button
                  onClick={() => askDeleteNode(subject, node)}
                  className="ml-auto cursor-pointer rounded-control px-2.5 py-1.5 text-[11px] text-danger transition hover:bg-danger/10"
                >
                  删除知识点
                </button>
              </div>

              {contentEdit ? (
                <div className="mt-4 space-y-2">
                  <textarea
                    autoFocus
                    value={contentDraft}
                    onChange={(e) => setContentDraft(e.target.value)}
                    rows={18}
                    placeholder="直接编辑 Markdown 课件…"
                    className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        updateNode(subject.id, node.id, {
                          content: contentDraft,
                        });
                        setContentEdit(false);
                        refresh();
                        success("课件已保存");
                      }}
                      className="cursor-pointer rounded-control bg-fg px-3 py-1.5 text-[11px] font-medium text-surface hover:opacity-90"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setContentEdit(false)}
                      className="cursor-pointer rounded-control border border-line px-3 py-1.5 text-[11px] text-fg-muted hover:bg-sunken"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : node.content ? (
                <article className="prose-sm mt-4 max-w-none text-[13px] leading-relaxed text-fg [&_code]:rounded [&_code]:bg-sunken [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-base [&_h2]:mt-4 [&_h2]:text-sm [&_h3]:mt-3 [&_h3]:text-sm [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-sunken [&_pre]:p-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {node.content}
                  </ReactMarkdown>
                </article>
              ) : (
                <p className="mt-4 text-xs text-fg-muted">
                  还没有课件。点「生成课件」，AI 会按「直觉 → 定义 → 例子 → 误区
                  → 练习」写一份。
                </p>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-6 py-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-fg">
                    {subject.name}
                  </h2>
                  {subject.goal && (
                    <p className="mt-1 text-xs text-fg-muted">{subject.goal}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-fg-muted">
                    {progress?.done}/{progress?.total} 完成 · {progress?.pct}%
                  </span>
                  <button
                    className="cursor-pointer rounded-control border border-line bg-surface px-2 py-1 text-[11px] text-fg-muted transition hover:text-fg"
                    onClick={() => {
                      setEditName(subject.name);
                      setEditGoal(subject.goal);
                      setSubjectEdit(true);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="cursor-pointer rounded-control border border-line bg-surface px-2 py-1 text-[11px] text-fg-muted transition hover:text-fg"
                    onClick={() => setAddOpen(true)}
                  >
                    + 知识点
                  </button>
                  <button
                    className="cursor-pointer rounded-control px-2 py-1 text-[11px] text-danger transition hover:bg-danger/10"
                    onClick={() => askDeleteSubject(subject)}
                  >
                    删除科目
                  </button>
                </div>
              </div>
              <div className="mt-2">
                <ProgressBar pct={progress?.pct || 0} />
              </div>

              <ul className="mt-4 space-y-1.5">
                {subject.nodes.map((n, i) => (
                  <li key={n.id} className="group relative">
                    <button
                      onClick={() => {
                        setNodeId(n.id);
                        setNodeEdit(false);
                        setContentEdit(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-2 pr-20 text-left transition hover:border-line-strong hover:bg-sunken"
                    >
                      <span className="w-5 shrink-0 text-center text-[10px] text-fg-muted">
                        {n.status === "done" ? "✓" : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-fg">
                        {n.title}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${TYPE_STYLE[n.type]}`}
                      >
                        {NODE_TYPE_LABEL[n.type]}
                      </span>
                      <span className="shrink-0 text-[10px] text-fg-muted">
                        {n.status === "done"
                          ? "已完成"
                          : n.content
                            ? "有课件"
                            : "待学习"}
                      </span>
                    </button>
                    <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
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
                ))}
                {subject.nodes.length === 0 && (
                  <li className="rounded-control border border-dashed border-line px-4 py-8 text-center text-[11px] text-fg-muted">
                    还没有知识点。点「+
                    知识点」添加，或在对话里说「帮我给这门课排个路线图」。
                  </li>
                )}
              </ul>
            </div>
          )}
        </main>
      </div>

      {/* 新建科科目 */}
      {newOpen && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setNewOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-sheet border border-line bg-surface p-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]">
            <h3 className="text-base font-semibold text-fg">新建科目</h3>
            <div className="mt-3 space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="科目名，例如：线性代数"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="学习目标（可选），例如：两周内搞懂特征值与对角化"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-fg-muted">
                  知识点大纲（每行一个，可写 标题|类型）
                </span>
                <button
                  type="button"
                  disabled={outlineBusy || !name.trim()}
                  onClick={() => void genOutline()}
                  className="cursor-pointer rounded-control border border-line px-2 py-0.5 text-[10px] text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {outlineBusy ? "生成中…" : "AI 生成大纲"}
                </button>
              </div>
              <textarea
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                rows={5}
                placeholder={
                  "知识点大纲（每行一个，可写 标题|concept/practice/lab）\n向量与线性组合|concept\n矩阵乘法|practice\n特征值|concept"
                }
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-sm text-fg-muted hover:bg-sunken"
                onClick={() => setNewOpen(false)}
              >
                取消
              </button>
              <button
                className="flex-1 cursor-pointer rounded-control bg-fg px-3 py-2 text-sm font-medium text-surface hover:opacity-90"
                onClick={create}
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
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setAddOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-sheet border border-line bg-surface p-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]">
            <h3 className="text-base font-semibold text-fg">添加知识点</h3>
            <textarea
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              rows={4}
              placeholder={
                "每行一个：标题|concept/practice/lab\n例如：矩阵乘法|practice"
              }
              className="mt-3 w-full rounded-control border border-line bg-surface px-3 py-2 text-xs text-fg outline-none focus:border-accent"
            />
            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-sm text-fg-muted hover:bg-sunken"
                onClick={() => setAddOpen(false)}
              >
                取消
              </button>
              <button
                className="flex-1 cursor-pointer rounded-control bg-fg px-3 py-2 text-sm font-medium text-surface hover:opacity-90"
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
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 危险操作确认 */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ""}
        message={confirm?.message}
        confirmText="删除"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm()}
      />

      {/* 编辑科目信息 */}
      {subjectEdit && subject && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSubjectEdit(false)}
          />
          <div className="relative w-full max-w-md rounded-sheet border border-line bg-surface p-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]">
            <h3 className="text-base font-semibold text-fg">编辑科目</h3>
            <div className="mt-3 space-y-2">
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="科目名称"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
              <input
                value={editGoal}
                onChange={(e) => setEditGoal(e.target.value)}
                placeholder="学习目标（可选）"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-sm text-fg-muted hover:bg-sunken"
                onClick={() => setSubjectEdit(false)}
              >
                取消
              </button>
              <button
                className="flex-1 cursor-pointer rounded-control bg-fg px-3 py-2 text-sm font-medium text-surface hover:opacity-90"
                onClick={() => {
                  if (!editName.trim()) {
                    toast("科目名称不能为空", "error");
                    return;
                  }
                  updateSubject(subject.id, { name: editName, goal: editGoal });
                  setSubjectEdit(false);
                  refresh();
                  success("已保存");
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
