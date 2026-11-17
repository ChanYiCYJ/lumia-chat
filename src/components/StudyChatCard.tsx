/**
 * 对话内的学习卡片（课件 / 练习 / 复习 / 路线图）
 * ------------------------------------------------------------------
 * 设计约束：
 *   - 卡片只存引用，内容实时来自学习库与 SRS 存储（改一次，处处一致）
 *   - 练习与复习直接在卡片里评分，评分即写入调度，不弹窗、不跳页
 *   - 需要 AI 出内容时只发一条自然语言请求（「练习：科目 / 知识点」），
 *     由 Agent 调工具生成新卡片，卡片自身不藏第二条生成通道
 *   - 视觉：一条分隔线 + 文字，不堆彩色胶囊
 */
import { memo, useMemo, useState } from "react";
import { FusionMarkdown } from "../lib/FusionMarkdown";
import { NODE_TYPE_LABEL, loadSubjects, subjectProgress } from "../lib/study";
import type { StudyNode, StudySubject } from "../lib/study";
import {
  cardsForNode,
  cardsForSubject,
  dueCards,
  gradeCard,
  intervalLabel,
  loadCards,
} from "../lib/srs";
import type { Grade, StudyCard } from "../lib/srs";
import type { StudyChatCardKind, StudyChatCardRef } from "../lib/studyChat";

const KIND_LABEL: Record<StudyChatCardKind, string> = {
  plan: "学习路线",
  lesson: "课件",
  practice: "练习",
  review: "复习",
};

const PENDING_TEXT: Record<StudyChatCardKind, string> = {
  plan: "正在整理学习路线…",
  lesson: "正在生成课件…",
  practice: "正在出题…",
  review: "正在统计到期卡片…",
};

const GRADES: { grade: Grade; label: string; cls: string }[] = [
  { grade: "again", label: "忘记", cls: "text-danger hover:bg-danger/10" },
  { grade: "hard", label: "模糊", cls: "text-amber-600 hover:bg-amber-500/10" },
  {
    grade: "good",
    label: "记住",
    cls: "text-emerald-600 hover:bg-emerald-500/10",
  },
  { grade: "easy", label: "简单", cls: "text-sky-600 hover:bg-sky-500/10" },
];

