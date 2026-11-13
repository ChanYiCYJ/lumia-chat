import { useEffect, useRef, useState } from "react";
import {
  loadNotionCfg,
  saveNotionCfg,
  clearNotionCfg,
  testNotionConnection,
  fetchNotionBotUser,
  saveNotionDbId,
} from "../lib/notion";
import { clearInitialSynced, syncOnRefresh } from "../lib/backupSync";
import { saveKbStoreMode } from "../lib/kbStore";

/**
 * Notion 接入：只保留一个 Integration Token 输入框 + 保存。
 * - 保存非空 Token：写入本机（kimo_notion_cfg）→ 知识库保存目标重置为 auto → 触发一次双向同步
 * - 保存空值：断开连接（清除 Token 与数据库记忆）
 * - 成功不显示状态；仅在失败时给出单行错误（否则用户无法判断 Token 是否有效）
 */
export function NotionForm() {
  const [token, setToken] = useState(() => loadNotionCfg().token);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  /** 「Token 有效但工作区没共享页面」的指引文案 */
  const buildShareHint = (name: string, workspace: string) =>
    `Token 有效，但工作区${workspace ? `「${workspace}」` : ""}还没共享任何页面，所以同步无法写入。` +
    `请打开要同步的 Notion 页面 → 右上「···」→ 连接 → 添加「${name || "该 Integration"}」，再点保存。`;

  // 已保存的 Token：进入设置即自动检查，工作区仍为空时直接给出授权指引（不需要再点保存）
  useEffect(() => {
    const tk = loadNotionCfg().token.trim();
    if (!tk) return;
    let alive = true;
    void testNotionConnection(tk).then(async (r) => {
      if (!alive || !r.ok || !r.empty) return;
      const who = await fetchNotionBotUser(tk);
      if (alive) setHint(buildShareHint(who.name, who.workspace));
    });
    return () => {
      alive = false;
    };
  }, []);

  const flashSaved = () => {
    setSaved(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setSaved(false), 1600);
  };

  const save = () => {
    const tk = token.trim();
    setError("");
    setHint("");

    // 空值保存 = 断开连接
    if (!tk) {
      clearNotionCfg();
      saveNotionDbId("");
      try {
        window.dispatchEvent(new CustomEvent("kimo:notion:cleared"));
      } catch {
        /* 非浏览器环境忽略 */
      }
      flashSaved();
      return;
    }

    saveNotionCfg({ token: tk });
    // 配置 Notion 后知识库保存目标重置为 auto（清除可能残留的 local，创建/编辑自动同步）
    saveKbStoreMode("auto");
    try {
      window.dispatchEvent(new CustomEvent("kimo:notion:configured"));
    } catch {
      /* 非浏览器环境忽略 */
    }
    clearInitialSynced();
    void syncOnRefresh();
    flashSaved();

    // 连接校验后台进行：无效 / 工作区无共享内容时才提示，不阻塞输入
    setSaving(true);
    void testNotionConnection(tk)
      .then(async (r) => {
        if (!r.ok) {
          setError(r.message);
          return;
        }
        if (!r.empty) return;
        // Token 有效但 Integration 未共享任何页面：此时同步创建不了页面（会空跑）
        const who = await fetchNotionBotUser(tk);
        setHint(buildShareHint(who.name, who.workspace));
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor="notion-token"
        className="block text-xs font-medium text-fg-muted"
      >
        Notion Integration Token
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <input
            id="notion-token"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError("");
              setHint("");
              setSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder="ntn_…"
            className="w-full rounded-control border border-line bg-surface py-2 pl-3 pr-9 text-sm text-fg outline-none transition placeholder:text-fg-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-[8px] text-fg-muted transition hover:bg-sunken hover:text-fg"
            aria-label={showKey ? "隐藏密钥" : "显示密钥"}
            title={showKey ? "隐藏密钥" : "显示密钥"}
          >
            {showKey ? (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                />
              </svg>
            ) : (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="min-h-9 shrink-0 cursor-pointer rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-sunken active:scale-[0.99] disabled:cursor-wait disabled:opacity-60 sm:w-20"
        >
          {saving ? "校验…" : saved ? "已保存" : "保存"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}
      {hint && (
        <p
          role="status"
          className="text-xs leading-relaxed text-amber-700 dark:text-amber-300"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
