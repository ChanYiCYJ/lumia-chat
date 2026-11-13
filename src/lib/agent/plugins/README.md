# Agent 插件开发指南

一句话：**新增一个功能 = 新建一个 `xxxPlugin.ts` 文件**，工具、system 提示词、
聊天里的工具卡、联网/配置守卫全部自动生效，不需要再改核心代码。

## 目录结构

```
src/lib/agent/
├── plugins/
│   ├── types.ts        # 插件协议（AgentPlugin / ToolContext / ToolUi）
│   ├── shared.ts       # 插件共用：ok / fail / saveArtifact / requireWeb …
│   ├── index.ts        # 注册表核心（自动发现 + 排序 + 聚合）
│   ├── webPlugin.ts        # 联网：web_search / fetch_page / open_webpage / generate_article
│   ├── panelPlugin.ts      # 界面：open_panel
│   ├── artifactsPlugin.ts  # 产物：list/read/write/open/delete_artifact
│   ├── kbPlugin.ts         # 知识库：kb_search / kb_read / kb_save / kb_delete
│   ├── mediaPlugin.ts      # 图片：image_search
│   ├── notionPlugin.ts     # Notion：notion_query（guard：未配置 Token 直接拒绝）
│   ├── live2dPlugin.ts     # 角色：live2d_perform（+ TAG 清洗正则）
│   ├── ankiPlugin.ts       # 学习：anki_add / anki_due / anki_grade / anki_stats / anki_reset
│   ├── forge.ts            # 插件工厂引擎（声明式 DSL 解释器，无 eval）
│   └── forgePlugin.ts      # 插件工厂插件：plugin_forge_* + 动态生成的 u_* 工具
├── piRunner.ts         # 运行器（工具循环 / 中断 / 轮次预算）
├── piLlm.ts            # 模型适配（tool calling）
└── piTools.ts          # 兼容门面，旧 import 路径仍可用
```

## 插件协议

```ts
import type { AgentPlugin } from "./types";
import { ok, fail, saveArtifact } from "./shared";

export default {
  id: "weather", // 唯一 id
  name: "天气",
  priority: 60, // 小在前：影响工具声明顺序 + 提示词行顺序
  web: true, // 联网类功能：Fast 模式/未联网时核心自动拦截
  guard: (ctx) => (ctx.weatherKey ? undefined : "未配置天气 Key"),
  ui: { weather_query: { type: "天气", tab: "artifacts" } }, // 工具卡展示
  promptLines: () => "- 查天气：调用 weather_query（city）。\n", // system 补充说明
  tagPatterns: [/\[WEATHER:[^\]]*\]/gi], // 旧 TAG 通道清洗（可选）
  // 需要独立提示词段时（不是工具说明）：systemSection 会被 assembleSystem 注入
  systemSection: (ctx) =>
    ctx.agentNative
      ? { id: "weatherHabit", text: "\n\n【天气】…" }
      : { id: "weatherHabit", text: "" },
  // 动态生成的工具（运行时才知道名字）用 resolveUi 解析卡片展示
  resolveUi: (name) =>
    name.startsWith("u_") ? { type: "天气", tab: "artifacts" } : undefined,
  tools: (ctx) => [
    {
      name: "weather_query",
      label: "查天气",
      description: "查询指定城市实时天气",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const city = String((raw as { city?: string }).city || "").trim();
        if (!city) fail("city 不能为空");
        const text = await fetchWeather(city, ctx.weatherKey);
        saveArtifact(ctx, {
          kind: "note",
          title: `天气：${city}`,
          content: text,
        });
        return ok(text, { city });
      },
    },
  ],
} satisfies AgentPlugin;
```

放进去即可，`registry.ts` 用 `import.meta.glob("./*Plugin.ts", { eager: true })` 自动发现。

## 约定（照着做就不会踩坑）

1. **`tools(ctx)` 必须是纯声明**：不要在声明期读 `ctx` 字段或产生副作用
   （注册表建索引时会用空 ctx 调一次），所有 `ctx` 使用都放进 `execute`。
2. **失败一律 `throw`**（用 `fail(...)`），pi 会把异常转成 `isError` 结果给模型重试；
   不要把错误写进 `content` 当成功返回。
3. **数据操作 + 回调**：写文件/调 UI 一律通过 `ctx.openPanel / ctx.onArtifact`，
   插件不直接碰 React state。
4. **工具名全局唯一**：重名会在 `createAgentTools()` 时直接抛错（防止静默覆盖）。
5. **每个工具都声明 `ui`**：否则卡片会退化成原始工具名。
6. **联网功能标 `web: true`**，别在 execute 里另写 fast/联网判断（有 `requireWeb` 兜底）。
7. 长内容进产物（`saveArtifact` / `write_artifact`），对话正文只给摘要。

## AI 自写插件（插件工厂）

不需要写代码：模型用 `plugin_forge_create` 提交一份 **声明式 JSON**，引擎解释执行
（无 `eval` / `new Function`，符合 CSP），持久化在 localStorage，重启仍在。

```json
{
  "id": "weather",
  "name": "天气",
  "tools": [
    {
      "name": "query",
      "description": "查指定城市天气",
      "params": { "city": { "type": "string", "required": true } },
      "steps": [
        {
          "op": "http.get",
          "url": "https://api.open-meteo.com/v1/forecast?latitude=31.2&longitude=121.5",
          "save": "raw"
        },
        {
          "op": "text",
          "template": "{{args.city}} 天气：{{raw}}",
          "save": "msg"
        }
      ],
      "output": "{{msg}}"
    }
  ]
}
```

- 生成工具名 `u_<插件id>_<工具名>`（如上例 `u_weather_query`）。
- 支持步骤：`http.get` / `http.post`（仅 https，禁止内网地址）、`kv.get|set|list|delete`
  （插件私有存储）、`text`。模板 `{{args.x}}` / `{{保存名}}`。
- 每个请求前 `piRunner.prepareRequest` 会对比工具集——**创建当轮即可调用新工具**。
- 元工具：`plugin_forge_create` / `plugin_forge_list` / `plugin_forge_get` / `plugin_forge_delete`。
- 限制：≤20 个插件、每插件 ≤8 工具、每个工具 ≤16 步；跨域接口需目标支持 CORS。

## 内置学习小程序（Anki）

`anki.ts` 是纯 SM-2 调度 + localStorage 存储；`ankiPlugin.ts` 暴露 5 个工具，
以对话为界面：`anki_due` 只给正面 → 用户作答 → `anki_grade` 揭晓背面并排期。
新增卡片时会同步写一份「背卡：<卡组>」产物，方便在产物面板翻看/导出。

## 运行时动态挂载

```ts
import { registerPlugin, unregisterPlugin } from "../lib/agent/plugins";

registerPlugin(myPlugin); // 按 id 覆盖内置实现（适合 A/B、灰度、测试）
unregisterPlugin("weather"); // 移除，回落内置实现
```

## 相关测试

- `src/lib/__tests__/agentPlugins.test.ts`：自动发现、工具名唯一、UI 声明、
  联网/自定义守卫、提示词开关跟随、动态注册与注销、重名报错、TAG 清洗、system 段注入。
- `src/lib/__tests__/agentTools.test.ts`：每个工具的行为（execute 层）。
- `src/lib/__tests__/anki.test.ts`：SM-2 排期、去重、统计、anki\_\* 工具闭环。
- `src/lib/__tests__/forge.test.ts`：规格校验、模板渲染、创建/更新/删除、
  kv 持久化、https/内网限制、失败步骤定位。
