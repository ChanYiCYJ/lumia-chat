/**
 * 插件共用的小工具（工具结果构造 / 失败 / 产物写入 / 网页标题推导）。
 * 只放与具体功能无关的通用逻辑，避免各插件重复实现。
 */
import { upsertArtifact } from "../../artifacts";
import type { Artifact, ArtifactKind } from "../../artifacts";
import type { ToolContext } from "./types";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
};

export const ok = (
  text: string,
  details: Record<string, unknown> = {},
): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

/** 失败一律 throw：pi 会转成 isError 的工具结果给模型重试 */
export const fail: (message: string) => never = (message) => {
  throw new Error(message);
};

/** 写产物并通知 UI（新增/更新同一入口） */
export function saveArtifact(
  ctx: ToolContext,
  input: {
    kind: ArtifactKind;
    title: string;
    content: string;
    topic?: string;
    url?: string;
    sources?: { title: string; url: string }[];
    id?: string;
  },
): Artifact {
  const artifact = upsertArtifact(ctx.pageId, {
    sessionId: ctx.sessionId,
    msgIdx: ctx.msgIdx,
    ...input,
  });
  ctx.onArtifact?.(artifact);
  return artifact;
}

/** 联网类工具的统一守卫（插件内部调用，保证 execute 单独调用时也安全） */
export function requireWeb(ctx: ToolContext, tool: string): void {
  if (!ctx.webEnabled) fail(`${tool} 已关闭：当前会话未开启联网搜索`);
  if (ctx.mode === "fast") fail(`${tool} 不可用：Fast 模式不允许联网`);
}

/** 从抓取到的正文推导网页标题（首行有效文本，失败则用域名） */
export function derivePageTitle(text: string, url: string): string {
  const first = text
    .split("\n")
    .map((s) => s.trim())
    .find(
      (s) =>
        s.length >= 2 &&
        s.length <= 80 &&
        !/^https?:\/\//i.test(s) &&
        !/^[#>*\-\s]+$/.test(s),
    );
  if (first) return first.slice(0, 80);
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** 搜索结果 → 给模型看的简短列表 */
export const searchResultsBrief = (
  results: {
    title?: string;
    url?: string;
    snippet?: string;
    description?: string;
  }[],
  max = 8,
): string =>
  results
    .slice(0, max)
    .map(
      (r, i) =>
        `${i + 1}. ${r.title || "(无标题)"} — ${r.url || ""}${
          r.snippet || r.description
            ? `\n   ${String(r.snippet || r.description).slice(0, 220)}`
            : ""
        }`,
    )
    .join("\n");
