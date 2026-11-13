# Lumia Chat

> 把 AI 对话、Agent 工具箱、知识库、学习系统和 Live2D 角色放进同一页面的开源聊天应用。

**[在线体验](https://lumia-chat.3022535842.workers.dev)** · **[Agent 设计规范](docs/agent-design.md)** · **[问题反馈](https://github.com/ChanYiCYJ/lumia-chat/issues)**

`MIT` · `Vite 8` · `React 19` · `TypeScript` · `pi-agent-core` · `Cloudflare Workers`

Lumia Chat 最初从 Lumia 博客前端拆分而来，现在是一个独立的 AI 工作台：对话不只是聊天，还能调用工具生成产物、维护知识库、管理学习进度、接入外部 MCP 服务，并让 Live2D 角色配合说话与做动作。

## 功能

### 对话
- 任意 OpenAI 兼容接口，内置 DeepSeek / Kimi / OpenAI / 小米 MiMo / 阿里云 Qwen / 智谱 GLM / 硅基流动 / OpenRouter 厂商预设
- 多会话、全文搜索、重命名、置顶排序，深色主题与响应式布局
- Markdown 渲染（代码块、表格、公式、任务列表）、消息复制 / 反馈 / 重试
- 语音朗读（TTS）：内置后端或第三方语音地址，可选音色，和 Live2D 口型联动

### Agent 工具箱
- 基于 [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) 的原生工具调用，按 `fast / auto / deep` 三档预算自动收尾，长对话自动裁剪上下文
- 底部状态栏实时显示模型、模式、输入/输出 token、提示词缓存命中率与待办数量
- 产物面板：文章、搜索、网页、文档、知识条、图片、笔记统一为卡片列表 + 阅读详情，支持复制、保存到知识库、重新生成、删除

### 插件化架构
Agent 的能力全部是插件，放进 `src/lib/agent/plugins/` 即自动发现，无需修改核心：

| 插件 | 能力 |
| --- | --- |
| `webPlugin` / `mediaPlugin` | 联网搜索、网页抓取、图片搜索 |
| `artifactsPlugin` | 产物增删改查与打开 |
| `kbPlugin` / `notionPlugin` | 知识库读写、Notion 查询 |
| `live2dPlugin` / `panelPlugin` | 表情动作表演、界面导航 |
| `todoPlugin` | 待办清单（与状态栏联动） |
| `studyPlugin` | 建科目、排知识点、勾进度 |
| `mcpPlugin` | 动态挂载外部 MCP 服务工具 |
| `forgePlugin` | AI 自写插件（声明式 DSL，无 `eval`） |

插件协议只有一份接口：`tools + promptLines + ui + guard + systemSection`，工具也是自动注册、自动生成提示词与工具卡。

### 自定义插件（AI 自写）
直接说「帮我做一个查天气的插件」，AI 会用声明式 DSL 写一个插件并立即生效：
- 支持 `http.get/post`、`json.get`、`kv.get/set/list/delete`、`text`
- 只允许 HTTPS、禁止内网地址、15 秒超时、响应截断，全程无代码执行
- 生成后可查看 README 使用说明，随时停用或删除

### MCP 扩展
设置页「MCP 服务」支持一键预设与自定义服务，工具会自动出现在 Agent 工具列表里：

| 预设 | 说明 |
| --- | --- |
| [墨墨背单词](https://github.com/A11Might/mcp-server-maimemo) | 查词、云词本、释义、助记、例句 |
| [微信读书](https://github.com/freestylefly/mcp-server-weread) | 书架、笔记划线、热门书评 |
| [Microsoft To Do](https://github.com/hechen-coder/microsoft-todo-mcp) | 任务、清单、子步骤、我的一天 |

三者都是本地 stdio 服务，配置页会按你填写的凭据生成桥接命令（`supergateway`，已带 `--cors`）：

```bash
MAIMEMO_TOKEN='你的 Token' npx -y supergateway --stdio "mcp-server-maimemo" \
  --port 8791 --baseUrl http://localhost:8791 --ssePath /sse --messagePath /message --cors
```

跑起来后点「测试连接」，工具即挂载为 `mcp_<服务>_<工具>`。也支持任意 SSE / Streamable HTTP 的远程 MCP 服务（可配请求头）。

> 浏览器只能走 HTTP/SSE，因此 stdio 服务必须经桥接；HTTPS 页面无法直连 `http://localhost`，请用本地 http 环境或 https 反向代理。

### 知识库（Obsidian 风格 + Notion 双向同步）
- 页面树：拖拽移动、重命名、子页面、导入导出 JSON / Markdown
- 双链 `[[页面]]`、反向链接、出链与死链提示、`#标签` 汇总、带片段的全文搜索、最近更新
- Notion 集成：Token 保存在本机，页面自动双向同步，支持迁移本地条目到 Notion 根页面

### 学习系统
- 科目 → 知识点路线图 → AI 课件 → 练习题 → 进度
- 新建科目时可用 AI 生成大纲；知识点可重命名、排序、清空或删除课件
- 依赖关系、完成状态、进度条，AI 也能通过 `study_*` 工具维护进度

### Live2D
- 角色模型加载、待机动作、表情与动作指令（对话中自动触发）
- 桌面版支持自定义模型协议，TTS 朗读时同步口型

## 快速开始

要求 Node.js `>= 22.12.0`。

```bash
npm ci
npm run dev
```

打开终端提示的地址，在「设置 → 模型 API」填写 OpenAI 兼容接口、API Key 与模型名即可开始对话。所有配置只保存在当前浏览器。

可选：启动本地 Worker 以使用 DeepSeek 网页搜索代理、Live2D 资源与后端 API 代理：

```bash
npm run build
npm run dev:worker   # http://localhost:8787
```

Vite 会把 `/api/deepseek/*` 转发到本地 Worker，可用 `DEEPSEEK_PROXY_ORIGIN` 指定其他地址。

## 配置

| 项目 | 位置 | 说明 |
| --- | --- | --- |
| 模型 API | 设置 → 模型 API | OpenAI 兼容地址 / Key / 模型名；可直接选厂商预设 |
| 搜索模式 | 设置 → 搜索模式 | `Fast` 纯本地、`Auto` 按需联网、`Deep` 深度搜索并生成文章 |
| 搜索数据源 | 设置 → 搜索数据源 | DeepSeek 搜索专用 Key（留空复用模型 Key） |
| Notion | 设置 → Notion | Integration Token；授权页面后自动双向同步 |
| MCP | 设置 → MCP 服务 | 内置三套预设或自定义 SSE / HTTP 服务 |
| 语音 | 设置 → 音频 TTS | 朗读开关、内置/第三方来源、音色与试听 |
| 头像 | 设置 → 头像 | 本机压缩为 128×128，也可贴图片地址 |

## Agent 架构

```
用户消息
  → transformContext   长对话裁剪（fitMessages，60k 字符预算）
  → prepareRequest     热更新工具、收尾轮清空工具
  → beforeToolCall     预算/权限拦截，超限只阻断新调用
  → 工具执行           插件 tools() 返回 JSON Schema 工具
  → prepareNextTurn    预算将尽时注入【收尾】提示
  → finishTurn         统计 token / 缓存命中
```

更完整的分层、生命周期、插件协议与安全策略见 [`docs/agent-design.md`](docs/agent-design.md)。

## 目录结构

```
src/
├─ components/          # 对话、Agent 面板、知识库、学习、Live2D、设置等页面
├─ lib/
│  ├─ agent/            # piRunner（钩子接入）+ plugins/（自动发现的插件）
│  ├─ mcp/              # MCP 客户端、预设与配置存储
│  ├─ skills/           # 系统提示词与技能装配
│  ├─ kb*.ts            # 知识库存储、页面树、双链（kbVault）
│  ├─ study.ts          # 学习系统数据层
│  └─ __tests__/        # Vitest 单测（39 个文件 / 752 用例）
├─ worker.js            # Cloudflare Worker（搜索、Live2D、API 代理）
└─ wrangler.jsonc       # Workers 配置（静态资源 + SPA 回退）
```

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发（Vite） |
| `npm run build` | 类型检查 + 生产构建（`dist/`） |
| `npm run preview` | 预览构建产物 |
| `npm run test` | 运行 Vitest 全量测试 |
| `npm run lint` | oxlint 静态检查 |
| `npm run dev:worker` | 本地运行 Cloudflare Worker |
| `npm run deploy:cf` | 构建并部署到 Cloudflare Workers |

## 部署到 Cloudflare Workers

```bash
npm ci
npx wrangler login
npm run deploy:cf
```

`wrangler.jsonc` 会把 `dist/` 作为静态资源发布，并让 `worker.js` 处理 `/api/*` 与 `/static/*`。首次部署会得到 `lumia-chat.<子域>.workers.dev`，自定义域名在 Cloudflare 控制台 → Workers & Pages → Settings → Domains & Routes 绑定。

可选：若需要 Lumia FastAPI 的后端能力（远程备份、服务端 API），配置后端 origin（不要带尾部斜杠）：

```bash
npx wrangler secret put API_BACKEND
```

## 数据与隐私

- API Key、Notion Token、MCP 凭据只保存在浏览器 `localStorage`，不会上传到静态站点
- 会话、知识库、学习进度、待办同样保存在本机；清除站点数据会一并清除
- 无遥测、无第三方统计；联网能力仅在你启用搜索 / MCP / Notion 时发生
- 请勿在共享设备的浏览器里保存个人密钥

## License

[MIT](LICENSE)
