/**
 * 内置 MCP 预设：墨墨背单词 / 微信读书 / Microsoft To Do
 * 三者都只提供 stdio 服务，浏览器需用 supergateway 起一个本地 SSE 端口。
 */
export interface McpPresetField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  hint?: string;
}

export interface McpPreset {
  id: string;
  name: string;
  desc: string;
  repo: string;
  port: number;
  /** supergateway --stdio 的原始命令 */
  stdio: string;
  /** 首次使用需要先执行的命令（可选） */
  prelude?: string;
  fields: McpPresetField[];
  notes: string[];
  accent: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "maimemo",
    name: "墨墨背单词",
    desc: "查单词、词本、释义、助记、例句",
    repo: "A11Might/mcp-server-maimemo",
    port: 8791,
    stdio: "mcp-server-maimemo",
    prelude: "go install github.com/A11Might/mcp-server-maimemo@latest",
    fields: [
      {
        key: "MAIMEMO_TOKEN",
        label: "开放 API Token",
        secret: true,
        placeholder: "墨墨 App → 我的 → 更多设置 → 实验功能 → 开放 API",
      },
    ],
    notes: [
      "需要安装 Go，并先执行一次 go install",
      "提供 get_vocabulary / list_notepads / list_notes 等 18 个工具",
    ],
    accent: "text-amber-600 dark:text-amber-400",
  },
  {
    id: "weread",
    name: "微信读书",
    desc: "书架、笔记划线、热门书评",
    repo: "freestylefly/mcp-server-weread",
    port: 8792,
    stdio: "npx -y mcp-server-weread",
    fields: [
      {
        key: "WEREAD_COOKIE",
        label: "微信读书 Cookie",
        secret: true,
        placeholder: "weread.qq.com 登录后从请求头复制 Cookie",
        hint: "如需自动续期，也可在启动命令里追加 CC_URL / CC_ID / CC_PASSWORD（CookieCloud）",
      },
    ],
    notes: [
      "提供 get_bookshelf / search_books / get_book_notes_and_highlights / get_book_best_reviews",
      "Cookie 过期后需要重新获取",
    ],
    accent: "text-sky-600 dark:text-sky-400",
  },
  {
    id: "todo",
    name: "Microsoft To Do",
    desc: "任务、清单、子步骤、我的一天",
    repo: "hechen-coder/microsoft-todo-mcp",
    port: 8793,
    stdio: "npx -y github:hechen-coder/microsoft-todo-mcp",
    prelude: "npx -y github:hechen-coder/microsoft-todo-mcp login",
    fields: [
      {
        key: "TODO_TIMEZONE",
        label: "时区（可选）",
        placeholder: "Asia/Shanghai",
      },
      {
        key: "TODO_READONLY",
        label: "只读模式（可选）",
        placeholder: "1 = 只开放查询工具",
      },
    ],
    notes: [
      "首次使用先跑 login 完成微软设备码授权",
      "提供 list_tasks / add_task / complete_task / get_today_tasks 等工具",
    ],
    accent: "text-indigo-600 dark:text-indigo-400",
  },
];

export function mcpPreset(id?: string): McpPreset | undefined {
  return id ? MCP_PRESETS.find((p) => p.id === id) : undefined;
}

/** 生成可直接粘贴到终端的本地桥接命令（含环境变量与 CORS） */
export function buildStartCommand(
  preset: McpPreset,
  env: Record<string, string> = {},
): string {
  const pairs = preset.fields
    .filter((f) => (env[f.key] || "").trim())
    .map((f) => `${f.key}='${env[f.key].replace(/'/g, "'\\''")}'`);
  const bridge =
    `npx -y supergateway --stdio "${preset.stdio}" ` +
    `--port ${preset.port} --baseUrl http://localhost:${preset.port} ` +
    `--ssePath /sse --messagePath /message --cors`;
  const lines: string[] = [];
  if (preset.prelude) {
    lines.push("# 首次使用先执行（已完成可跳过）", preset.prelude, "");
  }
  lines.push("# 启动本地桥接（保持窗口开着）");
  lines.push(`${pairs.join(" ")}${pairs.length ? " " : ""}${bridge}`.trim());
  return lines.join("\n");
}

export function presetDefaultUrl(preset: McpPreset): string {
  return `http://localhost:${preset.port}/sse`;
}
