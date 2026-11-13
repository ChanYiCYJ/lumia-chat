/**
 * 插件工厂（forge）——「AI 自己写插件」
 * ------------------------------------------------------------------
 * 不执行模型生成的任意代码（无 eval / new Function，符合 CSP），而是让模型输出
 * **声明式 JSON**：工具由若干「步骤」串成，核心用解释器执行。
 *
 * 支持的步骤（op）：
 *   http.get  { url, save? }            GET 一个 https 接口（禁止内网地址）
 *   http.post { url, body?, save? }     POST（body 是模板字符串）
 *   kv.get    { key, save? }            读插件私有存储
 *   kv.set    { key, value, save? }     写插件私有存储
 *   kv.list   { prefix?, save? }        列出键值
 *   kv.delete { key, save? }            删除键
 *   text      { template, save? }       纯模板输出
 *
 * 模板：`{{args.city}}` / `{{保存名}}`（对象自动 JSON 化），`output` 决定回给用户的文本。
 * 生成后的工具名 = `u_<插件id>_<工具名>`，模型下一轮即可直接调用（持久化在 localStorage）。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidateRegistry } from "./index";
import { fail, ok } from "./shared";
import type { ToolUi } from "./types";

export const FORGE_KEY = "kimo_ai_forge_plugins_v1";
const KV_KEY = "kimo_ai_forge_kv_v1";
const MAX_PLUGINS = 20;
const MAX_TOOLS = 8;
const MAX_STEPS = 16;
const MAX_PARAMS = 12;
const MAX_RESULT = 6000;
const HTTP_TIMEOUT_MS = 15_000;

const SLUG_RE = /^[a-z][a-z0-9_]{1,23}$/;
const PARAM_TYPES = ["string", "number", "boolean"] as const;

export type ForgeParamType = (typeof PARAM_TYPES)[number];

export interface ForgeParam {
  type: ForgeParamType;
  description?: string;
  required?: boolean;
}

export type ForgeStep =
  | { op: "http.get"; url: string; save?: string }
  | { op: "http.post"; url: string; body?: string; save?: string }
  | { op: "json.get"; from: string; path: string; save?: string }
  | { op: "kv.get"; key: string; save?: string }
  | { op: "kv.set"; key: string; value: string; save?: string }
  | { op: "kv.list"; prefix?: string; save?: string }
  | { op: "kv.delete"; key: string; save?: string }
  | { op: "text"; template: string; save?: string };

export interface ForgeToolSpec {
  name: string;
  label?: string;
  description: string;
  params?: Record<string, ForgeParam>;
  steps: ForgeStep[];
  /** 结果模板；不填则用最后一步的结果 */
  output?: string;
}

export interface ForgePluginSpec {
  id: string;
  name: string;
  description?: string;
  priority?: number;
  tools: ForgeToolSpec[];
}

// ---------------- 存储 ----------------

export function listForgeSpecs(): ForgePluginSpec[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FORGE_KEY) || "[]");
    return Array.isArray(raw) ? (raw as ForgePluginSpec[]) : [];
  } catch {
    return [];
  }
}

function writeSpecs(specs: ForgePluginSpec[]): void {
  localStorage.setItem(FORGE_KEY, JSON.stringify(specs));
  invalidateRegistry();
}

/** 删除一个自建插件（面板/设置页用；返回是否真的删了） */
export function removeForgeSpec(id: string): boolean {
  const specs = listForgeSpecs();
  const next = specs.filter((s) => s.id !== id);
  if (next.length === specs.length) return false;
  writeSpecs(next);
  return true;
}

type KvStore = Record<string, Record<string, unknown>>;

function readKv(): KvStore {
  try {
    const raw = JSON.parse(localStorage.getItem(KV_KEY) || "{}");
    return raw && typeof raw === "object" ? (raw as KvStore) : {};
  } catch {
    return {};
  }
}

function writeKv(store: KvStore): void {
  localStorage.setItem(KV_KEY, JSON.stringify(store));
}

// ---------------- 校验 ----------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function needString(v: unknown, field: string, max = 500): string {
  if (typeof v !== "string" || !v.trim())
    throw new Error(`${field} 必须是非空字符串`);
  if (v.length > max) throw new Error(`${field} 太长（≤${max} 字符）`);
  return v.trim();
}

