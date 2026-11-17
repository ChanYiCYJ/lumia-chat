/**
 * 间隔重复（Anki 式 SRS）
 * ------------------------------------------------------------------
 * 学习页「练习」把 AI 出的题变成记忆卡片，按 Again/Hard/Good/Easy 调度。
 * 纯本地存储 + 纯函数调度，便于单测；不做花哨概念，只保留能解释清楚的规则。
 */
export type Grade = "again" | "hard" | "good" | "easy";

export interface StudyCard {
  id: string;
  subjectId: string;
  nodeId: string;
  front: string;
  back: string;
  /** 下次到期时间戳 */
  due: number;
  /** 当前间隔（天，0 = 10 分钟级重来） */
  interval: number;
  /** 易度系数 1.3 - 2.8 */
  ease: number;
  reps: number;
  lapses: number;
  createdAt: number;
  updatedAt: number;
}

export const CARDS_KEY = "kimo_study_cards_v1";
const DAY = 86_400_000;
const MIN = 60_000;

function uid(): string {
  return "c" + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);
}

export function loadCards(): StudyCard[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CARDS_KEY) || "[]");
    return Array.isArray(raw) ? (raw as StudyCard[]) : [];
  } catch {
    return [];
  }
}

export function saveCards(cards: StudyCard[]): void {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  } catch {
    /* 忽略配额 */
  }
}

/** 从 AI 输出里解析「问：/答：」卡片（容忍编号、粗体与多余空行） */
export function parseCards(text: string, max = 6): { front: string; back: string }[] {
  const src = (text || "").replace(/```[\s\S]*?```/g, " ").replace(/\r/g, "");
  const out: { front: string; back: string }[] = [];
  const seen = new Set<string>();
  const re =
    /(?:^|\n)\s*(?:\d+[.、)]\s*)?(?:问|题目|Q)\s*[：:]\s*([\s\S]{2,300}?)\s*\n+\s*(?:答|答案|A)\s*[：:]\s*([\s\S]{1,300}?)(?=\n\s*(?:\d+[.、)]\s*)?(?:问|题目|Q)\s*[：:]|\n*$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && out.length < max) {
    const front = m[1].replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();
    const back = m[2].replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();
    if (front.length < 2 || back.length < 1) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ front: front.slice(0, 300), back: back.slice(0, 300) });
  }
  return out;
}

/** 给节点追加卡片；同节点同题干自动去重 */
export function addCards(
  subjectId: string,
  nodeId: string,
  pairs: { front: string; back: string }[],
  now = Date.now(),
): number {
  const cards = loadCards();
  const seen = new Set(
    cards.filter((c) => c.nodeId === nodeId).map((c) => c.front.trim().toLowerCase()),
  );
  let added = 0;
  for (const p of pairs) {
    const front = (p.front || "").trim();
    const back = (p.back || "").trim();
    const key = front.toLowerCase();
    if (front.length < 2 || !back || seen.has(key)) continue;
    seen.add(key);
    cards.push({
      id: uid(),
      subjectId,
      nodeId,
      front: front.slice(0, 300),
      back: back.slice(0, 300),
      due: now,
      interval: 0,
      ease: 2.3,
      reps: 0,
      lapses: 0,
      createdAt: now,
      updatedAt: now,
    });
    added += 1;
  }
  if (added) saveCards(cards);
  return added;
}

export function cardsForNode(nodeId: string): StudyCard[] {
  return loadCards().filter((c) => c.nodeId === nodeId);
}

export function cardsForSubject(subjectId: string): StudyCard[] {
  return loadCards().filter((c) => c.subjectId === subjectId);
}

/** 到期卡片（默认全库；传 subjectId 只看该科目） */
export function dueCards(subjectId?: string, now = Date.now()): StudyCard[] {
  return loadCards()
    .filter((c) => (!subjectId || c.subjectId === subjectId) && c.due <= now)
    .sort((a, b) => a.due - b.due);
}

export function removeCardsForNode(nodeId: string): void {
  saveCards(loadCards().filter((c) => c.nodeId !== nodeId));
}

export function removeCardsForSubject(subjectId: string): void {
  saveCards(loadCards().filter((c) => c.subjectId !== subjectId));
}

/** 纯调度：给定卡片与评分，返回更新后的卡片字段 */
export function schedule(
  card: Pick<StudyCard, "interval" | "ease" | "reps" | "lapses">,
  grade: Grade,
  now = Date.now(),
): Pick<StudyCard, "due" | "interval" | "ease" | "reps" | "lapses" | "updatedAt"> {
  let { interval, ease } = card;
  let reps = card.reps + 1;
  let lapses = card.lapses;

  switch (grade) {
    case "again":
      interval = 0;
      ease = Math.max(1.3, ease - 0.2);
      reps = 0;
      lapses += 1;
      break;
    case "hard":
      interval = interval < 1 ? 1 : Math.max(1, Math.round(interval * 1.2));
      ease = Math.max(1.3, ease - 0.15);
      break;
    case "good":
      interval = interval < 1 ? 1 : Math.max(1, Math.round(interval * ease));
      break;
    case "easy":
      interval = interval < 1 ? 3 : Math.max(2, Math.round(interval * ease * 1.3));
      ease = Math.min(2.8, ease + 0.15);
      break;
  }

  const due =
    grade === "again" ? now + 10 * MIN : now + interval * DAY;
  return {
    due,
    interval,
    ease: Math.round(ease * 100) / 100,
    reps,
    lapses,
    updatedAt: now,
  };
}

/** 评分并落库 */
export function gradeCard(cardId: string, grade: Grade, now = Date.now()): StudyCard | undefined {
  const cards = loadCards();
  const card = cards.find((c) => c.id === cardId);
  if (!card) return undefined;
  Object.assign(card, schedule(card, grade, now));
  saveCards(cards);
  return card;
}

export interface SrsStats {
  total: number;
  due: number;
  fresh: number;
  mature: number;
}

export function srsStats(subjectId?: string, now = Date.now()): SrsStats {
  const list = loadCards().filter((c) => !subjectId || c.subjectId === subjectId);
  return {
    total: list.length,
    due: list.filter((c) => c.due <= now).length,
    fresh: list.filter((c) => c.reps === 0).length,
    mature: list.filter((c) => c.interval >= 21).length,
  };
}

/** 下一次间隔的人话提示（评分按钮上展示） */
export function intervalLabel(card: StudyCard, grade: Grade): string {
  const next = schedule(card, grade);
  if (next.interval === 0) return "10 分钟";
  if (next.interval < 30) return `${next.interval} 天`;
  return `${Math.round(next.interval / 30)} 个月`;
}
