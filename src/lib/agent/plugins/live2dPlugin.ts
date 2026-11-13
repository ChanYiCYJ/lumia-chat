/**
 * Live2D 插件：让看板娘做动作/换表情。
 * 同时贡献旧 [TAG:] 通道的清洗正则（表情/动作标记不进正文）。
 */
import type { AgentPlugin } from "./types";
import { applyActionCommands } from "../../live2dCore";
import { fail, ok } from "./shared";

const plugin: AgentPlugin = {
  id: "live2d",
  name: "Live2D 角色",
  priority: 45,

  ui: {
    live2d_perform: { type: "动作" },
  },

  promptLines: () =>
    `- 让 Live2D 角色做动作：调用 live2d_perform（commands）。语法：EMOTION:开心（推荐，走统一情绪预设）/ 情绪:难过 / MOTION:smile01 / EXPRESSION:xxx / PARAM:ParamAngleZ:0.3 / LOOK:left，多个用空格分隔。
- 在情绪节点（安慰、祝贺、卖关子、惊讶）主动调用一次，不要每句话都调（會抽搯）。
`,

  tagPatterns: [
    // 表情标签 [表情:开心] / 【表情:别扭】 / [EMOTION:开心]
    /[\[【]\s*(?:表情|EMOTION)\s*[:：]\s*[^\]】]*?[\]】]/gi,
    // 动作指令 [PARAM:ParamX:0.8] / [MOTION:smile01] / [EXPRESSION:xxx]
    /[\[【]\s*(?:PARAM|参数|MOTION|动作|EXPRESSION|表情预设)\s*[:：]\s*[^\]】\n]{1,60}?[\]】]/gi,
  ],

  tools: () => [
    {
      name: "live2d_perform",
      label: "角色动作",
      description:
        "让 Live2D 看板娘做动作/换表情。语法：EMOTION:开心 / 情绪:难过 / MOTION:动作名 / EXPRESSION:表情名 / PARAM:参数:值 / LOOK:x:y，多个用空格或分号分隔。推荐用 EMOTION（统一情绪预设，效果最稳）。",
      parameters: {
        type: "object",
        properties: {
          commands: {
            type: "string",
            description: "指令串，例如：MOTION:smile01 EXPRESSION:开心",
          },
        },
        required: ["commands"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { commands?: string };
        const commands = (params.commands || "").trim();
        if (!commands) fail("commands 不能为空");
        // 静态导入：live2dCore 已被 AIChat/舞台组件静态引用，动态导入不会单独分包
        applyActionCommands(commands);
        return ok(`已执行角色动作：${commands}`);
      },
    },
  ],
};

export default plugin;