function parseStep(raw: unknown, i: number): ForgeStep {
  const at = `steps[${i}]`;
  if (!isObj(raw)) throw new Error(`${at} 必须是对象`);
  const op = raw.op;
  const save =
    raw.save == null ? undefined : needString(raw.save, `${at}.save`, 32);
  switch (op) {
    case "http.get":
      return { op, url: needString(raw.url, `${at}.url`, 1000), save };
    case "http.post":
      return {
        op,
        url: needString(raw.url, `${at}.url`, 1000),
        body:
          raw.body == null
            ? undefined
            : needString(raw.body, `${at}.body`, 8000),
        save,
      };
    case "json.get":
      return {
        op,
        from: needString(raw.from, `${at}.from`, 64),
        path: needString(raw.path, `${at}.path`, 200),
        save,
      };
    case "kv.get":
      return { op, key: needString(raw.key, `${at}.key`, 200), save };
    case "kv.set":
      return {
        op,
        key: needString(raw.key, `${at}.key`, 200),
        value: needString(raw.value, `${at}.value`, 8000),
        save,
      };
    case "kv.list":
      return {
        op,
        prefix:
          raw.prefix == null
            ? undefined
            : needString(raw.prefix, `${at}.prefix`, 200),
        save,
      };
    case "kv.delete":
      return { op, key: needString(raw.key, `${at}.key`, 200), save };
    case "text":
      return {
        op,
        template: needString(raw.template, `${at}.template`, 8000),
        save,
      };
    default:
      throw new Error(
        `${at}.op 不支持：${String(op)}（可用 http.get / http.post / json.get / kv.get / kv.set / kv.list / kv.delete / text）`,
      );
  }
}

function parseTool(raw: unknown, i: number): ForgeToolSpec {
  const at = `tools[${i}]`;
  if (!isObj(raw)) throw new Error(`${at} 必须是对象`);
  const name = needString(raw.name, `${at}.name`, 24);
  if (!SLUG_RE.test(name))
    throw new Error(`${at}.name 需为小写字母开头的 slug（a-z0-9_，2~24 位）`);
  const description = needString(raw.description, `${at}.description`, 300);

  const params: Record<string, ForgeParam> = {};
  if (raw.params != null) {
    if (!isObj(raw.params)) throw new Error(`${at}.params 必须是对象`);
    const keys = Object.keys(raw.params);
    if (keys.length > MAX_PARAMS)
      throw new Error(`${at}.params 最多 ${MAX_PARAMS} 个`);
    for (const key of keys) {
      const p = raw.params[key];
      if (!isObj(p)) throw new Error(`${at}.params.${key} 必须是对象`);
      const type = p.type as ForgeParamType;
      if (!PARAM_TYPES.includes(type))
        throw new Error(
          `${at}.params.${key}.type 只能是 string / number / boolean`,
        );
      params[key] = {
        type,
        description:
          typeof p.description === "string"
            ? p.description.slice(0, 200)
            : undefined,
        required: p.required === true,
      };
    }
  }

  if (!Array.isArray(raw.steps) || !raw.steps.length)
    throw new Error(`${at}.steps 不能为空`);
  if (raw.steps.length > MAX_STEPS)
    throw new Error(`${at}.steps 最多 ${MAX_STEPS} 步`);
  const steps = raw.steps.map(parseStep);

  return {
    name,
    label: typeof raw.label === "string" ? raw.label.slice(0, 20) : undefined,
    description,
    params: Object.keys(params).length ? params : undefined,
    steps,
    output:
      raw.output == null
        ? undefined
        : needString(raw.output, `${at}.output`, 8000),
  };
}

/** 校验并解析模型给出的 JSON 规格（错误信息会回给模型，便于自我修正） */
export function parseForgeSpec(json: string): ForgePluginSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`spec 不是合法 JSON：${(e as Error).message}`);
  }
  if (!isObj(raw)) throw new Error("spec 必须是 JSON 对象");
  const id = needString(raw.id, "id", 24);
  if (!SLUG_RE.test(id))
    throw new Error("id 需为小写字母开头的 slug（a-z0-9_，2~24 位）");
  const name = needString(raw.name, "name", 40);
  if (!Array.isArray(raw.tools) || !raw.tools.length)
    throw new Error("tools 不能为空");
  if (raw.tools.length > MAX_TOOLS)
    throw new Error(`一个插件最多 ${MAX_TOOLS} 个工具`);
  const tools = raw.tools.map(parseTool);
  const names = new Set<string>();
  for (const t of tools) {
    if (names.has(t.name)) throw new Error(`工具名重复：${t.name}`);
    names.add(t.name);
  }
  return {
    id,
    name,
    description:
      typeof raw.description === "string"
        ? raw.description.slice(0, 300)
        : undefined,
    priority: typeof raw.priority === "number" ? raw.priority : 90,
    tools,
  };
}

