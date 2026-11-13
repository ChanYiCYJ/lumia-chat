import { describe, it, expect, afterEach } from "vitest";
import {
  createAgentTools,
  guardTool,
  isWebTool,
  listPlugins,
  pluginSystemSections,
  pluginTagPatterns,
  pluginToolsPrompt,
  registerPlugin,
  toolUi,
  unregisterPlugin,
} from "../agent/plugins";
import type { AgentPlugin } from "../agent/plugins";
import { stripToolCmds } from "../toolCmds";

const ctx = (over: Record<string, unknown> = {}) => ({
  pageId: 1,
  sessionId: "s1",
  mode: "auto" as const,
  webEnabled: true,
  ...over,
});

/** 最小可用的 demo 插件：验证「只注册插件即可扩展」 */
function demoPlugin(): AgentPlugin {
  return {
    id: "demo",
    name: "演示插件",
    priority: 999,
    ui: { demo_echo: { type: "演示" } },
    promptLines: () => "- 演示：调用 demo_echo。\n",
    tools: () => [
      {
        name: "demo_echo",
        label: "回声",
        description: "回显输入",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
        },
        execute: async (_id: string, raw: unknown) => {
          const p = raw as { text?: string };
          return {
            content: [{ type: "text" as const, text: p.text || "" }],
            details: {},
          };
        },
      },
    ],
  };
}

afterEach(() => {
  unregisterPlugin("demo");
  unregisterPlugin("dup");
});

describe("Agent 插件注册表", () => {
  it("自动发现内置插件", () => {
    const ids = listPlugins().map((p) => p.id);
    for (const id of [
      "web",
      "panel",
      "artifacts",
      "kb",
      "media",
      "notion",
      "live2d",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("聚合工具且工具名不重复", () => {
    const names = createAgentTools(ctx()).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    // 原有能力一个都不能少
    for (const name of [
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
      "todo_add",
      "list_artifacts",
      "read_artifact",
      "write_artifact",
      "open_artifact",
      "delete_artifact",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("每个工具都有工具卡 UI 声明", () => {
    for (const tool of createAgentTools(ctx())) {
      expect(toolUi(tool.name).type).toBeTruthy();
      expect(toolUi(tool.name).type).not.toBe(tool.name);
    }
  });

  it("联网守卫按插件 web 标记生效", () => {
    expect(isWebTool("web_search")).toBe(true);
    expect(isWebTool("kb_save")).toBe(false);
    expect(guardTool("web_search", ctx({ webEnabled: false }))).toMatch(
      /联网工具已关闭/,
    );
    expect(guardTool("web_search", ctx({ mode: "fast" }))).toMatch(/Fast/);
    expect(guardTool("kb_save", ctx({ mode: "fast" }))).toBeUndefined();
  });

  it("插件自定义守卫（Notion 未配置）", () => {
    expect(guardTool("notion_query", ctx())).toMatch(/Notion/);
    expect(
      guardTool("notion_query", ctx({ notionToken: "t" })),
    ).toBeUndefined();
  });

  it("提示词行由插件提供，并跟随开关", () => {
    const on = pluginToolsPrompt({ agentNative: true, webTools: true });
    expect(on).toContain("web_search");
    expect(on).toContain("kb_save");
    expect(on).toContain("image_search");
    expect(on).toContain("live2d_perform");
    const off = pluginToolsPrompt({ agentNative: true, webTools: false });
    expect(off).not.toContain("web_search");
    expect(off).toContain("kb_save");
  });

  it("动态注册即生效，注销即移除", async () => {
    registerPlugin(demoPlugin());
    const tool = createAgentTools(ctx()).find((t) => t.name === "demo_echo");
    expect(tool).toBeTruthy();
    expect(toolUi("demo_echo").type).toBe("演示");
    expect(pluginToolsPrompt({ agentNative: true })).toContain("demo_echo");
    const res = await tool!.execute("c1", { text: "hi" });
    expect((res.content[0] as { text: string }).text).toBe("hi");

    unregisterPlugin("demo");
    expect(createAgentTools(ctx()).some((t) => t.name === "demo_echo")).toBe(
      false,
    );
  });

  it("工具名冲突时立刻报错（插件作者常见错误）", () => {
    const dup = demoPlugin();
    registerPlugin({
      ...dup,
      id: "dup",
      tools: () => [
        {
          name: "kb_save",
          label: "冲突",
          description: "冲突",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [], details: {} }),
        },
      ],
    });
    expect(() => createAgentTools(ctx())).toThrow(/工具名冲突/);
  });

  it("插件可贡献旧 TAG 通道的清洗正则", () => {
    for (const re of pluginTagPatterns()) {
      expect(stripToolCmds("[表情:开心] 你好 [MOTION:smile01]")).not.toMatch(
        /MOTION:/,
      );
      expect(re.test("x")).toBeDefined(); // 正则合法即可
      re.lastIndex = 0;
    }
  });

  it("内置待办与插件工厂已注册", () => {
    const ids = listPlugins().map((p) => p.id);
    expect(ids).toContain("todo");
    expect(ids).toContain("forge");
    const names = createAgentTools(ctx()).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "todo_add",
        "todo_list",
        "plugin_forge_create",
        "plugin_forge_list",
        "plugin_forge_get",
        "plugin_forge_delete",
      ]),
    );
  });

  it("插件自带的 system 段会被注入（systemSection 扩展点）", () => {
    registerPlugin({
      ...demoPlugin(),
      systemSection: () => ({ id: "demoSec", text: "\n\n【演示段】" }),
    });
    const sections = pluginSystemSections({ agentNative: true });
    expect(sections.map((s) => s.id)).toContain("demoSec");
  });
});
