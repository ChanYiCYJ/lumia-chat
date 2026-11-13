/**
 * context-mode：上下文预算裁剪（接入 pi-agent-core 的 transformContext 钩子）
 * ------------------------------------------------------------------
 * 目的：长会话/多轮工具调用时，transcript 会不断变长，最终超模型上下文或
 * 让每轮都重复发送早期无关内容（浪费 token、拖慢首字）。
 *
 * 策略（保守，不破坏 tool_call/tool_result 配对）：
 *  - 保留首条 system 消息；
 *  - 从尾部往前累计字符预算，超预算的早期消息丢弃；
 *  - `role: "tool"` 的消息一律保留（它们是当前这轮的调用结果）；
 *  - 发生裁剪时插入一条 system 标记（只插一次）。
 */

export interface ContextMessage {
  role: string;
  content: unknown;
  timestamp?: number;
}

/** 粗略 token 估算：中文 ≈1 字/token，英文 ≈4 字符/token */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1;
  }
  const rest = text.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

export function messageChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  try {
    return JSON.stringify(content ?? "").length;
  } catch {
    return 0;
  }
}

export function messagesChars(messages: ContextMessage[]): number {
  return messages.reduce((sum, m) => sum + messageChars(m.content), 0);
}

const MARKER_PREFIX = "【上下文裁剪】";

export function isTrimMarker(m: ContextMessage): boolean {
  return (
    m.role === "system" &&
    typeof m.content === "string" &&
    m.content.startsWith(MARKER_PREFIX)
  );
}

/**
 * 按字符预算裁剪消息（纯函数，便于单测）。
 * @param maxChars 允许的最大正文字符数（默认 60k ≈ 30k tokens 量级）
 */
export function fitMessages<T extends ContextMessage>(
  messages: T[],
  maxChars = 60_000,
  now = Date.now(),
): T[] {
  if (!messages.length) return messages;
  if (messagesChars(messages) <= maxChars) return messages;

  const head: T[] = messages[0]?.role === "system" ? [messages[0]] : [];
  // 已存在的裁剪标记不重复计算
  const rest = messages.slice(head.length).filter((m) => !isTrimMarker(m));

  let used = head.reduce((s, m) => s + messageChars(m.content), 0);
  const kept: T[] = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const m = rest[i];
    const size = messageChars(m.content);
    if (m.role === "tool") {
      kept.unshift(m);
      used += size;
      continue;
    }
    // 至少保留最后 2 条（当前用户输入 + 上一条回答）；超预算即停止
    if (used + size > maxChars && kept.length >= 2) break;
    kept.unshift(m);
    used += size;
  }
  if (kept.length === rest.length) return messages;

  const dropped = rest.length - kept.length;
  const marker = {
    role: "system",
    content: `${MARKER_PREFIX}早期 ${dropped} 条消息已省略（context-mode，预算 ${Math.round(maxChars / 1000)}k 字符）；如需引用更早内容，请让用户重新提供。`,
    timestamp: now,
  } as T;
  return [...head, marker, ...kept];
}
