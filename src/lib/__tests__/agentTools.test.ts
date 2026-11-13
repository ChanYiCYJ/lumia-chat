import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAgentTools } from "../agent/piTools";
import { createTagGate, shouldRunTag } from "../agent/tagBridge";
import {
  getToolSupport,
  markToolSupport,
  resetToolSupport,
  toolSupportKey,
} from "../agent/capability";
import { listArtifacts } from "../artifacts";
import { saveKbEntry } from "../kb";

function ctx(overrides: Partial<Parameters<typeof createAgentTools>[0]> = {}) {
  return {
    pageId: 3,
    sessionId: "s1",
    mode: "auto" as const,
    webEnabled: true,
    ...overrides,
  };
}

function findTool(tools: ReturnType<typeof createAgentTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("原生工具注册", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("注册了完整的工具集", () => {
    const names = createAgentTools(ctx()).map((t) => t.name);
    for (const expected of [
      "web_search",
      "fetch_page",
      "open_webpage",
      "generate_article",
      "open_panel",
      "kb_search",
      "kb_read",
      "kb_save",
      "kb_delete",
      "image_search",
      "notion_query",
      "live2d_perform",
      "list_artifacts",
      "read_artifact",
      "write_artifact",
      "open_artifact",
      "delete_artifact",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("open_webpage 在联网关闭时被拒绝", async () => {
    const tool = findTool(
      createAgentTools(ctx({ webEnabled: false })),
      "open_webpage",
    );
    await expect(
      tool.execute("c0", { url: "https://example.com" }),
    ).rejects.toThrow(/未开启联网/);
  });

  it("open_panel 触发面板切换", async () => {
    const openPanel = vi.fn();
    const tools = createAgentTools(ctx({ openPanel }));
    await findTool(tools, "open_panel").execute("c9", { tab: "kb" });
    expect(openPanel).toHaveBeenCalledWith("kb", undefined, true);
  });

  it("kb_read 返回知识条目全文", async () => {
    saveKbEntry("周报模板", "# 模板\n正文内容");
    const res = (await findTool(createAgentTools(ctx()), "kb_read").execute(
      "c10",
      { title: "周报" },
    )) as { content: { text: string }[] };
    expect(res.content[0].text).toContain("正文内容");
  });

  it("delete_artifact 删除产物并回调 UI", async () => {
    const onArtifactRemoved = vi.fn();
    const tools = createAgentTools(ctx({ onArtifactRemoved }));
    await findTool(tools, "write_artifact").execute("c11", {
      title: "待删产物",
      content: "内容",
    });
    await findTool(tools, "delete_artifact").execute("c12", {
      title: "待删",
    });
    expect(listArtifacts(3, "s1")).toHaveLength(0);
    expect(onArtifactRemoved).toHaveBeenCalledTimes(1);
  });

  it("联网工具在关闭联网时被拒绝", async () => {
    const tool = findTool(
      createAgentTools(ctx({ webEnabled: false })),
      "web_search",
    );
    await expect(tool.execute("c1", { query: "今天新闻" })).rejects.toThrow(
      /未开启联网/,
    );
  });

  it("Fast 模式禁止联网工具", async () => {
    const tool = findTool(
      createAgentTools(ctx({ mode: "fast" })),
      "generate_article",
    );
    await expect(tool.execute("c2", { topic: "新番" })).rejects.toThrow(
      /Fast 模式/,
    );
  });

  it("write_artifact 写入产物并可被 list/read 读回", async () => {
    const onArtifact = vi.fn();
    const tools = createAgentTools(ctx({ onArtifact }));

    const write = findTool(tools, "write_artifact");
    const res = (await write.execute("c3", {
      kind: "doc",
      title: "周报",
      content: "# 周报\n本周完成 A、B",
    })) as { details: { id: string } };

    expect(onArtifact).toHaveBeenCalledTimes(1);
    const saved = listArtifacts(3, "s1");
    expect(saved).toHaveLength(1);
    expect(saved[0].kind).toBe("doc");
    expect(saved[0].id).toBe(res.details.id);

    const list = (await findTool(tools, "list_artifacts").execute(
      "c4",
      {},
    )) as {
      content: { text: string }[];
    };
    expect(list.content[0].text).toContain("周报");

    const read = (await findTool(tools, "read_artifact").execute("c5", {
      id: saved[0].id,
    })) as { content: { text: string }[] };
    expect(read.content[0].text).toContain("本周完成");
  });

  it("read_artifact 找不到时报错（由 agent 转成工具错误）", async () => {
    const tools = createAgentTools(ctx());
    await expect(
      findTool(tools, "read_artifact").execute("c6", { id: "nope" }),
    ).rejects.toThrow(/没有找到/);
  });

  it("open_artifact 触发面板回调", async () => {
    const openPanel = vi.fn();
    const tools = createAgentTools(ctx({ openPanel }));
    await findTool(tools, "write_artifact").execute("c7", {
      title: "方案",
      content: "内容",
    });
    const res = (await findTool(tools, "open_artifact").execute("c8", {
      kind: "note",
    })) as { details: { id: string } };
    expect(openPanel).toHaveBeenCalledWith("artifacts", res.details.id);
  });
});

describe("双通道去重", () => {
  it("旧通道（agentUsed=false）放行所有标记", () => {
    const gate = createTagGate({ agentUsed: false, ranTools: new Set() });
    expect(gate.search).toBe(true);
    expect(gate.kb).toBe(true);
    expect(gate.view).toBe(true);
  });

  it("原生通道已调用对应工具时不重复执行标记", () => {
    const ran = new Set(["web_search", "kb_save"]);
    expect(shouldRunTag("search", { agentUsed: true, ranTools: ran })).toBe(
      false,
    );
    expect(shouldRunTag("kb", { agentUsed: true, ranTools: ran })).toBe(false);
    // 未调用过的工具 → 保留标记兜底
    expect(shouldRunTag("browse", { agentUsed: true, ranTools: ran })).toBe(
      true,
    );
    expect(shouldRunTag("article", { agentUsed: true, ranTools: ran })).toBe(
      true,
    );
  });
});

describe("模型 tools 能力缓存", () => {
  beforeEach(() => {
    localStorage.clear();
    resetToolSupport();
  });

  it("默认 unknown，标记后生效", () => {
    expect(getToolSupport("https://api.x.com/v1", "m1")).toBe("unknown");
    markToolSupport("https://api.x.com/v1", "m1", "unsupported");
    expect(getToolSupport("https://api.x.com/v1/", "M1")).toBe("unsupported");
    // 不同模型互不影响
    expect(getToolSupport("https://api.x.com/v1", "m2")).toBe("unknown");
  });

  it("缓存键忽略尾部斜杠与大小写", () => {
    expect(toolSupportKey("https://A.com/v1/", "Model")).toBe(
      toolSupportKey("https://a.com/v1", "model"),
    );
  });
});
