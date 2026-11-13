/**
 * 最小 MCP 客户端（浏览器版）
 * ------------------------------------------------------------------
 * 支持两种传输：
 *   - Streamable HTTP：POST initialize / tools/list / tools/call（/mcp）
 *   - 旧版 SSE：GET /sse 拿 endpoint，POST /message，响应从 SSE 回来
 * 不含采样/roots/提示词等高级能力，够 Agent 调工具即可。
 */
import type { McpServerConfig, McpToolDef } from "./types";

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT = 20_000;
const CONNECT_TIMEOUT = 8_000;

let rpcSeq = 1;
const nextRpcId = () => rpcSeq++;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new McpError(`${what}超时（${Math.round(ms / 1000)}s）`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function friendlyError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(msg)) {
    return new McpError(
      "无法连接 MCP 服务：请确本地桥接已启动、地址正确，且启动命令带 --cors",
    );
  }
  return e instanceof Error ? e : new McpError(msg);
}

function baseHeaders(server: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  for (const [k, v] of Object.entries(server.headers || {})) {
    if (k.trim() && v.trim()) headers[k.trim()] = v.trim();
  }
  return headers;
}

function checkTransport(server: McpServerConfig): void {
  if (!server.url.trim()) throw new McpError("请先填写 MCP 服务地址");
  if (
    typeof location !== "undefined" &&
    location.protocol === "https:" &&
    /^http:\/\//i.test(server.url)
  ) {
    throw new McpError(
      "HTTPS 页面无法访问 http:// 地址：请用 https 反向代理，或在本地 http 环境打开应用",
    );
  }
}

function pickMessage(
  messages: JsonRpcMessage[],
  id: number,
): JsonRpcMessage | undefined {
  return messages.find((m) => m.id === id) || messages.find((m) => !m.id);
}

function parseSseText(text: string): JsonRpcMessage[] {
  const out: JsonRpcMessage[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) continue;
    try {
      const v = JSON.parse(data) as JsonRpcMessage;
      if (v && typeof v === "object") out.push(v);
    } catch {
      /* 忽略非 JSON 心跳 */
    }
  }
  return out;
}

interface HttpResult {
  messages: JsonRpcMessage[];
  sessionId?: string;
}

async function httpPost(
  server: McpServerConfig,
  body: unknown,
  sessionId?: string,
): Promise<HttpResult> {
  const headers = baseHeaders(server);
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
      credentials: "omit",
    });
    const sid = res.headers.get("mcp-session-id") || sessionId;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new McpError(
        `MCP 返回 HTTP ${res.status}${text ? `：${text.slice(0, 160)}` : ""}`,
      );
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      return { messages: parseSseText(await res.text()), sessionId: sid };
    }
    const text = await res.text();
    if (!text.trim()) return { messages: [], sessionId: sid };
    try {
      const parsed = JSON.parse(text) as JsonRpcMessage | JsonRpcMessage[];
      return {
        messages: Array.isArray(parsed) ? parsed : [parsed],
        sessionId: sid,
      };
    } catch {
      return { messages: parseSseText(text), sessionId: sid };
    }
  } finally {
    clearTimeout(timer);
  }
}

type RpcFn = (method: string, params?: unknown) => Promise<unknown>;

/** Streamable HTTP 会话：initialize → initialized → 后续请求 */
async function withHttp(
  server: McpServerConfig,
  fn: (rpc: RpcFn) => Promise<unknown>,
) {
  const initId = nextRpcId();
  const init = await httpPost(server, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "lumia-chat", version: "1.0.0" },
    },
  });
  const initMsg = pickMessage(init.messages, initId);
  if (initMsg?.error) {
    throw new McpError(
      `MCP 初始化失败：${initMsg.error.message || "未知错误"}`,
    );
  }
  const sid = init.sessionId;
  await httpPost(
    server,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sid,
  ).catch(() => undefined);

  const rpc: RpcFn = async (method, params) => {
    const id = nextRpcId();
    const res = await httpPost(
      server,
      { jsonrpc: "2.0", id, method, params },
      sid,
    );
    const msg = pickMessage(res.messages, id);
    if (msg?.error)
      throw new McpError(`${method} 失败：${msg.error.message || "未知错误"}`);
    return msg?.result;
  };
  return fn(rpc);
}

interface SseSession {
  rpc: RpcFn;
  notify: (method: string, params?: unknown) => Promise<unknown>;
  close: () => void;
}

