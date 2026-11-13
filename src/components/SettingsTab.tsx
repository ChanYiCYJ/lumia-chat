import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  loadTtsAudioUrl,
  saveTtsAudioUrl,
  TTS_VOICES,
  type ChatFontSize,
  type TtsSource,
  type TtsVoice,
} from "../lib/chatSettings";
import { fileToAvatarDataUrl, normalizeAvatar } from "../lib/avatar";
import { loadSearchApiKey, saveSearchApiKey } from "../lib/chatSettings";
import { LocalApiForm } from "./LocalApiForm";
import { NotionForm } from "./NotionForm";
import { McpSettings } from "./McpSettings";
import { NotionIcon, SegmentedControl, btnSoft, inputCls } from "./ui";
import type { KnowledgeStoreMode } from "../lib/kbStore";

/**
 * Agent 面板「设置」tab 的数据/回调集合。
 * 由 AIChat 构造并通过 AgentPanel 的 settings 属性传入（desktop/mobile 双渲染共用一份）。
 */
export interface AgentSettingsProps {
  pageId: number;
  canManage: boolean;
  hasCustom: boolean;
  botName: string;
  /** 当前自定义头像（未设置 = undefined，界面不渲染任何头像） */
  avatar?: string;
  onSetAvatar?: (v: string) => void;
  onClearAvatar?: () => void;
  /** 搜索模式（设置页与「/」弹窗共用同一单选，双向同步） */
  searchMode: "fast" | "auto" | "deep";
  onSetSearchMode: (m: "fast" | "auto" | "deep") => void;
  /** 是否已配置 DeepSeek API Key（联网搜索依赖它） */
  deepseekReady?: boolean;
  chatFontSize?: ChatFontSize;
  onSetFontSize?: (v: ChatFontSize) => void;
  onCustomSaved: () => void;
  allowCustomApi?: boolean;
  /** TTS 总开关（默认关闭；关闭时隐藏消息「朗读」按钮） */
  ttsOn?: boolean;
  onToggleTts?: () => void;
  /** TTS 音色（voice 参数） */
  ttsVoice?: TtsVoice;
  onSetTtsVoice?: (v: TtsVoice) => void;
  /** TTS 来源（内置后端 / 第三方地址） */
  ttsSource?: TtsSource;
  onSetTtsSource?: (v: TtsSource) => void;
  /** 试听当前 TTS 配置（验证调用 + Live2D 口型） */
  onTestTts?: () => void;
  /** 知识库保存目标（auto/本地/Notion） */
  kbStoreMode?: KnowledgeStoreMode;
  onSetKbStoreMode?: (m: KnowledgeStoreMode) => void;
}

/** 分区图标（统一线性图标，颜色跟随文字） */
const SECTION_ICON: Record<string, ReactNode> = {
  api: (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  ),
  notion: <NotionIcon className="h-3.5 w-3.5" />,
  avatar: (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0115 0" />
    </svg>
  ),
  general: (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  ),
  search: (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  ),
  source: (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 014 9 15 15 0 01-4 9 15 15 0 01-4-9 15 15 0 014-9z" />
    </svg>
  ),
  tts: (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12" />
    </svg>
  ),
  mcp: (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3v4M15 3v4" />
      <path d="M7 7h10v3.5a5 5 0 01-10 0V7z" />
      <path d="M12 15.5V21" />
    </svg>
  ),
};

/** 设置分区：图标 + 标题 + 内容；扁平无卡片，用发丝线分隔 */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: keyof typeof SECTION_ICON;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line/60 pb-4 last:border-0 last:pb-0">
      <div className="mb-2 flex items-center gap-1.5 text-fg-muted">
        {icon && <span className="shrink-0">{SECTION_ICON[icon]}</span>}
        <h3 className="text-[12px] font-semibold text-fg">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** 简洁行式开关（无边框盒，贴近 Shiro 留白风格） */
