import type { ReactNode } from "react";

type BadgeTone = "violet" | "gray" | "blue" | "green" | "amber" | "red";

/**
 * 徽标配色：只保留语义（成功/警告/危险）+ 中性。
 * `violet` 是为了兼容旧调用保留的 key，视觉上已收敛为中性墨色（去掉 AI 紫）。
 */
const TONES: Record<BadgeTone, string> = {
  violet: "bg-sunken text-fg border-line",
  gray: "bg-sunken text-fg-muted border-line",
  blue: "bg-accent/8 text-accent border-accent/25",
  green: "bg-accent/8 text-accent border-accent/25",
  amber:
    "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/25",
  red: "bg-danger/8 text-danger border-danger/25",
};

export function Badge({
  children,
  tone = "gray",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-card border border-line bg-sunken text-fg-muted">
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium text-fg">{title}</h3>
      {description && (
        <p className="max-w-xs text-sm text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-gray-200/70 dark:bg-gray-800 ${className}`}
    />
  );
}

/* ===== 后台/通用共享设计 token（对齐 AI 前端精修风） ===== */

/**
 * 主按钮（中性描边：白底 + 深灰字 + hairline）。
 * 不使用实心黑 —— 用户明确 dislikes「满屏黑按钮」；主次区分靠描边深浅与文字色阶。
 */
export const btnPrimary =
  "flex cursor-pointer items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-sunken active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

/** 幽灵按钮（hairline 描边 + 中性文字） */
export const ghostBtn =
  "flex cursor-pointer items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-sm text-fg-muted transition hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

/** 次要按钮（ghostBtn 的语义别名，供表单/弹窗底栏使用） */
export const btnSoft = ghostBtn;

/** 可点击胶囊基础样式（预设、筛选、标签），最小 32px 命中区 */
export const chipCls =
  "inline-flex cursor-pointer items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

/** 胶囊未选中态 */
export const chipOff =
  "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg";

/** 胶囊选中态（用凹陷浅灰代替实心黑） */
export const chipOn = "border-line-strong bg-sunken text-fg";

/** 输入框统一样式 */
export const inputCls =
  "w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/15";

/** 列表操作小按钮（文字按钮） */
export const rowBtn =
  "cursor-pointer rounded-[8px] px-2.5 py-1 text-xs font-medium transition";

/** 列表操作带边框按钮 */
export const rowBtnBorder =
  "cursor-pointer rounded-[8px] border border-line bg-surface px-2.5 py-1 text-xs text-fg-muted transition hover:bg-sunken hover:text-fg";

/** 卡片容器（surface + hairline，无阴影） */
export const cardCls = "rounded-card border border-line bg-surface";

/** 表单字段：标签 + 控件 + 可选说明 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-fg-muted"
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] leading-relaxed text-fg-muted">{hint}</p>
      )}
    </div>
  );
}

/** 分段单选（等价于原生 radio，键盘可用） */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-0.5 rounded-control border border-line bg-sunken p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition ${
              active
                ? "bg-surface text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-none"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 图标按钮（36px 命中区，选中态用 sunken） */
export function IconButton({
  label,
  onClick,
  active = false,
  disabled = false,
  className = "",
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-control border transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-line-strong bg-sunken text-fg"
          : "border-transparent text-fg-muted hover:bg-sunken hover:text-fg"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** 分区标题（11px 大写字距，替代彩色图标标题） */
export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
        {children}
      </h3>
      {right}
    </div>
  );
}

/** 后台页头：标题 + 副标题 + 右侧主操作按钮 */
export function PageHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          {title}
        </h2>
        {desc && (
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {desc}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Notion「N」logo（官方品牌图标，用于替代 📓 emoji） */
export function NotionIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zM3.01 3.754l15.16-1.31c.56-.047.886.047.793.56L15.213 22.28c-.093.513-.373.652-.793.606L4.552 21.03c-.42-.047-.606-.233-.653-.653l-.934-16.074c-.047-.373.047-.606.045-.549z" />
    </svg>
  );
}

/** 圆角卡片（对齐 AI 前端：细边框 + 无阴影轻质感；暗色自动） */
export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div className={`card ${hover ? "card-hover" : ""} ${className}`}>
      {children}
    </div>
  );
}

/** 行式开关（对齐 SettingsTab 的 h-5 w-9 紧凑开关） */
export function Switch({
  on,
  onChange,
  label,
  sub,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="flex w-full cursor-pointer items-center justify-between gap-3 py-1.5 text-left"
      role="switch"
      aria-checked={on}
    >
      {(label || sub) && (
        <span className="min-w-0">
          {label && (
            <span className="block text-sm font-medium text-fg">{label}</span>
          )}
          {sub && (
            <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-muted">
              {sub}
            </span>
          )}
        </span>
      )}
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          on ? "bg-accent" : "bg-line-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
            on ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
