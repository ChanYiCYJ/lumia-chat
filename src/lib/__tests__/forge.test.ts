import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentTools, guardTool, toolUi } from "../agent/plugins";
import {
  FORGE_KEY,
  listForgeSpecs,
  parseForgeSpec,
  renderTemplate,
} from "../agent/plugins/forge";

const ctx = {
  pageId: 9,
  sessionId: "forge-s",
  mode: "auto" as const,
  webEnabled: true,
};

function tool(name: string) {
  const found = createAgentTools(ctx).find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

const text = (res: { content: unknown[] }) =>
  (res.content[0] as { text: string }).text;

const create = (spec: unknown) =>
  tool("plugin_forge_create").execute("f0", { spec: JSON.stringify(spec) });

const notesSpec = {
  id: "notes",
  name: "笔记",
  description: "自建笔记插件",
  tools: [
    {
      name: "add",
      description: "记一条笔记",
      params: { text: { type: "string", required: true } },
      steps: [
        { op: "kv.set", key: "{{args.text}}", value: "1", save: "ok" },
        { op: "text", template: "已记录 {{args.text}}（{{ok}}）", save: "msg" },
      ],
      output: "{{msg}}",
    },
    {
      name: "list",
      description: "列出所有笔记",
      steps: [{ op: "kv.list", save: "all" }],
      output: "{{all}}",
    },
  ],
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("forge 引擎", () => {
  it("模板渲染支持 args 嵌套与对象 JSON 化", () => {
    expect(
      renderTemplate("城市 {{args.city}} / {{args.list[0]}} / {{obj}}", {
        args: { city: "上海", list: ["a"] },
        obj: { a: 1 },
      }),
    ).toBe('城市 上海 / a / {"a":1}');
  });

  it("校验错误给出可自我修正的中文提示", () => {
    expect(() => parseForgeSpec("not json")).toThrow(/不是合法 JSON/);
    expect(() =>
      parseForgeSpec('{"id":"Bad-ID","name":"x","tools":[]}'),
    ).toThrow(/slug/);
    expect(() =>
      parseForgeSpec(
        JSON.stringify({
          id: "demo",
          name: "demo",
          tools: [{ name: "run", description: "d", steps: [{ op: "eval" }] }],
        }),
      ),
    ).toThrow(/op 不支持/);
    expect(() =>
      parseForgeSpec(
        JSON.stringify({
          id: "demo",
          name: "demo",
          tools: [{ name: "run", description: "d", steps: [] }],
        }),
      ),
    ).toThrow(/steps 不能为空/);
  });

  it("创建后工具立刻可用（含 kv 持久化）", async () => {
    const res = await create(notesSpec);
    expect(text(res)).toContain("u_notes_add");

    const added = await tool("u_notes_add").execute("a1", { text: "买牛奶" });
    expect(text(added)).toBe("已记录 买牛奶（ok）");

    const listed = await tool("u_notes_list").execute("a2", {});
    expect(text(listed)).toContain("买牛奶");

    // 工具卡显示插件名
    expect(toolUi("u_notes_add").type).toBe("笔记");
  });

  it("重复创建同一个 id 是更新而非新建", async () => {
    await create(notesSpec);
    await create({ ...notesSpec, name: "笔记 v2" });
    expect(listForgeSpecs()).toHaveLength(1);
    expect(toolUi("u_notes_add").type).toBe("笔记 v2");
  });

  it("删除插件后工具消失", async () => {
    await create(notesSpec);
    expect(createAgentTools(ctx).some((t) => t.name === "u_notes_list")).toBe(
      true,
    );
    await tool("plugin_forge_delete").execute("d1", { id: "notes" });
    expect(createAgentTools(ctx).some((t) => t.name === "u_notes_list")).toBe(
      false,
    );
    expect(localStorage.getItem(FORGE_KEY)).toBe("[]");
  });

  it("缺少必填参数时拒绝执行", async () => {
    await create(notesSpec);
    await expect(tool("u_notes_add").execute("a3", {})).rejects.toThrow(
      /缺少参数 text/,
    );
  });

  it("http.get 只允许 https，且禁止内网地址", async () => {
    await create({
      id: "net",
      name: "网络",
      tools: [
        {
          name: "plain",
          description: "http",
          steps: [{ op: "http.get", url: "http://example.com/a", save: "r" }],
          output: "{{r}}",
        },
        {
          name: "inner",
          description: "内网",
          steps: [{ op: "http.get", url: "https://localhost/a", save: "r" }],
          output: "{{r}}",
        },
      ],
    });
    await expect(tool("u_net_plain").execute("n1", {})).rejects.toThrow(
      /https/,
    );
    await expect(tool("u_net_inner").execute("n2", {})).rejects.toThrow(/内网/);
  });

  it("http.get 成功时把响应交给 output 模板", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '{"temp":20}',
      })),
    );
    await create({
      id: "weather",
      name: "天气",
      tools: [
        {
          name: "query",
          description: "查天气",
          params: { city: { type: "string", required: true } },
          steps: [
            {
              op: "http.get",
              url: "https://api.example.com/?city={{args.city}}",
              save: "raw",
            },
          ],
          output: "{{args.city}}：{{raw}}",
        },
      ],
    });
    const res = await tool("u_weather_query").execute("w1", { city: "上海" });
    expect(text(res)).toBe('上海：{"temp":20}');
    const calledUrl = (fetch as unknown as { mock: { calls: string[][] } }).mock
      .calls[0][0];
    expect(calledUrl).toContain("city=%E4%B8%8A%E6%B5%B7");
  });

  it("含 http 步骤的自建工具受联网 / Fast 模式限制", async () => {
    await create({
      id: "webtool",
      name: "联网自建",
      tools: [
        {
          name: "get",
          description: "联网",
          steps: [
            { op: "http.get", url: "https://api.example.com/x", save: "r" },
          ],
          output: "{{r}}",
        },
        {
          name: "local",
          description: "本地",
          steps: [{ op: "text", template: "ok", save: "r" }],
          output: "{{r}}",
        },
      ],
    });
    expect(guardTool("u_webtool_get", { ...ctx, webEnabled: false })).toMatch(
      /未开启联网/,
    );
    expect(guardTool("u_webtool_get", { ...ctx, mode: "fast" })).toMatch(
      /Fast/,
    );
    // 纯本地步骤不受联网限制
    expect(
      guardTool("u_webtool_local", { ...ctx, webEnabled: false }),
    ).toBeUndefined();
  });

  it("http 返回 JSON 自动解析，json.get / 模板均可取嵌套字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '{"data":{"list":[{"name":"上海"}]}}',
      })),
    );
    await create({
      id: "jsontest",
      name: "JSON 插件",
      tools: [
        {
          name: "get",
          description: "取城市",
          steps: [
            {
              op: "http.get",
              url: "https://api.example.com/x",
              save: "raw",
            },
            {
              op: "json.get",
              from: "raw",
              path: "data.list[0].name",
              save: "city",
            },
          ],
          output: "城市：{{city}} / 模板：{{raw.data.list[0].name}}",
        },
      ],
    });
    const res = await tool("u_jsontest_get").execute("j1", {});
    expect(text(res)).toBe("城市：上海 / 模板：上海");
  });

  it("网络/CORS 失败时给出第几步失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await create({
      id: "broken",
      name: "坏插件",
      tools: [
        {
          name: "go",
          description: "会失败",
          steps: [
            { op: "http.get", url: "https://api.example.com/x", save: "r" },
          ],
        },
      ],
    });
    await expect(tool("u_broken_go").execute("b1", {})).rejects.toThrow(
      /第 1 步（http.get）失败/,
    );
  });
});
