/**
 * 设置页「MCP 服务」：内置三套预设 + 自定义服务
 * ------------------------------------------------------------------
 * 折叠式列表：一行一个服务，展开后填地址/凭据、复制本地桥接命令、测试连接。
 * 配置与工具目录都存本机，Agent 插件（mcpPlugin）据此动态挂载工具。
 */
import { useMemo, useState } from "react";
import { useToast } from "../lib/toast";
import {
  availablePresets,
  loadMcpCatalog,
  loadMcpServers,
  newCustomServer,
  removeMcpServer,
  saveMcpServers,
  serverFromPreset,
  setMcpCatalogEntry,
  upsertMcpServer,
} from "../lib/mcp/store";
import { mcpListTools } from "../lib/mcp/client";
import { buildStartCommand, mcpPreset } from "../lib/mcp/presets";
import type { McpServerConfig } from "../lib/mcp/types";

const inputCls =
  "w-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-[11px] text-fg outline-none transition placeholder:text-fg-muted focus:border-accent";

function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function headersText(headers?: Record<string, string>): string {
  return Object.entries(headers || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function StatusDot({ tone }: { tone: "ok" | "err" | "idle" }) {
  return (
    <span
      className={
        "h-1.5 w-1.5 shrink-0 rounded-full " +
        (tone === "ok"
          ? "bg-emerald-500"
          : tone === "err"
            ? "bg-danger"
            : "bg-line-strong")
      }
    />
  );
}

export function McpSettings() {
  const { toast, success } = useToast();
  const [servers, setServers] = useState<McpServerConfig[]>(loadMcpServers);
  const [catalog, setCatalog] = useState(loadMcpCatalog);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [headersDraft, setHeadersDraft] = useState("");
  const remaining = useMemo(() => availablePresets(servers), [servers]);

  const patch = (id: string, p: Partial<McpServerConfig>) => {
    const list = servers.map((s) => (s.id === id ? { ...s, ...p } : s));
    saveMcpServers(list);
    setServers(list);
  };

  const add = (presetId?: string) => {
    const server = presetId ? serverFromPreset(presetId) : newCustomServer();
    if (!server) return;
    setServers(upsertMcpServer(server));
    setOpenId(server.id);
    setHeadersDraft("");
    setConfirmId(null);
  };

  const del = (id: string) => {
    setServers(removeMcpServer(id));
    setCatalog(loadMcpCatalog());
    setOpenId((cur) => (cur === id ? null : cur));
    setConfirmId(null);
    toast("已删除 MCP 服务");
  };

  const test = async (server: McpServerConfig) => {
    if (!server.url.trim()) {
      toast("请先填写服务地址", "error");
      return;
    }
    setBusyId(server.id);
    try {
      const tools = await mcpListTools(server);
      setCatalog(setMcpCatalogEntry(server.id, { tools, at: Date.now() }));
      success(
        tools.length
          ? `已连接 ${server.name}：${tools.length} 个工具`
          : `${server.name} 已连接，但没有工具`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "连接失败";
      setCatalog(
        setMcpCatalogEntry(server.id, {
          tools: [],
          at: Date.now(),
          error: msg,
        }),
      );
      toast(msg, "error");
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      toast("复制失败，可手动选中命令复制", "error");
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-fg-muted">
        把墨墨背单词、微信读书、Microsoft To Do 等 MCP 服务的工具接给{" "}
        Agent。三者都是本地 stdio 服务，展开后会生成一行{" "}
        <span className="rounded bg-sunken px-1 py-px font-mono text-[10px]">
          supergateway
        </span>{" "}
        启动命令，跑起来再点「测试连接」。
      </p>

      {servers.length === 0 && (
        <p className="rounded-control border border-dashed border-line px-3 py-3 text-center text-[11px] text-fg-muted">
          还没有 MCP 服务，从下面选一个预设开始
        </p>
      )}

      <div className="space-y-1.5">
        {servers.map((server) => {
          const preset = mcpPreset(server.preset);
          const state = catalog[server.id];
          const tools = state?.tools || [];
          const open = openId === server.id;
          const busy = busyId === server.id;
          const tone: "ok" | "err" | "idle" = state?.error
            ? "err"
            : tools.length
              ? "ok"
              : "idle";
          const cmd = preset ? buildStartCommand(preset, server.env || {}) : "";
          return (
            <div
              key={server.id}
              className="overflow-hidden rounded-control border border-line bg-surface"
            >
              <button
                onClick={() => {
                  setOpenId(open ? null : server.id);
                  setConfirmId(null);
                  if (!open) setHeadersDraft(headersText(server.headers));
                }}
                aria-expanded={open}
                className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left transition hover:bg-sunken/60"
              >
                <StatusDot tone={tone} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
                  {server.name}
                </span>
                <span className="shrink-0 text-[10px] text-fg-muted">
                  {state?.error
                    ? "连接失败"
                    : tools.length
                      ? `${tools.length} 工具`
                      : "未连接"}
                </span>
                {!server.enabled && (
                  <span className="shrink-0 rounded-full bg-sunken px-1.5 py-px text-[9px] text-fg-muted">
                    已停用
                  </span>
                )}
                <svg
                  className={
                    "h-3 w-3 shrink-0 text-fg-muted transition " +
                    (open ? "rotate-90" : "")
                  }
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {open && (
                <div className="space-y-2.5 border-t border-line px-2.5 py-2.5">
                  {preset && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-fg-muted">
                          {preset.desc} · 端口 {preset.port}
                        </span>
                        <a
                          href={`https://github.com/${preset.repo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                        >
                          文档 ↗
                        </a>
                      </div>

                      {preset.fields.map((f) => (
                        <label key={f.key} className="block">
                          <span className="mb-1 block text-[10px] text-fg-muted">
                            {f.label}
                          </span>
                          <input
                            type={f.secret ? "password" : "text"}
                            value={server.env?.[f.key] || ""}
                            onChange={(e) =>
                              patch(server.id, {
                                env: { ...server.env, [f.key]: e.target.value },
                              })
                            }
                            placeholder={f.placeholder}
                            className={inputCls}
                          />
                          {f.hint && (
                            <span className="mt-0.5 block text-[9px] leading-relaxed text-fg-muted">
                              {f.hint}
                            </span>
                          )}
                        </label>
                      ))}

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] text-fg-muted">
                            本地启动命令
                          </span>
                          <button
                            onClick={() => void copy(server.id, cmd)}
                            className="cursor-pointer rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-muted transition hover:text-fg"
                          >
                            {copied === server.id ? "已复制" : "复制"}
                          </button>
                        </div>
                        <pre className="max-h-36 overflow-auto rounded-[8px] bg-sunken p-2 text-[10px] leading-relaxed text-fg-muted [white-space:pre-wrap] [overflow-wrap:anywhere]">
                          {cmd}
                        </pre>
                        <ul className="mt-1 space-y-0.5">
                          {preset.notes.map((n) => (
                            <li
                              key={n}
                              className="text-[9px] leading-relaxed text-fg-muted"
                            >
                              · {n}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}

                  <div className="flex gap-1.5">
                    <select
                      value={server.transport}
                      onChange={(e) =>
                        patch(server.id, {
                          transport: e.target.value as "http" | "sse",
                        })
                      }
                      aria-label="传输方式"
                      className="shrink-0 rounded-control border border-line bg-surface px-1.5 py-1.5 text-[10px] text-fg-muted outline-none"
                    >
                      <option value="sse">SSE</option>
                      <option value="http">HTTP</option>
                    </select>
                    <input
                      value={server.url}
                      onChange={(e) =>
                        patch(server.id, { url: e.target.value })
                      }
                      placeholder={
                        server.transport === "sse"
                          ? `http://localhost:${preset?.port ?? 8792}/sse`
                          : "https://example.com/mcp"
                      }
                      className={inputCls}
                    />
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-[10px] text-fg-muted">
                      请求头（可选，每行 Key: Value；SSE 不支持自定义头）
                    </span>
                    <textarea
                      value={headersDraft}
                      onChange={(e) => {
                        setHeadersDraft(e.target.value);
                        patch(server.id, {
                          headers: parseHeaders(e.target.value),
                        });
                      }}
                      rows={2}
                      placeholder="Authorization: Bearer …"
                      className={inputCls}
                    />
                  </label>

                  {(tools.length > 0 || state?.error) && (
                    <div className="space-y-1">
                      {state?.error && (
                        <p className="text-[10px] leading-relaxed text-danger">
                          {state.error}
                        </p>
                      )}
                      {tools.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {tools.slice(0, 12).map((t) => (
                            <span
                              key={t.name}
                              title={t.description || t.name}
                              className="rounded-full bg-sunken px-1.5 py-px text-[9px] text-fg-muted"
                            >
                              {t.name}
                            </span>
                          ))}
                          {tools.length > 12 && (
                            <span className="rounded-full bg-sunken px-1.5 py-px text-[9px] text-fg-muted">
                              +{tools.length - 12}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      disabled={busy}
                      onClick={() => void test(server)}
                      className="cursor-pointer rounded-control bg-fg px-2.5 py-1.5 text-[11px] font-medium text-surface transition hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? "连接中…" : "测试连接"}
                    </button>
                    <button
                      onClick={() =>
                        patch(server.id, { enabled: !server.enabled })
                      }
                      className="cursor-pointer rounded-control border border-line px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:text-fg"
                    >
                      {server.enabled ? "停用" : "启用"}
                    </button>
                    <span className="flex-1" />
                    {confirmId === server.id ? (
                      <>
                        <button
                          onClick={() => del(server.id)}
                          className="cursor-pointer rounded-control bg-danger px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:opacity-90"
                        >
                          确认删除
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="cursor-pointer rounded-control px-2 py-1.5 text-[11px] text-fg-muted hover:text-fg"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmId(server.id)}
                        className="cursor-pointer rounded-control px-2.5 py-1.5 text-[11px] text-danger transition hover:bg-danger/10"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {remaining.map((p) => (
          <button
            key={p.id}
            onClick={() => add(p.id)}
            title={p.desc}
            className="cursor-pointer rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] text-fg-muted transition hover:border-line-strong hover:text-fg"
          >
            + {p.name}
          </button>
        ))}
        <button
          onClick={() => add()}
          className="cursor-pointer rounded-full border border-dashed border-line px-2.5 py-1 text-[10px] text-fg-muted transition hover:text-fg"
        >
          + 自定义
        </button>
      </div>
    </div>
  );
}
