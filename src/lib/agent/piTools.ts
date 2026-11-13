/**
 * 兼容门面（facade）
 * ------------------------------------------------------------------
 * 工具的真正实现已拆进 `plugins/` 目录（一个功能一个插件文件，自动发现）。
 * 这里只保留原有导出名，避免旧的 import 路径失效；新代码建议直接
 * 从 `./plugins` 引入（或使用 registry 的统一 API）。
 *
 * 设计原则（沿用）：
 * - 工具只做「数据操作」，UI 副作用通过 ctx 回调交给 AIChat
 * - 失败一律 throw（pi 会转成 isError 的 tool 结果给模型重试）
 * - 每个工具都带守卫：能开关/配置缺失时直接拒绝，避免模型反复重试
 * - 与旧的 `[TAG:]` 通道并存：同一能力两套通道共用底层函数
 */
export {
  createAgentTools,
  guardTool,
  invalidateRegistry,
  isWebTool,
  listPlugins,
  pluginSystemSections,
  pluginTagPatterns,
  pluginToolsPrompt,
  registerPlugin,
  toolUi,
  unregisterPlugin,
} from "./plugins";
export type { AgentPlugin, ToolContext, ToolUi } from "./plugins";
