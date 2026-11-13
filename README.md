# Lumia Chat

Lumia Chat 是从 Lumia 博客前端拆出的独立 AI 对话应用。它保留原有的多模型对话、会话历史、联网搜索、知识库、Notion、语音和 Live2D 能力；博客文章、后台和站点导航不属于本项目。

## 本地开发

要求 Node.js `>=22.12.0`。

```bash
npm ci
npm run dev
```

应用启动后可在聊天界面配置 OpenAI 兼容模型。API 地址、密钥和模型配置保存在当前浏览器的 `localStorage`，不会随静态页面部署到服务器。不要在共享设备上保存个人密钥。

需要使用 DeepSeek 网页搜索代理时，在另一个终端启动本项目的 Worker：

```bash
npm run build
npm run dev:worker
```

Vite 默认把 `/api/deepseek/*` 转发到本地 Worker `http://localhost:8787`。可通过 `DEEPSEEK_PROXY_ORIGIN` 指定其他 Worker 地址。开发时如需知识库备份、Notion 代理或后端 API，请按 `vite.config.ts` 配置对应服务。

## 构建

```bash
npm run build
npm run preview
```

构建产物位于 `dist/`。

## 部署到 Cloudflare Workers

1. 将仓库推送到 GitHub，并在本地安装依赖：

   ```bash
   npm ci
   npx wrangler login
   ```

2. 如需使用 Lumia FastAPI 的后端能力（例如远程备份或服务端 API），配置后端 URL。地址应为后端 API 的 origin，不要加尾部斜杠：

   ```bash
   npx wrangler secret put API_BACKEND
   ```

   在提示中输入后端地址，例如 `https://api.example.com`。若不需要这些后端能力，可跳过此项。

3. 构建并发布：

   ```bash
   npm run deploy:cf
   ```

   `wrangler.jsonc` 会将 `dist/` 作为静态资源部署，并由 `worker.js` 处理搜索、Live2D、Notion 和可选的后端代理。首次部署会分配 `lumia-chat.<你的 Cloudflare 子域>.workers.dev` 地址。

4. 绑定自定义域名：Cloudflare 控制台 → **Workers & Pages** → **lumia-chat** → **Settings** → **Domains & Routes**。

后续更新执行 `git pull` 后重新运行 `npm run deploy:cf`。切勿将模型 API Key、`API_BACKEND` 密钥或其他凭据提交到仓库。

## 配置说明

| 项目 | 说明 |
| --- | --- |
| 模型 API | 在聊天页的本机模型设置中填写 OpenAI 兼容接口、API Key 和模型名称 |
| 对话与偏好 | 保存在浏览器本地；清除站点数据会一并清除 |
| `API_BACKEND` | 可选 Cloudflare Secret，用于反向代理到 Lumia FastAPI |
| `DEEPSEEK_PROXY_ORIGIN` | 可选开发环境变量，用于指定 DeepSeek 搜索代理 Worker |

## License

MIT
