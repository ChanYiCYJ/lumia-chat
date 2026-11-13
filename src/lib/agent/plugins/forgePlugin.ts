/**
 * 插件工厂插件：把「AI 自写插件」暴露给模型（plugin_forge_* 元工具 + 动态生成的工具）
 * 引擎与 DSL 见 `./forge.ts`；此处只做协议包装（prompt / ui / 排序）。
 */
import type { AgentPlugin } from "./types";
import {
  buildForgeTools,
  forgeNeedsWeb,
  forgeSummary,
  forgeUiFor,
} from "./forge";

const plugin: AgentPlugin = {
  id: "forge",
  name: "插件工厂",
  priority: 95,

  ui: {
    plugin_forge_create: { type: "插件" },
    plugin_forge_list: { type: "插件" },
    plugin_forge_get: { type: "插件" },
    plugin_forge_delete: { type: "插件" },
  },

  /** 自建插件生成的工具（u_*）也走同一套工具卡，卡片显示插件名 */
  resolveUi: forgeUiFor,

  /** 含 http 步骤的自建工具按「联网能力」处理：Fast 模式 / 未联网时拒绝 */
  guard: (ctx, toolName) => {
    if (!toolName || !forgeNeedsWeb(toolName)) return undefined;
    if (!ctx.webEnabled)
      return "该自建插件要访问网络：当前会话未开启联网搜索。";
    if (ctx.mode === "fast")
      return "该自建插件要访问网络：Fast 模式不允许联网，请切换到智能/深度模式。";
    return undefined;
  },

  tools: () => buildForgeTools(),

  promptLines: () => {
    const existing = forgeSummary();
    return `- 【自我扩展 / 自建插件】用户提出「以后都能用 / 每天帮我查 / 帮我调某个接口」这类可重复需求，或现有工具不够用时：用 plugin_forge_create 创建持久插件（声明式 JSON，不写代码、不执行任意代码）。
  · 步骤 op：http.get / http.post（仅 https）、json.get（按 a.b[0].c 取值）、kv.get / kv.set / kv.list / kv.delete（插件私有存储）、text。
  · 模板：{{args.参数名}}、{{保存名}}、{{保存名.data.list[0].name}}（HTTP 返回 JSON 会自动解析）；tool.output 决定回给用户的文本（不填=最后一步结果）。
  · 新工具名为 u_<插件id>_<工具名>，创建成功后下一轮自动出现在工具列表，可直接调用。
  · 创建前先 plugin_forge_list / plugin_forge_get 看有没有同类插件（能改就别新建）；删除用 plugin_forge_delete。
  · 只做用户真正需要的能力，不要为了"多做事"批量造插件。${
    existing
      ? `\n  当前自建插件：\n${existing
          .split("\n")
          .map((l) => "  " + l)
          .join("\n")}`
      : ""
  }
`;
  },
};

export default plugin;
