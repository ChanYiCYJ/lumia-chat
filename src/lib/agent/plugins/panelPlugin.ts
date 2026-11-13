/**
 * 面板控制插件：让模型能切换 Agent 面板页签（产物 / 知识库 / 编辑器 / 角色）
 */
import type { AgentPlugin } from "./types";
import { findArtifact } from "../../artifacts";
import { fail, ok } from "./shared";

const plugin: AgentPlugin = {
  id: "panel",
  name: "界面控制",
  priority: 20,

  ui: {
    open_panel: { type: "面板", tab: "artifacts" },
  },

  tools: (ctx) => [
    {
      name: "open_panel",
      label: "打开面板",
      description:
        "打开 Agent 面板的指定页面：artifacts=产物、kb=知识库、edit=编辑器、live2d=角色。用户要“看一下/打开某个面板”时使用。",
      parameters: {
        type: "object",
        properties: {
          tab: {
            type: "string",
            enum: ["artifacts", "kb", "edit", "live2d"],
            description: "要打开的面板",
          },
          artifact_id: {
            type: "string",
            description: "可选：打开产物并定位到该 id",
          },
        },
        required: ["tab"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as {
          tab?: "artifacts" | "kb" | "edit" | "live2d";
          artifact_id?: string;
        };
        const tab = params.tab;
        if (!tab) fail("tab 不能为空");
        if (tab === "artifacts" && params.artifact_id) {
          const target = findArtifact(
            ctx.pageId,
            ctx.sessionId,
            params.artifact_id,
          );
          if (!target) fail("没有找到要打开的产物");
        }
        ctx.openPanel?.(tab, params.artifact_id, true);
        return ok(`已打开面板：${tab}`);
      },
    },
  ],
};

export default plugin;
