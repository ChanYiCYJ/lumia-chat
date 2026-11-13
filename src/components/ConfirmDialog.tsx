import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * 友好确认弹窗（数据操作保护）：替代 window.confirm，带标题/说明/危险样式。
 * 复用 DataModal 弹窗视觉（createPortal + backdrop + 圆角面板 + 确认/取消）。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-sheet border border-line bg-surface shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]">
        <div className="p-5">
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          {message && (
            <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
              {message}
            </p>
          )}
          {children}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button
            onClick={onCancel}
            className="flex-1 cursor-pointer rounded-control border border-line px-3 py-2 text-sm text-fg-muted transition hover:bg-sunken hover:text-fg"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 cursor-pointer rounded-control px-3 py-2 text-sm font-medium transition ${
              danger
                ? "bg-danger text-white hover:opacity-90"
                : "border border-line-strong bg-surface text-fg hover:bg-sunken"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
