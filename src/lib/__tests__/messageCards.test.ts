import { describe, expect, it } from "vitest";
import { extractSourceLinks } from "../messageCards";

describe("extractSourceLinks", () => {
  it("优先使用 Markdown 链接标题并去重", () => {
    const links = extractSourceLinks(
      "参考 [维基百科](https://zh.wikipedia.org/wiki/A) 与 https://zh.wikipedia.org/wiki/A，以及 https://example.com/x?y=1。",
    );
    expect(links).toHaveLength(2);
    expect(links[0].title).toBe("维基百科");
    expect(links[0].host).toBe("zh.wikipedia.org");
    expect(links[1].host).toBe("example.com");
  });

  it("忽略图片链接与代码块里的 URL", () => {
    const links = extractSourceLinks(
      "![图](https://img.example.com/a.png)\n```\nfetch('https://in.code/x')\n```\nhttps://real.example.com/a",
    );
    expect(links.map((l) => l.host)).toEqual(["real.example.com"]);
    expect(links[0].url).toBe("https://real.example.com/a");
  });

  it("限制返回条数并容忍空输入", () => {
    const text = Array.from(
      { length: 10 },
      (_, i) => `https://s${i}.com/a`,
    ).join(" ");
    expect(extractSourceLinks(text, 3)).toHaveLength(3);
    expect(extractSourceLinks("")).toEqual([]);
  });
});