// ---------------- 执行（解释器） ----------------

function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`url 不合法：${raw}`);
  }
  if (url.protocol !== "https:")
    throw new Error("只允许 https:// 地址（不支持 http/file）");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host);
  if (blocked) throw new Error(`不允许访问内网地址：${host}`);
  return url;
}

/** 模板渲染：{{args.x}} / {{保存名}} / {{a.b.c}}；对象/数组自动 JSON 化 */
export function renderTemplate(
  tpl: string,
  vars: Record<string, unknown>,
): string {
  return tpl.replace(/\{\{\s*([\w$.[\]]+)\s*\}\}/g, (_m, expr: string) => {
    const path = expr
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter(Boolean);
    let cur: unknown = vars;
    for (const key of path) {
      if (cur == null) return "";
      cur = (cur as Record<string, unknown>)[key];
    }
    if (cur == null) return "";
    if (typeof cur === "string") return cur;
    if (typeof cur === "number" || typeof cur === "boolean") return String(cur);
    try {
      return JSON.stringify(cur);
    } catch {
      return String(cur);
    }
  });
}

/** 尝试把 JSON 文本解析为对象（失败保留原文） */
function parseMaybeJson(text: string): unknown {
  const t = text.trim();
  if (!/^[\[{]/.test(t) && !/^-?\d/.test(t) && !/^(true|false|null)$/.test(t))
    return text;
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

/** 按 a.b[0].c 路径取值 */
function getPath(obj: unknown, path: string): unknown {
  if (path === "" || path === ".") return obj;
  const keys = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

async function httpFetch(url: string, init?: RequestInit): Promise<string> {
  const safe = assertSafeUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(safe.href, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
    return text.slice(0, MAX_RESULT);
  } finally {
    clearTimeout(timer);
  }
}

async function runTool(
  spec: ForgePluginSpec,
  tool: ForgeToolSpec,
  args: Record<string, unknown>,
): Promise<string> {
  const vars: Record<string, unknown> = { args };
  let last: unknown = "";
  const kv = readKv();
  const ns = (kv[spec.id] = kv[spec.id] || {});
  let kvDirty = false;

  for (let i = 0; i < tool.steps.length; i += 1) {
    const step = tool.steps[i];
    const slot = step.save || `step${i + 1}`;
    try {
      switch (step.op) {
        case "http.get":
          last = parseMaybeJson(
            await httpFetch(renderTemplate(step.url, vars)),
          );
          break;
        case "http.post": {
          const body = step.body ? renderTemplate(step.body, vars) : "";
          const isJson = /^[\[{]/.test(body.trim());
          last = parseMaybeJson(
            await httpFetch(renderTemplate(step.url, vars), {
              method: "POST",
              body: body || undefined,
              headers: isJson
                ? { "Content-Type": "application/json" }
                : undefined,
            }),
          );
          break;
        }
        case "json.get": {
          const src = vars[renderTemplate(step.from, vars)];
          const obj = typeof src === "string" ? parseMaybeJson(src) : src;
          last = getPath(obj, renderTemplate(step.path, vars)) ?? "";
          break;
        }
        case "kv.get":
          last = ns[renderTemplate(step.key, vars)] ?? "";
          break;
        case "kv.set":
          ns[renderTemplate(step.key, vars)] = renderTemplate(step.value, vars);
          kvDirty = true;
          last = "ok";
          break;
        case "kv.delete":
          delete ns[renderTemplate(step.key, vars)];
          kvDirty = true;
          last = "ok";
          break;
        case "kv.list": {
          const prefix = step.prefix ? renderTemplate(step.prefix, vars) : "";
          last = Object.entries(ns)
            .filter(([k]) => !prefix || k.startsWith(prefix))
            .map(([key, value]) => ({ key, value }));
          break;
        }
        case "text":
          last = renderTemplate(step.template, vars);
          break;
        default:
          throw new Error("未知步骤");
      }
    } catch (e) {
      throw new Error(
        `第 ${i + 1} 步（${step.op}）失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    vars[slot] = last;
  }
  if (kvDirty) writeKv(kv);
  const text = tool.output
    ? renderTemplate(tool.output, vars)
    : typeof last === "string"
      ? last
      : JSON.stringify(last);
  return String(text).slice(0, MAX_RESULT) || "（无输出）";
}

/** 生成工具名：u_<插件id>_<工具名> */
export function forgeToolName(specId: string, toolName: string): string {
  return `u_${specId}_${toolName}`;
}

function buildGeneratedTool(
  spec: ForgePluginSpec,
  tool: ForgeToolSpec,
): AgentTool {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, p] of Object.entries(tool.params || {})) {
    properties[key] = {
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
    };
    if (p.required) required.push(key);
  }
  return {
    name: forgeToolName(spec.id, tool.name),
    label: tool.label || tool.name,
    description: `${tool.description}（AI 自建插件「${spec.name}」）`,
    parameters: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    execute: async (_id, raw) => {
      const args = isObj(raw) ? raw : {};
      for (const [key, p] of Object.entries(tool.params || {})) {
        if (!p.required) continue;
        const v = args[key];
        if (v == null || (typeof v === "string" && !v.trim()))
          throw new Error(`缺少参数 ${key}（${p.type}）`);
      }
      // 每次执行都从存储取最新规格（用户/AI 改了立刻生效）
      const latest = listForgeSpecs().find((s) => s.id === spec.id) || spec;
      const freshest = latest.tools.find((t) => t.name === tool.name) || tool;
      const text = await runTool(latest, freshest, args);
      return ok(text, { plugin: spec.id, tool: tool.name });
    },
  };
}

/** 所有工具（元工具 + 已创建插件生成的工具） */
export function buildForgeTools(): AgentTool[] {
  const specs = listForgeSpecs();
  const meta: AgentTool[] = [
    {
      name: "plugin_forge_create",
      label: "创建插件",
      description:
        "创建/覆盖一个持久插件（声明式 JSON，不写代码就获得新工具）。用于「以后都能用」「每天帮我查」「记住…」这类可重复能力。创建后新工具名为 u_<id>_<工具名>，下一轮即可调用。",
      parameters: {
        type: "object",
        properties: {
          spec: {
            type: "string",
            description:
              '插件 JSON 字符串。结构：{"id":"weather","name":"天气","tools":[{"name":"query","description":"查天气","params":{"city":{"type":"string","required":true}},"steps":[{"op":"http.get","url":"https://api.example.com/?city={{args.city}}","save":"raw"}],"output":"{{raw}}"}]}',
          },
        },
        required: ["spec"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const specText = String((raw as { spec?: string }).spec || "");
        if (!specText.trim()) fail("spec 不能为空");
        const spec = parseForgeSpec(specText);
        const specs = listForgeSpecs();
        const idx = specs.findIndex((s) => s.id === spec.id);
        if (idx < 0 && specs.length >= MAX_PLUGINS)
          fail(`最多 ${MAX_PLUGINS} 个自建插件，请先删除不用的`);
        if (idx >= 0) specs[idx] = spec;
        else specs.push(spec);
        writeSpecs(specs);
        const names = spec.tools.map((t) => forgeToolName(spec.id, t.name));
        return ok(
          `${idx >= 0 ? "已更新" : "已创建"}插件「${spec.name}」（${spec.id}），新工具：${names.join("、")}。现在可以直接调用它们。\n可在 Agent 面板 → 插件 → 自定义插件中点开「${spec.name}」查看使用说明。`,
          { id: spec.id, tools: names },
        );
      },
    },
    {
      name: "plugin_forge_list",
      label: "查看自建插件",
      description: "列出自建插件及其工具（含存储中的规格摘要）。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        if (!specs.length) return ok("还没有自建插件。");
        return ok(
          specs
            .map(
              (s) =>
                `- ${s.name}（${s.id}）：${s.tools
                  .map(
                    (t) => `${forgeToolName(s.id, t.name)} — ${t.description}`,
                  )
                  .join("；")}`,
            )
            .join("\n"),
          { count: specs.length },
        );
      },
    },
    {
      name: "plugin_forge_get",
      label: "读取插件规格",
      description: "读取某个自建插件的完整 JSON 规格（用于修改前查看）。",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "插件 id" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const id = String((raw as { id?: string }).id || "").trim();
        const spec = specs.find((s) => s.id === id);
        if (!spec) fail(`没有自建插件：${id}`);
        return ok(JSON.stringify(spec, null, 2), { id });
      },
    },
    {
      name: "plugin_forge_delete",
      label: "删除插件",
      description:
        "删除某个自建插件（其工具立即消失）。仅在用户明确要求时调用。",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "插件 id" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (_id, raw) => {
        const id = String((raw as { id?: string }).id || "").trim();
        const specs = listForgeSpecs();
        const next = specs.filter((s) => s.id !== id);
        if (next.length === specs.length) fail(`没有自建插件：${id}`);
        writeSpecs(next);
        return ok(`已删除自建插件：${id}`, { id });
      },
    },
  ];

  const generated = specs.flatMap((spec) =>
    spec.tools.map((tool) => buildGeneratedTool(spec, tool)),
  );
  return [...meta, ...generated];
}

/** 该自建工具是否包含网络步骤（用于联网 / Fast 模式守卫） */
export function forgeNeedsWeb(toolName: string): boolean {
  if (!toolName.startsWith("u_")) return false;
  for (const spec of listForgeSpecs()) {
    for (const tool of spec.tools) {
      if (forgeToolName(spec.id, tool.name) === toolName)
        return tool.steps.some(
          (s) => s.op === "http.get" || s.op === "http.post",
        );
    }
  }
  return false;
}

/** 自建工具的工具卡 UI：卡片显示所属插件名 */
export function forgeUiFor(toolName: string): ToolUi | undefined {
  if (!toolName.startsWith("u_")) return undefined;
  for (const spec of listForgeSpecs()) {
    for (const tool of spec.tools) {
      if (forgeToolName(spec.id, tool.name) === toolName)
        return { type: spec.name, tab: "artifacts" };
    }
  }
  return undefined;
}

/** 自建插件清单（给提示词用，避免模型重复创建） */
export function forgeSummary(): string {
  const specs = listForgeSpecs();
  if (!specs.length) return "";
  return specs
    .map(
      (s) =>
        `- ${s.name}（${s.id}）：${s.tools.map((t) => forgeToolName(s.id, t.name)).join("、")}`,
    )
    .join("\n");
}

const OP_LABEL: Record<string, string> = {
  "http.get": "GET 请求",
  "http.post": "POST 请求",
  "json.get": "JSON 取值",
  "kv.get": "读存储",
  "kv.set": "写存储",
  "kv.list": "列出存储",
  "kv.delete": "删除存储项",
  text: "模板输出",
};

/** 生成用户可读的插件「说明书」（面板里点击插件时展示） */
export function pluginReadme(spec: ForgePluginSpec): string {
  const lines: string[] = [];
  lines.push(`# ${spec.name}（${spec.id}）`);
  if (spec.description) lines.push("", spec.description);
  lines.push("", "## 工具", "");
  for (const tool of spec.tools) {
    lines.push(
      `### ${forgeToolName(spec.id, tool.name)} — ${tool.label || tool.name}`,
    );
    lines.push(tool.description);
    const params = Object.entries(tool.params || {});
    if (params.length) {
      lines.push(
        "参数：" +
          params
            .map(
              ([k, p]) =>
                `${k}(${p.type}${p.required ? "，必填" : ""})${p.description ? `：${p.description}` : ""}`,
            )
            .join("；"),
      );
    } else {
      lines.push("参数：无");
    }
    lines.push("步骤：");
    tool.steps.forEach((step, i) => {
      const detail =
        step.op === "http.get" || step.op === "http.post"
          ? step.url
          : step.op === "text"
            ? step.template
            : step.op === "json.get"
              ? `{{${step.from}}} → ${step.path}`
              : step.op === "kv.set"
                ? `${step.key} = ${step.value}`
                : step.op === "kv.list"
                  ? step.prefix || "(全部)"
                  : "key" in step
                    ? step.key
                    : "";
      lines.push(`  ${i + 1}. ${OP_LABEL[step.op] || step.op}：${detail}`);
    });
    if (tool.output) lines.push(`输出模板：${tool.output}`);
    lines.push("");
  }
  lines.push(
    "## 怎么用",
    "",
    `- 直接对我说需求即可，我会自动调用上面的工具（例如：「用 ${spec.name} 帮我查一下…」）。`,
    "- 数据存在插件自己的私有存储里（`kimo_ai_forge_kv_v1` → 本插件 id），不会污染知识库。",
    "",
    "## 怎么改 / 删",
    "",
    "- 修改：告诉我「把插件 " +
      spec.id +
      " 的……改成……」，我会用 `plugin_forge_create` 覆盖同 id 规格。",
    "- 删除：Agent 面板 → 插件 → 自定义插件 → 删除（工具会立即从我的工具列表消失）。",
    "",
    "## 限制",
    "",
    "- 只支持 https 接口，禁止访问内网地址；单次请求 15s 超时，结果最多 6k 字符。",
    "- 不执行任意代码（声明式步骤解释器），所以只能做 http / kv / 文本模板这几类事。",
  );
  return lines.join("\n");
}
