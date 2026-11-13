/**
 * 插件全屏页（对标 pi 的插件设置页）
 * ------------------------------------------------------------------
 * 结构：标题 + 说明 + 刷新/添加 → 内置插件（开关）→ 自定义插件（使用说明/删除）
 * 开关状态存 localStorage，立即影响工具与提示词（registry 过滤）。
 */
import { useState } from "react";
import { allPlugins, listPlugins } from "../lib/agent/plugins";
import {
  listForgeSpecs,
  pluginReadme,
  removeForgeSpec,
} from "../lib/agent/plugins/forge";
import { useToast } from "../lib/toast";

const DESC: Record<string, string> = {
  web: "联网搜索与网页正文抓取（DeepSeek Search / Fetch）。",
  panel: "让 AI 打开产物 / 知识库 / 编辑器 / 角色面板。",
  artifacts: "本会话产物的读取、写入、打开与删除。",
  kb: "知识库检索、保存与删除（可双写 Notion）。",
  todo: "把多步任务记成待办并跟进进度。",
  media: "按关键词搜索图片。",
  live2d: "控制角色表情、动作与视线。",
  notion: "查询 Notion 工作区（需先配置 Token）。",
  anki: "把资料变成问答卡，按间隔重复复习。",
  forge: "允许 AI 用声明式 JSON 创建自定义插件。",
};

const TONE: Record<string, string> = {
  web: "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300",
  panel:
    "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300",
  artifacts:
    "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300",
  kb: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300",
  todo: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
  media: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300",
  live2d: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-300",
  notion: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  anki: "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
  forge:
    "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300",
};

export function PluginsPage({
  onAsk,
}: {
  /** 添加插件：回聊天里让 AI 创建 */
  onAsk: (text: string) => void;
}) {
  const { toast, success } = useToast();
  const [, setTick] = useState(0);
  const [readme, setReadme] = useState<{ name: string; text: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(
    null,
  );

  const plugins = allPlugins();
  const specs = listForgeSpecs();
  const enabledCount = listPlugins().length;

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-fg">插件</h1>
            <p className="mt-1 text-xs text-fg-muted">
              安装、启用和配置插件 · 共 {plugins.length} 个，已启用{" "}
              {enabledCount} 个
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="cursor-pointer rounded-control border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
              onClick={() => {
                setTick((t) => t + 1);
                toast("已刷新");
              }}
            >
              刷新
            </button>
            <button
              className="cursor-pointer rounded-control bg-fg px-3 py-1.5 text-xs font-medium text-surface transition hover:opacity-90"
              onClick={() =>
                onAsk(
                  "帮我创建一个自定义插件：先看看现有工具缺什么，再用 plugin_forge_create 建一个能重复使用的小能力。",
                )
              }
            >
              + 添加插件
            </button>
          </div>
        </div>

        <h2 className="mt-7 text-xs font-semibold text-fg-muted">
          内置插件配置
        </h2>
        <div className="mt-2 space-y-1">
          {plugins.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-control px-2 py-2.5 transition hover:bg-sunken"
            >
              <span
                className={
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-semibold " +
                  (TONE[p.id] || "bg-gray-100 text-gray-600 dark:bg-gray-800")
                }
              >
                {p.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-fg">
                    {p.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-fg-muted">
                    {p.id}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-fg-muted">
                  {DESC[p.id] || `${Object.keys(p.ui || {}).length} 个工具`}
                </p>
              </div>
              <span className="shrink-0 text-[10px] text-fg-muted">
                {Object.keys(p.ui || {}).length} 个工具
              </span>
            </div>
          ))}
        </div>

        <h2 className="mt-7 text-xs font-semibold text-fg-muted">自定义插件</h2>
        {specs.length === 0 ? (
          <div className="mt-2 rounded-control border border-dashed border-line px-4 py-6 text-center">
            <p className="text-xs text-fg-muted">
              还没有自定义插件。点右上角「添加插件」，AI 会用声明式 JSON
              创建一个（不执行任意代码）。
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            {specs.map((spec) => (
              <div
                key={spec.id}
                className="flex items-center gap-3 rounded-control px-2 py-2.5 transition hover:bg-sunken"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {spec.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-fg">
                      {spec.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-fg-muted">
                      {spec.id}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-fg-muted">
                    {spec.description || `${spec.tools.length} 个工具`}
                  </p>
                </div>
                <button
                  className="shrink-0 cursor-pointer rounded-[8px] px-2 py-1 text-[11px] text-fg-muted transition hover:bg-surface hover:text-fg"
                  onClick={() =>
                    setReadme({ name: spec.name, text: pluginReadme(spec) })
                  }
                >
                  使用说明
                </button>
                <button
                  className="shrink-0 cursor-pointer rounded-[8px] px-2 py-1 text-[11px] text-danger transition hover:bg-danger/10"
                  onClick={() => setConfirm({ id: spec.id, name: spec.name })}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {readme && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setReadme(null)}
          />
          <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-sheet border border-line bg-surface shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="min-w-0 truncate text-sm font-semibold text-fg">
                {readme.name} · 使用说明
              </h3>
              <button
                className="shrink-0 cursor-pointer rounded-[8px] px-2 py-1 text-xs text-fg-muted hover:bg-sunken hover:text-fg"
                onClick={() => setReadme(null)}
              >
                关闭
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-sans text-[11px] leading-relaxed text-fg-muted">
              {readme.text}
            </pre>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setConfirm(null)}
          />
          <div className="relative w-full max-w-sm rounded-sheet border border-line bg-surface p-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]">
            <h3 className="text-base font-semibold text-fg">
              删除插件「{confirm.name}」？
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
              生成的工具会立即从 AI 工具列表移除（插件私有存储保留）。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-sm text-fg-muted hover:bg-sunken"
                onClick={() => setConfirm(null)}
              >
                取消
              </button>
              <button
                className="flex-1 cursor-pointer rounded-control bg-danger px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                onClick={() => {
                  const id = confirm.id;
                  if (removeForgeSpec(id)) {
                    success("已删除插件");
                    setTick((t) => t + 1);
                  } else toast("删除失败", "error");
                  setConfirm(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