function Toggle({
  on,
  onClick,
  label,
  sub,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full cursor-pointer items-center justify-between gap-3 py-1.5 text-left"
      role="switch"
      aria-checked={on}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {sub && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-muted">
            {sub}
          </span>
        )}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-line-strong"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export function SettingsTab({
  pageId,
  canManage,
  hasCustom,
  botName,
  avatar,
  onSetAvatar,
  onClearAvatar,
  searchMode,
  onSetSearchMode,
  deepseekReady = false,
  chatFontSize = "base",
  onSetFontSize,
  onCustomSaved,
  allowCustomApi = true,
  ttsOn = false,
  onToggleTts,
  ttsVoice = "zh-CN-XiaoxiaoNeural",
  onSetTtsVoice,
  ttsSource = "backend",
  onSetTtsSource,
  onTestTts,
}: AgentSettingsProps) {
  // 自定义模型开关：由 AIChat 统一管理（props 驱动，关闭后不再识别为自定义）；
  // 未传 props 时回退本地逻辑（兼容旧用法）
  // 头像：默认不设置（不展示）；上传图片自动压缩 128×128，或直接粘贴图片地址
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarErr, setAvatarErr] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);

  /** 选择图片：读取 → 居中裁切压缩 → 交给外层保存 */
  const onAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选择同一文件
    if (!file) return;
    setAvatarErr("");
    setAvatarBusy(true);
    try {
      onSetAvatar?.(await fileToAvatarDataUrl(file));
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : "头像处理失败");
    } finally {
      setAvatarBusy(false);
    }
  };

  /** 粘贴图片地址：只接受 http(s) / 站内路径 */
  const applyAvatarUrl = () => {
    const v = normalizeAvatar(avatarUrl);
    if (!v) {
      setAvatarErr("请输入 http(s) 图片地址或站内路径");
      return;
    }
    setAvatarErr("");
    onSetAvatar?.(v);
    setAvatarUrl("");
  };
  // 音频 TTS（独立卡片，默认收起表单）：内置后端 / 第三方地址 / 音色 / 试听 / 音量
  const [ttsAudioUrl, setTtsAudioUrl] = useState(() => loadTtsAudioUrl());
  /** 搜索专用 Key（与模型 Key 分离；留空复用模型 Key） */
  const [searchApiKey, setSearchApiKey] = useState(() => loadSearchApiKey());
  // Notion 接入卡：单输入，无折叠
  /** 搜索模式说明文案 */
  const searchModeDesc =
    searchMode === "fast"
      ? "纯本地快速：不联网、不生成文章，直接基于本地知识回答"
      : searchMode === "deep"
        ? "深度联网：搜索并生成完整综合文章（View 页面），仅此模式可生成文章"
        : "适当联网搜索：需要时自动联网搜索快速回答，不生成完整文章";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-safe sm:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* 模型 API：置顶，直接展示（不再折叠/不再叫「高级设置」） */}
        <Section title="模型 API" icon="api">
          <div className="space-y-2">
            {canManage ? (
              <p className="rounded-control bg-sunken p-3 text-xs leading-relaxed text-fg-muted">
                当前使用管理员在「AI 管理」中为「{botName}
                」配置的默认模型，无需在本机填写。
              </p>
            ) : !allowCustomApi ? (
              <p className="rounded-control bg-sunken p-3 text-xs leading-relaxed text-fg-muted">
                管理员已关闭访客自定义模型。
              </p>
            ) : (
              <LocalApiForm
                pageId={pageId}
                variant="inline"
                showEnabledHint={hasCustom}
                onSaved={onCustomSaved}
              />
            )}
          </div>
        </Section>

        {/* Notion：单个 Token 输入；连接后知识库/会话自动双向同步 */}
        <Section title="Notion" icon="notion">
          <NotionForm />
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-muted">
            <NotionIcon className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              在 Notion 新建 Integration 并授权页面，把 Token
              粘贴到上方即可。数据自动同步，密钥只保存在本机。
            </span>
          </p>
        </Section>

        {/* 头像：默认不展示；可上传图片或粘贴图片地址，仅保存在本机 */}
        <Section title="头像" icon="avatar">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-sunken">
              {avatar ? (
                <img
                  src={avatar}
                  alt="当前头像"
                  className="h-full w-full object-cover"
                />
              ) : (
                <svg
                  className="h-5 w-5 text-fg-muted"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8.5" r="3.5" />
                  <path strokeLinecap="round" d="M4.5 20a7.5 7.5 0 0115 0" />
                </svg>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">
                {avatar ? "已设置自定义头像" : "未设置（默认不显示）"}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-fg-muted">
                图片仅保存在本机，会自动压缩为 128×128。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              className={`${btnSoft} min-h-9 px-3`}
            >
              {avatarBusy ? "处理中…" : "上传图片"}
            </button>
            {avatar && (
              <button
                type="button"
                onClick={() => onClearAvatar?.()}
                className={`${btnSoft} min-h-9 px-3`}
              >
                移除头像
              </button>
            )}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onAvatarFile}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <input
              value={avatarUrl}
              onChange={(e) => {
                setAvatarUrl(e.target.value);
                setAvatarErr("");
              }}
              placeholder="或粘贴图片地址 https://…"
              className={inputCls}
            />
            <button
              type="button"
              onClick={applyAvatarUrl}
              disabled={!avatarUrl.trim()}
              className={`${btnSoft} min-h-9 shrink-0 px-3`}
            >
              使用
            </button>
          </div>
          {avatarErr && (
            <p className="text-[11px] leading-relaxed text-danger">
              {avatarErr}
            </p>
          )}
        </Section>

        {/* 通用 */}
        <Section title="通用" icon="general">
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm font-medium text-fg">对话字体</span>
            <div className="w-44 shrink-0">
              <SegmentedControl
                value={chatFontSize}
                label="对话字体"
                onChange={(v) => onSetFontSize?.(v)}
                options={[
                  { value: "sm", label: "小" },
                  { value: "base", label: "中" },
                  { value: "lg", label: "大" },
                ]}
              />
            </div>
          </div>
        </Section>

        {/* 搜索模式：网络模式 + 搜索速度 + 搜索深度 合并为 Fast/Auto/Deep 单选 */}
        <Section title="搜索模式" icon="search">
          <div className="space-y-1.5">
            <SegmentedControl
              value={searchMode}
              label="搜索模式"
              onChange={onSetSearchMode}
              options={[
                { value: "fast", label: "Fast" },
                { value: "auto", label: "Auto" },
                { value: "deep", label: "Deep" },
              ]}
            />
            <p className="text-[11px] leading-relaxed text-fg-muted">
              {searchModeDesc}
            </p>
          </div>
        </Section>

        {/* 搜索数据源：DeepSeek Search API（复用模型 API 配置里的 DeepSeek Key） */}
        <Section title="搜索数据源" icon="source">
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between gap-2 rounded-control bg-sunken px-2.5 py-2">
              <span className="text-xs font-medium text-fg">DeepSeek 搜索</span>
              <span
                className={`text-[11px] ${deepseekReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
              >
                {deepseekReady ? "已启用" : "未配置 Key"}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-fg-muted">
              {deepseekReady
                ? "联网搜索与网页正文抓取由 DeepSeek 官方 Search / Fetch 提供（优先用下方专用 Key，留空则复用模型 Key）。"
                : "未配置搜索 Key：联网搜索会退化为模型自身知识作答。可填下方专用 Key，或到「模型 API」选 DeepSeek 并填 Key。"}
            </p>
            <input
              type="password"
              value={searchApiKey}
              onChange={(e) => {
                setSearchApiKey(e.target.value);
                saveSearchApiKey(e.target.value);
                window.dispatchEvent(new CustomEvent("kimo:searchkey:changed"));
              }}
              placeholder="搜索专用 DeepSeek Key（留空则复用模型 Key）"
              className={"mt-1 " + inputCls}
            />
          </div>
        </Section>

        {/* MCP：外部工具服务（墨墨背单词 / 微信读书 / Microsoft To Do 预设） */}
        <Section title="MCP 服务" icon="mcp">
          <McpSettings />
        </Section>

        {/* 音频 TTS：朗读开关与来源 tab 合并；开启后展示音色/试听 */}
        <Section title="音频 TTS" icon="tts">
          <div className="space-y-2">
            {/* 朗读开关 + 来源分段（内置后端 / 第三方地址）：竖排两行，窄屏不挤压 */}
            <div className="space-y-2">
              <Toggle
                on={ttsOn}
                onClick={onToggleTts ?? (() => {})}
                label="朗读"
              />
              <SegmentedControl
                value={ttsSource}
                label="朗读来源"
                onChange={(v) => {
                  onSetTtsSource?.(v);
                  if (!ttsOn) onToggleTts?.();
                }}
                options={[
                  { value: "backend", label: "内置后端" },
                  { value: "thirdparty", label: "第三方地址" },
                ]}
              />
            </div>

            {/* 开启后：配置项（淡入上滑） */}
            {ttsOn && (
              <div className="space-y-2 pt-0.5 animate-[kfade_0.2s_ease-out]">
                {/* 第三方地址输入（仅第三方来源，输入即保存） */}
                {ttsSource === "thirdparty" && (
                  <input
                    value={ttsAudioUrl}
                    onChange={(e) => {
                      setTtsAudioUrl(e.target.value);
                      saveTtsAudioUrl(e.target.value);
                    }}
                    placeholder="TTS 地址模板：https://…/tts?text={text}"
                    className="w-full animate-[kfade_0.2s_ease-out] rounded-control border border-line bg-sunken px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted/70 focus:border-accent"
                  />
                )}
                {/* 音色 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">音色</span>
                  <select
                    value={ttsVoice}
                    onChange={(e) => onSetTtsVoice?.(e.target.value)}
                    className="min-h-9 rounded-control border border-line bg-sunken px-2 py-1.5 text-xs text-fg outline-none transition focus:border-accent"
                  >
                    {TTS_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 试听 */}
                <button
                  onClick={onTestTts}
                  className="min-h-9 w-full rounded-control border border-line bg-surface py-2 text-sm text-fg-muted transition hover:border-line-strong hover:text-fg active:scale-[0.99]"
                >
                  试听
                </button>
                <p className="text-[11px] leading-relaxed text-fg-muted">
                  内置音源自动降级（自有 edge-tts → 有道 /
                  Google），音色在后备音源下可能不生效。
                </p>
              </div>
            )}
          </div>
        </Section>

        <p className="pt-1 text-center text-[11px] text-fg-muted">
          AI 生成内容仅供参考
        </p>
      </div>
    </div>
  );
}
