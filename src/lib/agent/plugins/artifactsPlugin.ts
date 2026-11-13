/**
 * 产物插件：本会话产物的增删改查与打开（文章/文档/搜索/网页/知识/图片/笔记）
 */
import type { AgentPlugin } from "./types";
import {
  artifactKindLabel,
  artifactUrl,
  findArtifact,
  formatArtifactsBrief,
  listArtifacts,
  removeArtifact,
} from "../../artifacts";
import type { ArtifactKind } from "../../artifacts";
import { fail, ok, saveArtifact } from "./shared";

const plugin: AgentPlugin = {
  id: "artifacts",
  name: "产物管理",
  priority: 25,

  ui: {
    list_artifacts: { type: "产物", tab: "artifacts" },
    read_artifact: { type: "产物", tab: "artifacts" },
    write_artifact: { type: "产物", tab: "artifacts" },
    open_artifact: { type: "产物", tab: "artifacts" },
    delete_artifact: { type: "产物", tab: "artifacts" },
  },

  tools: (ctx) => [
    {
      name: "list_artifacts",
      label: "列出产物",
      description:
        "列出本会话已有的产物（文章/文档/搜索/知识条/图片/笔记）。需要引用或修改已有内容时先调用。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const list = listArtifacts(ctx.pageId, ctx.sessionId);
        if (!list.length) return ok("本会话还没有任何产物。");
        return ok(formatArtifactsBrief(list), { count: list.length });
      },
    },
    {
      name: "read_artifact",
      label: "读取产物",
      description: "读取本会话某个产物的正文（按 id 或标题匹配）。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "产物 id（list_artifacts 返回）" },
          title: { type: "string", description: "产物标题（模糊匹配）" },
        },
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { id?: string; title?: string };
        const list = listArtifacts(ctx.pageId, ctx.sessionId);
        const target = params.id
          ? findArtifact(ctx.pageId, ctx.sessionId, params.id)
          : list.find((a) =>
              (a.title || "")
                .toLowerCase()
                .includes((params.title || "").toLowerCase()),
            );
        if (!target) fail("没有找到对应的产物");
        const link = artifactUrl(target);
        return ok(
          `【${artifactKindLabel(target.kind)}】${target.title}${link ? `\n链接：${link}` : ""}\n\n${target.content.slice(0, 8000)}`,
          { id: target.id, kind: target.kind, url: link || undefined },
        );
      },
    },
    {
      name: "write_artifact",
      label: "写入产物",
      description:
        "新增或更新本会话产物（长文、方案、笔记、代码等）。title 相同或 id 相同会更新而不是新建。",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["article", "doc", "search", "web", "kb", "image", "note"],
            description: "产物类型，默认 note",
          },
          title: { type: "string", description: "产物标题" },
          content: { type: "string", description: "完整内容（Markdown）" },
          topic: { type: "string", description: "可选主题（用于去重）" },
          id: { type: "string", description: "可选，指定则更新该产物" },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as {
          kind?: ArtifactKind;
          title?: string;
          content?: string;
          topic?: string;
          id?: string;
        };
        const title = (params.title || "").trim();
        const content = params.content || "";
        if (!title || !content.trim()) fail("title 和 content 都不能为空");
        const artifact = saveArtifact(ctx, {
          kind: params.kind || "note",
          title,
          content,
          topic: params.topic,
          id: params.id,
        });
        ctx.openPanel?.("artifacts", artifact.id);
        return ok(
          `已写入产物《${title}》（id: ${artifact.id}，${content.length} 字）`,
          { id: artifact.id },
        );
      },
    },
    {
      name: "open_artifact",
      label: "打开产物",
      description: "在界面的产物面板中打开某个产物（也可打开 View/文章）。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "产物 id" },
          kind: {
            type: "string",
            enum: ["article", "doc", "search", "web", "kb", "image", "note"],
            description: "不传 id 时按类型打开最近一条",
          },
        },
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { id?: string; kind?: ArtifactKind };
        const list = listArtifacts(ctx.pageId, ctx.sessionId);
        const target = params.id
          ? findArtifact(ctx.pageId, ctx.sessionId, params.id)
          : list.find((a) => !params.kind || a.kind === params.kind);
        if (!target) fail("没有可打开的产物");
        ctx.openPanel?.("artifacts", target.id);
        return ok(`已打开产物《${target.title}》`, { id: target.id });
      },
    },
    {
      name: "delete_artifact",
      label: "删除产物",
      description: "按 id 或标题删除本会话产物。仅在用户明确要求删除时调用。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "产物 id" },
          title: { type: "string", description: "产物标题（模糊匹配）" },
        },
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const params = raw as { id?: string; title?: string };
        const list = listArtifacts(ctx.pageId, ctx.sessionId);
        const t = (params.title || "").trim().toLowerCase();
        const target = params.id
          ? findArtifact(ctx.pageId, ctx.sessionId, params.id)
          : list.find((a) => (a.title || "").toLowerCase().includes(t));
        if (!target) fail("没有找到要删除的产物");
        removeArtifact(ctx.pageId, ctx.sessionId, target.id);
        ctx.onArtifactRemoved?.(target.id);
        return ok(`已删除产物《${target.title}》`, { id: target.id });
      },
    },
  ],
};

export default plugin;
