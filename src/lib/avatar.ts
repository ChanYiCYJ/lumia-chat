import { lsGet, lsRemove, lsSet } from "./chatSettings";

/**
 * 本机自定义头像
 * ------------------------------------------------------------------
 * 设计约定（用户要求）：
 * - **默认不展示头像**：没有配置时界面不再渲染首字/字母占位头像。
 * - 支持两种自定义方式：上传本地图片（压缩成 dataURL 存本机）或粘贴图片地址。
 * - 只保存在当前浏览器的 localStorage，不上传服务器。
 *
 * 纯函数 + 容错读写，便于单测；不依赖 React。
 */

const KEY_PREFIX = "kimo_ai_avatar_";

/** 原图体积上限（压缩前），避免用户误传超大文件卡住主线程 */
export const AVATAR_MAX_BYTES = 6 * 1024 * 1024;
/** 压缩后的正方形边长（128 足够 64px@2x 显示，且控制 localStorage 体积） */
export const AVATAR_PX = 128;

export function avatarKey(pageId: number): string {
  return KEY_PREFIX + pageId;
}

/**
 * 归一化头像值：
 * - 空 → null（= 不展示头像）
 * - data:image/... → 原样返回（上传后压缩的图片）
 * - http(s):// → 原样返回（外链图片）
 * - /xxx → 站内相对路径（如 /favicon.svg）
 * - 其他（javascript:、file:、纯文本）→ null，避免 XSS / 无效资源
 */
export function normalizeAvatar(
  value: string | null | undefined,
): string | null {
  const s = (value || "").trim();
  if (!s) return null;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return null;
}

export function loadAvatar(pageId: number): string | null {
  return normalizeAvatar(lsGet(avatarKey(pageId)));
}

/** 保存头像；非法值不写入并返回 false */
export function saveAvatar(pageId: number, value: string): boolean {
  const n = normalizeAvatar(value);
  if (!n) return false;
  lsSet(avatarKey(pageId), n);
  return true;
}

export function clearAvatar(pageId: number): void {
  lsRemove(avatarKey(pageId));
}

/** 读取文件为 dataURL（浏览器端；非浏览器环境抛错由调用方兜底） */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 把用户选择的图片文件转成 128px 正方形 dataURL（居中裁切 + JPEG 压缩）。
 * 失败时抛出带中文提示的 Error，供设置页展示。
 */
export async function fileToAvatarDataUrl(
  file: File,
  px = AVATAR_PX,
): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("图片过大（最大 6MB）");

  const dataUrl = await readFileAsDataUrl(file);

  // 无 DOM / 无法解码（如 jsdom、服务端渲染）时保留原图，保证可用性
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return dataUrl;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("图片解析失败，请换一张试试"));
    el.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const side = Math.min(w, h) || px;
  ctx.drawImage(
    img,
    Math.max(0, (w - side) / 2),
    Math.max(0, (h - side) / 2),
    side,
    side,
    0,
    0,
    px,
    px,
  );

  try {
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    // 某些环境下 canvas 被污染会抛错，回退原图
    return dataUrl;
  }
}
