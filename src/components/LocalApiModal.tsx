import { createPortal } from "react-dom";
import { LocalApiForm } from "./LocalApiForm";

interface LocalApiModalProps {
  open: boolean;
  onClose: () => void;
  pageId: number;
  botName: string;
  onSaved: () => void;
}

export function LocalApiModal({
  open,
  onClose,
  pageId,
  botName,
  onSaved,
}: LocalApiModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-sheet border border-line bg-surface sm:max-h-[85dvh] sm:rounded-sheet sm:shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
          <h3 className="text-base font-semibold text-fg">
            自定义模型 · {botName}
          </h3>
          <button
            onClick={onClose}
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-control text-fg-muted transition hover:bg-sunken hover:text-fg"
            aria-label="关闭"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 pb-safe">
          <p className="rounded-control bg-amber-50 p-3 text-xs leading-relaxed text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <span className="font-medium">安全与使用规则</span>
          </p>
          <ul className="ml-5 list-disc space-y-1 rounded-control bg-sunken p-3 text-xs leading-relaxed text-fg-muted dark:text-fg-muted">
            <li>
              API Key 与提示词<b>仅保存在本机浏览器</b>
              （localStorage），不会上传服务器，请勿在公共电脑保存。
            </li>
            <li>
              接口需为 <b>OpenAI 兼容格式</b>
              （/v1/chat/completions），留空则使用站点默认配置。
            </li>
            <li>
              使用自定义 API 后，将<b>自动解除</b>
              默认的次数与冷却限制；请遵守所用服务的使用条款与当地法律。
            </li>
            <li>自定义提示词会覆盖默认人设，仅影响当前机器人、当前浏览器。</li>
          </ul>
          <LocalApiForm
            pageId={pageId}
            variant="modal"
            onSaved={() => {
              onSaved();
              onClose();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
