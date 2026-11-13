import { beforeEach, describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  avatarKey,
  clearAvatar,
  fileToAvatarDataUrl,
  loadAvatar,
  normalizeAvatar,
  saveAvatar,
} from "../avatar";

const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

describe("avatar normalize", () => {
  it("空值视为未设置（默认不展示头像）", () => {
    expect(normalizeAvatar(null)).toBeNull();
    expect(normalizeAvatar(undefined)).toBeNull();
    expect(normalizeAvatar("")).toBeNull();
    expect(normalizeAvatar("   ")).toBeNull();
  });

  it("接受 dataURL / http(s) / 站内相对路径", () => {
    expect(normalizeAvatar(DATA_URL)).toBe(DATA_URL);
    expect(normalizeAvatar("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(normalizeAvatar("  http://example.com/a.jpg  ")).toBe(
      "http://example.com/a.jpg",
    );
    expect(normalizeAvatar("/favicon.svg")).toBe("/favicon.svg");
  });

  it("拒绝危险或非法协议", () => {
    expect(normalizeAvatar("javascript:alert(1)")).toBeNull();
    expect(normalizeAvatar("data:text/html;base64,xxx")).toBeNull();
    expect(normalizeAvatar("//evil.com/a.png")).toBeNull();
    expect(normalizeAvatar("随便一段文字")).toBeNull();
  });
});

describe("avatar storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("按 pageId 隔离保存与读取", () => {
    expect(saveAvatar(1, "https://a.com/1.png")).toBe(true);
    expect(saveAvatar(2, DATA_URL)).toBe(true);
    expect(loadAvatar(1)).toBe("https://a.com/1.png");
    expect(loadAvatar(2)).toBe(DATA_URL);
    expect(localStorage.getItem(avatarKey(1))).toBe("https://a.com/1.png");
  });

  it("非法值不写入，也不覆盖已有头像", () => {
    expect(saveAvatar(1, "https://a.com/1.png")).toBe(true);
    expect(saveAvatar(1, "javascript:alert(1)")).toBe(false);
    expect(loadAvatar(1)).toBe("https://a.com/1.png");
  });

  it("未设置时读取为 null", () => {
    expect(loadAvatar(3)).toBeNull();
  });

  it("clearAvatar 移除本机头像", () => {
    saveAvatar(1, DATA_URL);
    clearAvatar(1);
    expect(loadAvatar(1)).toBeNull();
  });
});

describe("fileToAvatarDataUrl", () => {
  it("拒绝非图片文件", async () => {
    const f = new File(["hello"], "a.txt", { type: "text/plain" });
    await expect(fileToAvatarDataUrl(f)).rejects.toThrow("请选择图片文件");
  });

  it("拒绝超大图片", async () => {
    const big = new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], "big.png", {
      type: "image/png",
    });
    await expect(fileToAvatarDataUrl(big)).rejects.toThrow("图片过大");
  });
});
