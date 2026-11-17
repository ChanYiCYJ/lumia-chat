/**
 * 单次文本补全（学习页课件/出题、摘要等非聊天场景）
 * ------------------------------------------------------------------
 * 与聊天共用同一份模型配置，但不流式、不带工具。做了几件事：
 *   - 地址兜底（允许已带 /chat/completions）
 *   - 120s 超时 + 明确错误（附 HTTP 响应片段）
 *   - 兼容代理无视 stream:false 返回 SSE 的情况
 *   - 空内容给出可行动提示（推理模型 token 不够 / 被截断）
 */
import type { AIChatConfig } from "./types";
import { resolveMaxTokens } from "./providerPresets";

const TIMEOUT_MS = 120_000;

interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

function completionsUrl(endpoint: string): string {
  const base = (endpoint || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

/** 从 SSE 文本里拼出正文（有的代理即使 stream:false 也返回事件流） */
function parseSseText(raw: string): string {
  let out = "";
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data) as {
        choices?: {
          delta?: { content?: string };
          message?: { content?: string };
        }[];
      };
      const c = j.choices?.[0];
      out += c?.delta?.content || c?.message?.content || "";
    } catch {
      /* 忽略非 JSON 行 */
    }
  }
  return out;
}

function parseBody(contentType: string, raw: string): string {
  if (contentType.includes("text/event-stream")) return parseSseText(raw);
  try {
    const j = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[];
    };
    return String(j?.choices?.[0]?.message?.content || "");
  } catch {
    return parseSseText(raw);
  }
}

export async function completeText(
  cfg: AIChatConfig,
  system: string,
  user: string,
  opts: CompleteOptions = {},
): Promise<string> {
  const url = completionsUrl(cfg.endpoint);
  if (!url) throw new Error("未配置模型接口地址，请到「设置 → 模型 API」填写");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const forwardAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", forwardAbort);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts.temperature ?? 0.6,
        max_tokens: resolveMaxTokens(cfg.model, opts.maxTokens ?? 4096),
        stream: false,
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `模型请求失败 (${res.status})${detail ? `：${detail.slice(0, 160)}` : ""}`,
      );
    }

    const text = parseBody(
      res.headers.get("content-type") || "",
      await res.text(),
    );
    if (!text.trim()) {
      throw new Error(
        "模型返回空内容：可能是输出上限被推理过程占满或被截断，请重试；若反复出现，换一个模型或调大输出上限",
      );
    }
    return text.trim();
  } catch (e) {
    if (ctrl.signal.aborted) {
      throw new Error(
        opts.signal?.aborted
          ? "生成已取消"
          : "生成超时（120s），请重试或换更快的模型",
      );
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", forwardAbort);
  }
}