function untilText(ts: number, now = Date.now()): string {
  const diff = Math.max(0, ts - now);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "现在";
  if (min < 60) return `${min} 分钟后`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时后`;
  return `${Math.round(hour / 24)} 天后`;
}

/** 卡片内复习：逐张显示 → 看答案 → 四档评分（评分直接落库） */
function MiniReview({ cards }: { cards: StudyCard[] }) {
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  const card = queue[0];
  const done = cards.length - queue.length;

  if (!cards.length) {
    return <p className="text-[11px] text-fg-muted">还没有复习卡。</p>;
  }
  if (!card) {
    return (
      <p className="text-[11px] leading-relaxed text-fg-muted">
        本轮完成 {cards.length} 张，已按评分排进复习队列。
      </p>
    );
  }
  const grade = (g: Grade) => {
    gradeCard(card.id, g);
    setRevealed(false);
    setQueue((q) => q.slice(1));
  };

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] tabular-nums text-fg-muted">
        <span>
          {done + 1} / {cards.length}
        </span>
        <span>
          复习 {card.reps} 次{card.lapses ? ` · 遗忘 ${card.lapses}` : ""}
        </span>
      </div>
      <div className="mt-1.5 rounded-control border border-line bg-surface px-3 py-2.5">
        <p className="text-[13px] font-medium leading-relaxed whitespace-pre-wrap text-fg">
          {card.front}
        </p>
        {revealed ? (
          <p className="mt-2 border-t border-line/60 pt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
            {card.back}
          </p>
        ) : (
          <button
            onClick={() => setRevealed(true)}
            className="mt-2 cursor-pointer text-[10px] text-fg-muted underline-offset-2 transition hover:text-fg hover:underline"
          >
            显示答案
          </button>
        )}
      </div>
      {revealed && (
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {GRADES.map((g) => (
            <button
              key={g.grade}
              onClick={() => grade(g.grade)}
              className={
                "cursor-pointer rounded-[6px] border border-line px-1 py-1.5 text-center transition " +
                g.cls
              }
            >
              <span className="block text-[11px] font-medium">{g.label}</span>
              <span className="block text-[9px] tabular-nums opacity-70">
                {intervalLabel(card, g.grade)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 科目概览：进度 + 知识点路线（点一行 = 让 AI 讲这节） */
function PlanBody({
  subject,
  busy,
  onAsk,
}: {
  subject: StudySubject;
  busy: boolean;
  onAsk: (text: string) => void;
}) {
  const progress = subjectProgress(subject);
  const shown = subject.nodes.slice(0, 10);
  return (
    <div>
      {subject.goal && (
        <p className="text-[11px] leading-relaxed text-fg-muted">
          {subject.goal}
        </p>
      )}
      <p className="mt-1 text-[10px] tabular-nums text-fg-muted">
        {progress.done}/{progress.total} 完成
        {progress.current ? ` · 当前：${progress.current.title}` : " · 已全部完成"}
      </p>
      {shown.length > 0 && (
        <ul className="mt-1.5 divide-y divide-line/60">
          {shown.map((n, i) => (
            <li key={n.id}>
              <button
                disabled={busy}
                onClick={() => onAsk(`讲课件：${subject.name} / ${n.title}`)}
                className="flex w-full cursor-pointer items-center gap-2 py-1.5 text-left transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="w-4 shrink-0 text-center text-[9px] text-fg-muted">
                  {n.status === "done" ? "✓" : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg">
                  {n.title}
                </span>
                <span className="shrink-0 text-[9px] text-fg-muted">
                  {NODE_TYPE_LABEL[n.type]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {subject.nodes.length > shown.length && (
        <p className="mt-1 text-[9px] text-fg-muted">
          还有 {subject.nodes.length - shown.length} 个知识点，见学习库
        </p>
      )}
      {progress.current && (
        <button
          disabled={busy}
          onClick={() =>
            onAsk(`讲课件：${subject.name} / ${progress.current!.title}`)
          }
          className="mt-2 w-full cursor-pointer rounded-control border border-line py-1.5 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          开始学「{progress.current.title}」
        </button>
      )}
    </div>
  );
}

function LessonBody({
  subject,
  node,
  busy,
  onAsk,
}: {
  subject: StudySubject;
  node: StudyNode;
  busy: boolean;
  onAsk: (text: string) => void;
}) {
  if (!node.content.trim()) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-fg-muted">课件还没生成。</p>
        <button
          disabled={busy}
          onClick={() => onAsk(`讲课件：${subject.name} / ${node.title}`)}
          className="shrink-0 cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          生成课件
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="chat-md max-h-[340px] overflow-y-auto pr-1 text-[13px] leading-6">
        <FusionMarkdown content={node.content} />
      </div>
      <button
        disabled={busy}
        onClick={() => onAsk(`练习：${subject.name} / ${node.title}`)}
        className="mt-2.5 cursor-pointer rounded-control border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
      >
        出题练习
      </button>
    </div>
  );
}

function PracticeBody({
  subject,
  node,
  busy,
  onAsk,
}: {
  subject: StudySubject;
  node: StudyNode;
  busy: boolean;
  onAsk: (text: string) => void;
}) {
  const cards = useMemo(
    () => [...cardsForNode(node.id)].sort((a, b) => a.due - b.due),
    [node.id],
  );
  if (!cards.length) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-fg-muted">这个知识点还没有练习卡。</p>
        <button
          disabled={busy}
          onClick={() => onAsk(`练习：${subject.name} / ${node.title}`)}
          className="shrink-0 cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          出 3 道题
        </button>
      </div>
    );
  }
  return <MiniReview key={`${node.id}-${cards.length}`} cards={cards} />;
}

function ReviewBody({
  subject,
  busy,
  onAsk,
}: {
  subject?: StudySubject;
  busy: boolean;
  onAsk: (text: string) => void;
}) {
  const due = useMemo(() => dueCards(subject?.id), [subject?.id]);
  const nextDue = useMemo(() => {
    const all = subject
      ? cardsForSubject(subject.id)
      : loadCards();
    const future = all
      .map((c) => c.due)
      .filter((t) => t > Date.now())
      .sort((a, b) => a - b);
    return future[0];
  }, [subject?.id]);

  if (due.length) {
    return <MiniReview key={`${subject?.id || "all"}-${due.length}`} cards={due} />;
  }
  const progress = subject ? subjectProgress(subject) : undefined;
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] text-fg-muted">
        今天没有到期卡片
        {nextDue ? `，下一张 ${untilText(nextDue)}` : "。"}
      </p>
      {progress?.current && (
        <button
          disabled={busy}
          onClick={() =>
            onAsk(`讲课件：${subject!.name} / ${progress.current!.title}`)
          }
          className="shrink-0 cursor-pointer rounded-control border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          继续学
        </button>
      )}
    </div>
  );
}

export const StudyChatCard = memo(function StudyChatCard({
  card,
  busy,
  onAsk,
  onOpen,
}: {
  card: StudyChatCardRef;
  /** 正在生成别的回复：卡片动作先禁用，避免点了没反应 */
  busy: boolean;
  onAsk: (text: string) => void;
  onOpen: (subjectId?: string) => void;
}) {
  const subjects = useMemo(() => loadSubjects(), [card]);
  const subject = card.subjectId
    ? subjects.find((s) => s.id === card.subjectId)
    : undefined;
  const node = subject
    ? card.nodeId
      ? subject.nodes.find((n) => n.id === card.nodeId)
      : card.kind === "lesson" || card.kind === "practice"
        ? subjectProgress(subject).current
        : undefined
    : undefined;

  const title = subject
    ? `${subject.name}${node ? ` · ${node.title}` : ""}`
    : card.kind === "review"
      ? "全部科目"
      : KIND_LABEL[card.kind];
  const askText = (() => {
    if (!subject) return "继续学习";
    if (card.kind === "review") return "今天要复习什么";
    if (!node) return `继续学：${subject.name}`;
    return card.kind === "practice"
      ? `练习：${subject.name} / ${node.title}`
      : `讲课件：${subject.name} / ${node.title}`;
  })();

  return (
    <section className="mt-2.5 overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line/70 px-3 py-1.5">
        <span className="shrink-0 text-[10px] text-fg-muted">
          {KIND_LABEL[card.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg">
          {title}
        </span>
        <button
          onClick={() => onOpen(subject?.id)}
          className="shrink-0 cursor-pointer text-[10px] text-fg-muted underline-offset-2 transition hover:text-fg hover:underline"
          title="打开学习库（后台数据）"
        >
          学习库
        </button>
      </header>

      <div className="px-3 py-2.5">
        {card.pending ? (
          <p className="animate-pulse text-[11px] text-fg-muted">
            {PENDING_TEXT[card.kind]}
          </p>
        ) : card.error ? (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-[11px] text-danger">
              {card.error}
            </p>
            <button
              disabled={busy}
              onClick={() => onAsk(askText)}
              className="shrink-0 cursor-pointer text-[10px] text-fg-muted underline underline-offset-2 transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              重试
            </button>
          </div>
        ) : card.kind === "review" ? (
          <ReviewBody subject={subject} busy={busy} onAsk={onAsk} />
        ) : !subject ? (
          <p className="text-[11px] text-fg-muted">
            这张卡片对应的内容已从学习库删除。
          </p>
        ) : card.kind === "plan" ? (
          <PlanBody subject={subject} busy={busy} onAsk={onAsk} />
        ) : card.kind === "lesson" && node ? (
          <LessonBody
            subject={subject}
            node={node}
            busy={busy}
            onAsk={onAsk}
          />
        ) : card.kind === "practice" && node ? (
          <PracticeBody
            subject={subject}
            node={node}
            busy={busy}
            onAsk={onAsk}
          />
        ) : (
          <p className="text-[11px] text-fg-muted">
            这个知识点已不在科目里，打开学习库查看最新内容。
          </p>
        )}
      </div>
    </section>
  );
});
