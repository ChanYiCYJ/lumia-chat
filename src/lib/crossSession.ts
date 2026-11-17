/**
 * 跨会话记忆摘要
 * ------------------------------------------------------------------
 * 当前会话只带自己的消息历史；为了让「换个对话」后 AI 仍记得之前聊过什么，
 * 这里把最近几个其它会话的要点压成一段短文本注入 system。
 * 纯函数，便于单测；不做 AI 调用，零额外成本。
 */
export interface SessionLike {
  id: string;
  title: string;
  createdAt?: number;
  messages: { role: string; content: string }[];
}

function plain(text: string, max: number): string {
  return (text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * 生成跨会话摘要（不含当前会话）。
 * @param maxSessions 最多取几个会话
 * @param exchanges  每个会话取最近几轮问答
 */
export function buildCrossSessionDigest(
  sessions: SessionLike[],
  currentId?: string,
  { maxSessions = 3, exchanges = 2, maxChars = 1200 } = {},
): string {
  const pick = sessions
    .filter((s) => s.id !== currentId && (s.messages?.length || 0) > 0)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, maxSessions);

  const blocks: string[] = [];
  for (const s of pick) {
    const users = s.messages
      .filter((m) => m.role === "user")
      .map((m) => plain(m.content, 80))
      .filter(Boolean)
      .slice(-exchanges);
    const answers = s.messages
      .filter((m) => m.role === "assistant")
      .map((m) => plain(m.content, 300))
      .filter((a) => a.length > 0 && a.length <= 160)
      .slice(-exchanges);
    if (!users.length) continue;
    const asked = users.map((u) => `“${u}”`).join("；");
    const replied = answers.length
      ? `（你当时的回复要点：${answers.map((a) => `“${a}”`).join("；")}）`
      : "";
    blocks.push(`- 会话「${plain(s.title, 24)}」用户说过：${asked}${replied}`);
  }

  if (!blocks.length) return "";
  let text =
    "【其他会话的记忆】以下是用户在其他会话里说过的话与聊过的主题（可能相关时自然衔接，不要逐条复述，也不要说“根据记忆”）：\n" +
    blocks.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "…";
  return text;
}