/** 旧版 SSE 会话：GET /sse 拿 endpoint，POST 消息，响应走 SSE */
function openSse(server: McpServerConfig): Promise<SseSession> {
  if (typeof EventSource === "undefined") {
    return Promise.reject(new McpError("当前环境不支持 SSE"));
  }
  return new Promise<SseSession>((resolve, reject) => {
    const es = new EventSource(server.url);
    const pending = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let endpoint = "";
    let settled = false;

    const connectTimer = setTimeout(() => {
      if (!endpoint) {
        es.close();
        reject(new McpError("连接 MCP SSE 超时：确认桥接已启动且带 --cors"));
      }
    }, CONNECT_TIMEOUT);

    const onMessage = (ev: MessageEvent) => {
      let msg: JsonRpcMessage | undefined;
      try {
        msg = JSON.parse(String(ev.data)) as JsonRpcMessage;
      } catch {
        return;
      }
      if (typeof msg.id !== "number") return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error)
        p.reject(new McpError(msg.error.message || "MCP 调用失败"));
      else p.resolve(msg.result);
    };
    es.addEventListener("message", onMessage as EventListener);

    const request = (
      method: string,
      params?: unknown,
      notify = false,
    ): Promise<unknown> => {
      const id = nextRpcId();
      const body: Record<string, unknown> = { jsonrpc: "2.0", method };
      if (!notify) body.id = id;
      if (params !== undefined) body.params = params;
      const send = fetch(endpoint, {
        method: "POST",
        headers: baseHeaders(server),
        body: JSON.stringify(body),
        credentials: "omit",
      }).then(async (res) => {
        if (!res.ok) throw new McpError(`MCP 返回 HTTP ${res.status}`);
        return undefined;
      });
      if (notify) return send;
      return withTimeout(
        new Promise<unknown>((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          send.catch((e) => {
            pending.delete(id);
            rej(e instanceof Error ? e : new McpError(String(e)));
          });
        }),
        REQUEST_TIMEOUT,
        "等待 MCP 响应",
      );
    };

    es.addEventListener("endpoint", (ev: Event) => {
      const raw = String((ev as MessageEvent).data || "").trim();
      try {
        endpoint = new URL(raw, server.url).toString();
      } catch {
        endpoint = raw;
      }
      clearTimeout(connectTimer);
      if (settled) return;
      settled = true;
      resolve({
        rpc: (method, params) => request(method, params),
        notify: (method, params) => request(method, params, true),
        close: () => {
          es.removeEventListener("message", onMessage as EventListener);
          es.close();
        },
      });
    });

    es.onerror = () => {
      if (!endpoint && !settled) {
        settled = true;
        clearTimeout(connectTimer);
        es.close();
        reject(
          new McpError("无法连接 MCP SSE：确认地址正确且启动命令带 --cors"),
        );
      }
    };
  });
}

async function withSse(
  server: McpServerConfig,
  fn: (rpc: RpcFn) => Promise<unknown>,
) {
  const session = await openSse(server);
  try {
    await session.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "lumia-chat", version: "1.0.0" },
    });
    await session.notify("notifications/initialized").catch(() => undefined);
    return await fn(session.rpc);
  } finally {
    session.close();
  }
}

async function withSession(
  server: McpServerConfig,
  fn: (rpc: RpcFn) => Promise<unknown>,
): Promise<unknown> {
  checkTransport(server);
  try {
    return await withTimeout(
      server.transport === "sse" ? withSse(server, fn) : withHttp(server, fn),
      REQUEST_TIMEOUT + 5_000,
      "MCP 请求",
    );
  } catch (e) {
    throw friendlyError(e);
  }
}

/** 拉取工具清单（设置页「测试连接」与缓存刷新共用） */
export async function mcpListTools(
  server: McpServerConfig,
): Promise<McpToolDef[]> {
  const result = (await withSession(server, (rpc) =>
    rpc("tools/list", {}),
  )) as {
    tools?: McpToolDef[];
  };
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools
    .filter((t) => t && typeof t.name === "string")
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
}

export interface McpCallResult {
  text: string;
  raw: unknown;
  isError: boolean;
}

function contentToText(result: unknown): string {
  const r = result as {
    content?: { type?: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  if (Array.isArray(r?.content)) {
    const text = r.content
      .map((c) =>
        c?.type === "text" ? c.text || "" : c?.type ? `[${c.type}]` : "",
      )
      .filter(Boolean)
      .join("\n");
    if (text.trim()) return text;
  }
  if (r?.structuredContent != null)
    return JSON.stringify(r.structuredContent, null, 2);
  return typeof result === "string"
    ? result
    : JSON.stringify(result ?? null, null, 2);
}

/** 调用工具 */
export async function mcpCallTool(
  server: McpServerConfig,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<McpCallResult> {
  const result = await withSession(server, (rpc) =>
    rpc("tools/call", { name: tool, arguments: args }),
  );
  const isError = !!(result as { isError?: boolean })?.isError;
  const text = contentToText(result);
  if (isError) throw new McpError(text || "MCP 工具返回错误");
  return { text, raw: result, isError };
}
