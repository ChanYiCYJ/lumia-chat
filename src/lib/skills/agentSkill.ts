import type { SkillContext, SkillSection } from "./util";
import { pluginToolsPrompt } from "../agent/plugins";

/**
 * 原生工具调用段（核心指令段，保留）：仅在 pi-agent-core Agent 模式下注入。
 * 与旧的 [TAG:] 通道共存：工具优先，文本标记不再要求；表情标签仍然保留。
 *
 * 各功能的「工具使用说明」由插件自己提供（agent/plugins/*Plugin.ts 的 promptLines），
 * 这里只保留与具体功能无关的通用规则 —— 新增功能不需要再动本文件。
 */
export function agentToolsSection(ctx: SkillContext): SkillSection {
  if (!ctx.agentNative) return { id: "agentTools", text: "" };
  const toolLines = pluginToolsPrompt(ctx);
  return {
    id: "agentTools",
    text: `\n\n【原生工具（优先使用）】你现在可以直接调用工具完成任务，工具调用比文本标记更可靠：
${toolLines}- 不要在回复正文里输出 [SEARCH:] / [BROWSE:] / [VIEW:] / [EDIT:] / [KB-SAVE:] 这类文本标记，直接调用对应工具即可。
- 调用工具前先用一两句话向用户说明你要做什么；一次只调用一个工具。
- 工具失败时（例如未联网/未连接 Notion）如实告知用户原因，不要编造结果。
- 只调用与用户当前请求相关的工具，不要为了“多做事”而堆砌工具调用。
- 【界面控制】用户要“打开/看一下”某个面板时：调用 open_panel（tab=artifacts / kb / edit / live2d）；删除产物调用 delete_artifact（id 或标题）。
- 【主动推进】能直接做的事就直接做（搜索/读页/生成文章/整理笔记），不要反复向用户确认“要不要我……”。
- 【结果卡片化】长文、清单、资料整理用 write_artifact / generate_article 存入产物，对话正文只给摘要与关键结论；UI 会把产物、来源、工具结果自动渲染成卡片。
- 【收尾】任务完成后用一句话给出最值得做的下一步（例如“要不要我把这篇精简成要点”），不要泛泛地问“还需要什么”。`,
  };
}

/**
 * 产物段（可压缩段）：把本会话已有产物清单注入，减少重复生成与全文注入。
 */
export function artifactsSection(ctx: SkillContext): SkillSection {
  const brief = (ctx.artifactsBrief || "").trim();
  if (!ctx.agentNative || !brief) return { id: "artifacts", text: "" };
  return {
    id: "artifacts",
    text:
      `\n\n【本会话产物清单】以下内容已经生成并保存在产物面板中（用户可直接阅读）：\n${brief}\n` +
      `规则：① 需要引用/修改已有内容时，先调用 read_artifact（id 或标题）；② 修改后用 write_artifact 以相同 id 或标题写回，不要新建重复产物；③ 长篇内容（方案、文档、代码、清单）优先用 write_artifact 存为产物，对话正文只给要点，避免刷屏；④ 用户要“看/打开”某个产物时调用 open_artifact；⑤ 网页产物可直接调用 open_webpage 重新抓取并展示，产物面板支持「阅读/原网页」切换。`,
  };
}
