/**
 * 对话结果的来源抽取工具
 * ------------------------------------------------------------------
 * extractSourceLinks：把 AI 回复里的链接（Markdown 链接 / 裸 URL）抽出来，
 * 用于在消息下方以一行极简域名展示参考来源，而不是一长串裸露 URL。
 *
 * 纯函数、无副作用，便于单测；不依赖 React / DOM。
 */
export interface SourceLink {
  title: string;
  url: string;
  host: string;
}

const IMAGE_RE = /^!\[/;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function pushLink(
  out: SourceLink[],
  seen: Set<string>,
  title: string,
  rawUrl: string,
  max: number,
): void {
  const url = rawUrl.replace(/[)\]】>），。；！？"']+$/g, "");
  if (!/^https?:\/\//i.test(url)) return;
  const key = url
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!key || seen.has(key) || out.length >= max) return;
  seen.add(key);
  out.push({
    title: (title || hostOf(url) || url).slice(0, 80),
    url,
    host: hostOf(url),
  });
}

/**
 * 抽取回复中的来源链接（去重、去图片链接、跳过代码块）。
 * Markdown 链接优先（标题更好），再补裸 URL；按出现顺序取前 max 条。
 */
export function extractSourceLinks(text: string, max = 6): SourceLink[] {
  if (!text) return [];
  // 去掉围栏代码块（其中的 URL 多为示例，不是来源）
  const clean = text.replace(/```[\s\S]*?```/g, " ");
  const out: SourceLink[] = [];
  const seen = new Set<string>();

  const mdRe = /(!?)\[([^\]]{1,100})\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(clean)) && out.length < max) {
    if (IMAGE_RE.test(m[1] + "[")) continue;
    pushLink(out, seen, m[2], m[3], max);
  }

  // 裸 URL：先剔除图片 Markdown（图片不是参考来源）
  const bareText = clean.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  const bareRe = /https?:\/\/[^\s<>"'`）)】\]，。；！？]+/g;
  while ((m = bareRe.exec(bareText)) && out.length < max) {
    pushLink(out, seen, "", m[0], max);
  }
  return out;
}
