import { describe, it, expect } from "vitest";
import { cacheTtlMs, todayStr, isFreshQuery } from "../searchApi";

describe("searchApi · 时间工具", () => {
  it("cacheTtlMs 固定 1 小时", () => {
    expect(cacheTtlMs()).toBe(60 * 60 * 1000);
  });

  it("todayStr 输出 YYYY-MM-DD", () => {
    expect(todayStr(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayStr(new Date(2026, 10, 13))).toBe("2026-11-13");
  });

  it("isFreshQuery 识别时敏词", () => {
    expect(isFreshQuery("今天有什么新闻")).toBe(true);
    expect(isFreshQuery("latest AI models")).toBe(true);
    expect(isFreshQuery("React useEffect 用法")).toBe(false);
    expect(isFreshQuery("")).toBe(false);
  });
});
