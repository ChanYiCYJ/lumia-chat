import {
  useState,
  useEffect,
  useRef,
  lazy,
  Suspense,
  Component,
  type ReactNode,
} from "react";
import { fetchWebpage, searchWithCache } from "../lib/search";
import { loadSearchSpeed, loadSearchDepth } from "../lib/chatSettings";
import { useToast } from "../lib/toast";
import { SettingsTab, type AgentSettingsProps } from "./SettingsTab";
import { Live2DStage } from "./Live2DStage";
import {
  loadKbEntries,
  writeKbEntries,
  downloadText,
  deriveEntryTitle,
  reorderKbEntries,
  type KbEntryRecord,
} from "../lib/kb";
import {
  loadKbStoreMode,
  saveKbEntrySmart,
  queueKbSync,
  deleteKbEntrySmart,
  restoreKbSnapshot,
  hasKbSnapshot,
  resolveKbStore,
  subscribeKbSync,
  autoBackfillLocalToNotion,
  pullNotionPagesToKb,
  migrateLocalKbToRoot,
  moveKbEntry,
  type KbSyncStatus,
} from "../lib/kbStore";
import { hasNotionCfg } from "../lib/notion";
import { ConfirmDialog } from "./ConfirmDialog";
import { KbInsightPanel } from "./KbInsightPanel";
import { NotionIcon } from "./ui";
import { KbPageTree } from "./KbPageTree";
import { ArtifactList } from "./ArtifactList";
import { ArtifactDetail } from "./ArtifactDetail";
import type { Artifact } from "../lib/artifacts";
import type { BrowseArtifactInput } from "../lib/artifacts";

// Notion 式块编辑器（懒加载：仅打开 KB 编辑 tab 时才拉取 BlockNote chunk，控制首屏体积）
const KbBlockEditor = lazy(() =>
  import("./KbBlockEditor").then((m) => ({ default: m.KbBlockEditor })),
);

/**
 * 编辑器错误边界：BlockNote 异常时降级为纯文本输入，避免整个 Agent 面板崩溃。
 * 只降级编辑区，其余知识库功能（列表/同步/迁移）仍可用。
 */
class KbEditorBoundary extends Component<
  {
    fallbackValue: string;
    onFallbackChange: (v: string) => void;
    children: ReactNode;
  },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <textarea
          className="min-h-0 w-full flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none"
          value={this.props.fallbackValue}
          onChange={(e) => this.props.onFallbackChange(e.target.value)}
          placeholder="编辑器异常，已降级为纯文本编辑"
        />
      );
    }
    return this.props.children;
  }
}

// ===== Types =====
/** 知识条目类型统一取自 lib/kb（避免本地重复定义） */
type KbEntry = KbEntryRecord;

/** 网页产物的展示标题：正文首行有效文本，失败回落到域名 */
function deriveWebTitle(text: string, url: string): string {
  const first = text
    .split("\n")
    .map((s) => s.trim())
    .find(
      (s) =>
        s.length >= 2 &&
        s.length <= 80 &&
        !/^https?:\/\//i.test(s) &&
        !/^[#>*\-\s]+$/.test(s),
    );
  if (first) return first.slice(0, 80);
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** Agent 面板 tab 记忆（刷新后恢复上次所在 tab，如停留在 Live2D 刷新不会跳回知识库） */
const AGENT_TAB_KEY = (pageId: number) => `kimo_ai_agent_tab_${pageId}`;
/** View 已合并进「产物」：web 仅作为历史持久值/入参保留，统一映射到 artifacts */
const AGENT_TABS = ["artifacts", "kb", "edit", "settings", "live2d"] as const;
type AgentTab = (typeof AGENT_TABS)[number];
function normalizeTab(t?: string | null): AgentTab | null {
  if (t === "web") return "artifacts";
  return t && (AGENT_TABS as readonly string[]).includes(t)
    ? (t as AgentTab)
    : null;
}
function loadAgentTab(pageId: number): AgentTab | null {
  try {
    return normalizeTab(localStorage.getItem(AGENT_TAB_KEY(pageId)));
  } catch {}
  return null;
}
function saveAgentTab(pageId: number, tab: AgentTab): void {
  try {
    localStorage.setItem(AGENT_TAB_KEY(pageId), tab);
  } catch {}
}

export function AgentPanel({
  initUrl,
  initTab,
  initEditContent,
  lastAssistantContent,
  pageId,
  onKbChanged,
  settings,
  kbOpen,
  onKbOpenConsumed,
  searchNonce,
  live2dOn,
  onTabChange,
  allowWebAutoDetect,
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  onDeleteArtifact,
  onBrowseArtifact,
  onAsk,
  fullscreen,
}: {
  onClose: () => void;
  initUrl?: string;
  /** 兼容旧入参：web 已合并进 artifacts */
  initTab?: "artifacts" | "web" | "kb" | "edit" | "settings" | "live2d";
  initEditContent?: string;
  lastAssistantContent?: string;
  pageId: number;
  onKbChanged?: () => void;
  settings?: AgentSettingsProps;
  /** Live2D 开关（由 AIChat「/」弹窗控制；开启才显示 Live2D tab） */
  live2dOn?: boolean;
  kbOpen?: {
    nonce: number;
    entry: { id: string; name: string; content: string; createdAt: number };
  };
  onKbOpenConsumed?: () => void;
  /** 卡片点击后递增，用于强制重新触发浏览 */
  searchNonce?: number;
  /** tab 变化通知（AIChat 同步 agentTab，配合持久化让刷新后回到上次所在页） */
  onTabChange?: (t: AgentTab) => void;
  /** 浏览 tab 自动检测（AI 回复含 URL 时自动切到 View）——仅 Deep 模式开启；auto/fast 不自动跳转 View */
  allowWebAutoDetect?: boolean;
  /** 本会话产物（由 AIChat 统一持有） */
  artifacts?: Artifact[];
  activeArtifactId?: string;
  onSelectArtifact?: (id: string) => void;
  onDeleteArtifact?: (id: string) => void;
  /** 浏览完成（文章生成 / 网页抓取）→ 交给 AIChat 落库为产物并选中 */
  onBrowseArtifact?: (input: BrowseArtifactInput) => void;
  /** 产物详情里的「让 AI 续优化」→ 发回聊天 */
  onAsk?: (text: string) => void;
  /** 全屏：占满主区域（知识库/设置作为独立页面时），隐藏页签栏与外边距 */
  fullscreen?: boolean;
}) {
  // tab 记忆：优先 AI 工具调用指定的 tab；否则恢复上次所在 tab（刷新不丢，如停留 Live2D）；否则默认知识库
  const [tab, setTab] = useState<AgentTab>(
    () =>
      normalizeTab(initTab) ||
      (initUrl ? "artifacts" : loadAgentTab(pageId) || "live2d"),
  );
  // 每次切 tab 都持久化 + 通知 AIChat 同步 agentTab（刷新后回到上次所在页，含 Live2D）
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  useEffect(() => {
    saveAgentTab(pageId, tab);
    onTabChangeRef.current?.(tab);
  }, [tab, pageId]);
  const [webUrl, setWebUrl] = useState(initUrl || "");
  const [webLoading, setWebLoading] = useState(false);
  // 这些值仅用于浏览流程内部记录（活动卡已移除），保留 setter 以兼容现有逻辑
  const [, setWebContent] = useState("");
  const [, setWebError] = useState("");
  /** 记录当前正在执行的浏览关键词，防止陈旧轮询覆盖新浏览 */
  const activeBrowseRef = useRef("");
  const [, setArticleMd] = useState("");
  const [articleLoading, setArticleLoading] = useState(false);
  const [, setArticleSources] = useState<{ title: string; url: string }[]>([]);
  /** 同一来源重复落库去重（浏览轮询会多次拿回同一篇文章） */
  const emittedRef = useRef("");
  /** 本次结果是否来自历史缓存 */
  const [, setFromCache] = useState(false);
  const [mdContent, setMdContent] = useState(initEditContent || "");
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();

  // KB
  const [entries, setEntries] = useState<KbEntry[]>(loadKbEntries);
  /** 页面树本地搜索词（头部就地输入；关闭即清空） */
  const [entrySearch, setEntrySearch] = useState("");
  /** 头部搜索框展开态 */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 产物：列表 / 详情切换（窄面板下比上下堆叠更好用） */
  const [artifactOpen, setArtifactOpen] = useState(false);
  /** 外部（聊天里的「在 Agent 中打开」）指定产物时，直接进入详情 */
  useEffect(() => {
    if (activeArtifactId) setArtifactOpen(true);
  }, [activeArtifactId]);
  /** 头部 ⋯ 菜单（迁移到 Notion / 撤销 / 导入导出） */
  const [kbMenuOpen, setKbMenuOpen] = useState(false);
  const kbMenuRef = useRef<HTMLDivElement>(null);
  /** 数据操作保护：友好确认弹窗状态（替代 window.confirm） */
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: string;
    danger?: boolean;
    confirmText?: string;
    onConfirm: () => void;
  } | null>(null);
  const [draftWordCount, setDraftWordCount] = useState(0);
  const [draftSaved, setDraftSaved] = useState(true);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftContentRef = useRef("");
  const draftKey = "kimo_editor_draft";

  // 恢复草稿 + beforeunload 防丢失
  useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey);
      if (d && !mdContent) setMdContent(d);
    } catch {}
    const onBefore = () => {
      try {
        if (draftContentRef.current.trim())
          localStorage.setItem(draftKey, draftContentRef.current);
      } catch {}
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  // 同步 mdContent 到 ref（避免 beforeunload 重复注册）
  useEffect(() => {
    draftContentRef.current = mdContent;
  }, [mdContent]);

  // 自动保存草稿（1.5s 防抖）
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setDraftSaved(false);
    setDraftWordCount(mdContent.replace(/\s/g, "").length);
    draftTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, mdContent);
      } catch {}
      setDraftSaved(true);
    }, 1500);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [mdContent]);
  const [activeEntry, setActiveEntry] = useState<KbEntry | null>(null);
  /** 正在拖拽移动的条目 id（树内显示 loading） */
  const [movingId, setMovingId] = useState<string | null>(null);
  /** 新建条目的父页面（子页面）：在编辑器头部选择，留空=顶层页面 */
  const [draftParentId, setDraftParentId] = useState<string>("");
  /** Notion 同步状态（头部「同步中…/已连接」） */
  const [syncStatus, setSyncStatus] = useState<KbSyncStatus>({
    state: "idle",
  });

  /** 父页面折叠状态（子页面树展开/收起） */
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());
  const toggleCollapsePage = (id: string) => {
    setCollapsedPages((prev) => {
      const nx = new Set(prev);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });
  };

  // Auto-detect（仅在面板已挂载后、lastAssistantContent 变化时触发；跳过首挂载，避免刷新恢复时覆盖用户所在 tab，如 Live2D 刷新后跳到编辑器）
  // 只对「AI 给了网页链接」自动切到浏览页；代码块不再自动切编辑器——编辑器只由明确的 [EDIT:] 指令打开（AIChat 通过 initEditContent/initTab 控制），避免 AI 普通回复带代码块就把用户从 Live2D 等 tab 切走
  const autoDetectFirst = useRef(true);
  useEffect(() => {
    if (autoDetectFirst.current) {
      autoDetectFirst.current = false;
      return;
    }
    if (!lastAssistantContent) return;
    if (!allowWebAutoDetect) return;
    const u = lastAssistantContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
    if (u) {
      setWebUrl(u[0]);
      setTab("artifacts");
    }
  }, [lastAssistantContent, allowWebAutoDetect]);

  // 响应 AI 工具调用：切换 tab / 填入编辑内容（面板已挂载时也生效）
  useEffect(() => {
    const t = normalizeTab(initTab);
    if (t) setTab(t);
    if (initEditContent != null) {
      setMdContent(initEditContent);
      setActiveEntry(null);
    }
  }, [initTab, initEditContent]);

  // AI 创建/编辑知识库：AIChat 已通过 kb.ts 写入存储，这里仅展示到编辑器并刷新列表
  useEffect(() => {
    if (!kbOpen) return;
    setEntries(loadKbEntries());
    const { entry } = kbOpen;
    if (entry && (entry.name.trim() || entry.content.trim())) {
      setActiveEntry({
        id: entry.id,
        name: entry.name,
        content: entry.content,
        createdAt: entry.createdAt,
      });
      setMdContent(entry.content);
      setTab("edit");
    }
    onKbOpenConsumed?.();
  }, [kbOpen]);

  // Notion 自动同步：订阅同步状态（头部「同步中…/已连接」）+ 后台回填后刷新网格
  useEffect(() => subscribeKbSync(setSyncStatus), []);
  useEffect(() => {
    const onEntriesChanged = () => {
      const list = loadKbEntries();
      setEntries(list);
      // 同步回填的 notionId/meta 到当前编辑条目（避免后续同步快照仍是「无 notionId」旧状态）
      setActiveEntry((cur) => {
        if (!cur) return cur;
        const fresh = list.find((x) => x.id === cur.id);
        return fresh ? { ...cur, ...fresh } : cur;
      });
    };
    window.addEventListener("kimo:kb:entries-changed", onEntriesChanged);
    return () =>
      window.removeEventListener("kimo:kb:entries-changed", onEntriesChanged);
  }, []);
  // 打开知识库 tab：自动拉取 Notion 页面为卡片（防抖 + 后台不阻塞）+ 首次自动回填本地未同步条目
  const backfillOnce = useRef(false);
  useEffect(() => {
    if (tab !== "kb" || !hasNotionCfg()) return;
    const t = setTimeout(() => {
      void pullNotionPagesToKb().finally(() => {
        setEntries(loadKbEntries());
      });
      if (!backfillOnce.current) {
        backfillOnce.current = true;
        autoBackfillLocalToNotion();
      }
    }, 800);
    return () => clearTimeout(t);
  }, [tab]);

  // 关闭头部 ⋯ 菜单（点击外部）
  useEffect(() => {
    if (!kbMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (kbMenuRef.current && !kbMenuRef.current.contains(e.target as Node))
        setKbMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [kbMenuOpen]);

  // ---- Drag: document-level ----
  const dc = useRef(0);
  useEffect(() => {
    const onE = (e: DragEvent) => {
      e.preventDefault();
      dc.current++;
      if (dc.current === 1) setDragOver(true);
    };
    const onO = (e: DragEvent) => {
      e.preventDefault();
    };
    const onL = () => {
      dc.current--;
      if (dc.current <= 0) {
        dc.current = 0;
        setDragOver(false);
      }
    };
    const onD = (e: DragEvent) => {
      e.preventDefault();
      dc.current = 0;
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        setMdContent((p) => (p ? p + "\n\n" : "") + String(r.result || ""));
        setTab("edit");
      };
      r.readAsText(f);
    };
    document.addEventListener("dragenter", onE);
    document.addEventListener("dragover", onO);
    document.addEventListener("dragleave", onL);
    document.addEventListener("drop", onD);
    return () => {
      document.removeEventListener("dragenter", onE);
      document.removeEventListener("dragover", onO);
      document.removeEventListener("dragleave", onL);
      document.removeEventListener("drop", onD);
    };
  }, []);

  // ---- Entry CRUD ----
  // 新建条目：内容非空时创建（「存为知识」按钮已由自动保存取代）
  const createEntryFromContent = (
    content: string,
    parentId?: string,
  ): KbEntry => {
    const trimmed = content.trim();
    const parent = parentId
      ? entries.find((e) => e.id === parentId)
      : undefined;
    const e: KbEntry = {
      id: "e_" + Date.now(),
      name: deriveEntryTitle(trimmed), // 无独立标题框：H1 优先，否则首行前 30 字
      content: trimmed,
      createdAt: Date.now(),
      // 子页面：继承父的层级（父已同步 → notionParentId 关联 Notion；否则 parentId 本地关联）
      ...(parent?.notionId
        ? {
            notionParentId: parent.notionId,
            notionParentName: parent.name,
            notionRootId: parent.notionRootId || parent.notionId,
            notionRootName: parent.notionRootName || parent.name,
          }
        : parent
          ? { parentId: parent.id }
          : {}),
    };
    setEntries((prev) => {
      const nx = [e, ...prev];
      writeKbEntries(nx);
      return nx;
    });
    onKbChanged?.();
    // 配置 Notion 时入队后台同步到云端（防抖合并 + 串行化，不阻塞编辑）
    queueKbSync(e);
    return e;
  };
  // 新条目自动保存：内容非空且尚未创建时，防抖 1.2s 自动创建为知识条目
  useEffect(() => {
    if (activeEntry || !mdContent.trim()) return;
    const t = setTimeout(() => {
      // 内容与已有条目完全一致时（如刷新后恢复草稿），只打开不重复创建
      const trimmed = mdContent.trim();
      const existing = entries.find((e) => e.content === trimmed);
      if (existing) {
        setActiveEntry(existing);
        return;
      }
      const e = createEntryFromContent(mdContent, draftParentId || undefined);
      setActiveEntry(e);
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mdContent, activeEntry]);
  // ---- 页面树条目 ----
  /** 已连接 Notion：树只显示 Notion 页面；未连接：显示本机页面（本地也是页面树） */
  const treeEntries = (
    hasNotionCfg() ? entries.filter((e) => e.notionId) : entries
  ).filter(
    (entry) =>
      !entrySearch.trim() ||
      entry.name.toLowerCase().includes(entrySearch.toLowerCase()) ||
      entry.content.toLowerCase().includes(entrySearch.toLowerCase()),
  );
  /** 本机未同步条数（已连接时显示在 Notion 胶囊 + 迁移入口） */
  const localUnsyncedCount = entries.filter((e) => !e.notionId).length;
  /** 已同步到 Notion 的条数（头部胶囊 N/M） */
  const syncedCount = entries.length - localUnsyncedCount;
  /** 撤销：恢复最近一次写操作前的快照 */
  const handleUndo = () => {
    const restored = restoreKbSnapshot();
    if (!restored) {
      toast("没有可撤销的记录");
      return;
    }
    setEntries(restored);
    onKbChanged?.();
    toast("已恢复最近版本");
  };
  /** 一键迁移：本机未同步条目 → Notion「知识库」根页面（页面根目录下） */
  const [migrating, setMigrating] = useState(false);
  const handleMigrateToRoot = async () => {
    if (migrating) return;
    setMigrating(true);
    const res = await migrateLocalKbToRoot();
    setMigrating(false);
    setEntries(loadKbEntries());
    if (res.errors.length) {
      toast(
        res.created > 0
          ? `已迁移 ${res.created} 条，${res.errors.length} 条失败`
          : `迁移失败：${res.errors[0]}`,
      );
    } else if (res.created > 0) {
      toast(`已迁移 ${res.created} 条到「知识库」根页面`);
    } else {
      toast(res.total === 0 ? "没有需要迁移的条目" : "条目均已同步到知识库");
    }
  };
  const updateEntry = (content: string) => {
    if (!activeEntry) return;
    // 标题：手动重命名（titleLocked）后不再随正文推导；否则 H1 变化 → 标题变化 → 同步 Notion
    const name = activeEntry.titleLocked
      ? activeEntry.name
      : deriveEntryTitle(content, activeEntry.name);
    const u = { ...activeEntry, content, name };
    setActiveEntry(u);
    setEntries((prev) => {
      const nx = prev.map((e) => (e.id === activeEntry.id ? u : e));
      writeKbEntries(nx);
      return nx;
    });
    onKbChanged?.();
    // 配置 Notion 时入队后台同步更新云端（镜像覆盖，不阻塞编辑）
    queueKbSync(u);
  };
  // ---- 页面树：打开 / 重命名 / 删除 / 重排 / 移动 ----
  /** 点击树行 → 打开该页编辑 */
  const openEntryFromTree = (entry: KbEntry) => {
    setActiveEntry(entry);
    setMdContent("");
    setTab("edit");
  };
  /** 重命名：锁定标题（titleLocked）并同步 Notion 页面标题 */
  const handleRename = (id: string, name: string) => {
    const t = name.trim();
    if (!t) return;
    const nx = entries.map((e) =>
      e.id === id ? { ...e, name: t, titleLocked: true } : e,
    );
    setEntries(nx);
    writeKbEntries(nx);
    onKbChanged?.();
    const u = nx.find((e) => e.id === id);
    if (u) queueKbSync(u);
  };
  /** 恢复自动标题：清除 titleLocked，标题回落到正文推导 */
  const handleRestoreAutoTitle = (id: string) => {
    const nx = entries.map((e) => {
      if (e.id !== id) return e;
      return {
        ...e,
        name: deriveEntryTitle(e.content, e.name),
        titleLocked: false,
      };
    });
    setEntries(nx);
    writeKbEntries(nx);
    onKbChanged?.();
    const u = nx.find((e) => e.id === id);
    if (u) queueKbSync(u);
  };
  /** 删除单个页面（本机 + Notion 双向） */
  const handleDeleteEntry = (entry: KbEntry) => {
    const willDeleteNotion = !!entry.notionId && resolveKbStore() === "notion";
    setConfirm({
      title: `删除「${entry.name}」？`,
      message: willDeleteNotion
        ? "该页面已同步到 Notion，将同时删除 Notion 页面（Notion 侧不可恢复）。"
        : "删除后可在「撤销」中恢复（本机保留最近快照）。",
      danger: true,
      confirmText: "删除",
      onConfirm: () => {
        setConfirm(null);
        void (async () => {
          await deleteKbEntrySmart({ id: entry.id });
          setEntries(loadKbEntries());
          if (activeEntry?.id === entry.id) {
            setActiveEntry(null);
            setMdContent("");
            setTab("kb");
          }
          onKbChanged?.();
          toast("已删除 1 条");
        })();
      },
    });
  };
  /** 同级重排（本地 order，不推 Notion——API 无法设置顺序） */
  const handleReorder = (parentKey: string, orderedIds: string[]) => {
    const nx = reorderKbEntries(entries, parentKey, orderedIds);
    setEntries(nx);
    writeKbEntries(nx);
    onKbChanged?.();
  };
  /** 改父移动：本地重排 + 已同步页面在 Notion「重建+删旧」 */
  const handleMove = async (id: string, parentId?: string) => {
    if (movingId) return;
    setMovingId(id);
    const res = await moveKbEntry({ id, newParentId: parentId });
    setMovingId(null);
    setEntries(loadKbEntries());
    if (res.error) toast(res.error);
    else toast(res.recreated ? "已移动（Notion 侧已重建页面）" : "已移动");
    onKbChanged?.();
  };
  // ---- 编辑器：清空 / 返回 ----
  const clearEditor = () => {
    const hasContent =
      (mdContent || "").trim() || (activeEntry?.content || "").trim();
    if (!hasContent) return;
    setConfirm({
      title: "清空当前编辑内容？",
      message: "清空后可在「撤销」中恢复（本机保留最近快照）。",
      danger: true,
      confirmText: "清空",
      onConfirm: () => {
        setConfirm(null);
        if (activeEntry) updateEntry("");
        else setMdContent("");
      },
    });
  };
  /** 返回知识库列表：尚未落库的新内容先自动保存为新条目 */
  const goBackToKb = () => {
    if (!activeEntry && mdContent.trim()) {
      const e = createEntryFromContent(mdContent, draftParentId || undefined);
      setActiveEntry(e);
    }
    setActiveEntry(null);
    setMdContent("");
    setDraftParentId("");
    setTab("kb");
  };
  /** 从某卡片「＋子页」打开新建子页编辑器（预选父条目） */
  const startNewChild = (parent: KbEntry) => {
    setDraftParentId(parent.id);
    setActiveEntry(null);
    setMdContent("");
    setTab("edit");
  };
  /** 底部 ＋：新建顶层页面（清空编辑器并进入 edit tab） */
  const startNewPage = () => {
    setActiveEntry(null);
    setMdContent("");
    setDraftParentId("");
    setTab("edit");
  };

  // ---- Export/Import ----
  /** 导出全部条目（页面树无多选） */
  const exportTarget = () => entries;
  const exportJSON = () => {
    const list = exportTarget();
    downloadText(
      "kb-" + new Date().toISOString().slice(0, 10) + ".json",
      JSON.stringify({ app: "kimo-kb", version: 1, entries: list }, null, 2),
    );
    setKbMenuOpen(false);
    toast(`已导出 ${list.length} 条（JSON）`);
  };
  const exportMD = () => {
    const list = exportTarget();
    downloadText(
      "kb-" + new Date().toISOString().slice(0, 10) + ".md",
      list
        .map((e) => "# " + e.name + "\n\n" + e.content + "\n\n---")
        .join("\n\n"),
    );
    setKbMenuOpen(false);
    toast(`已导出 ${list.length} 条（Markdown）`);
  };
  /** 导入 JSON（支持多文件选择） */
  const importJSON = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = ev.target.files ? Array.from(ev.target.files) : [];
    if (!files.length) return;
    const existing = new Set(entries.map((e) => e.id));
    const now = Date.now();
    const cleaned: KbEntry[] = [];
    let pending = files.length;
    files.forEach((f) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(String(r.result || ""));
          const arr: KbEntry[] = Array.isArray(d.entries)
            ? d.entries
            : Array.isArray(d)
              ? d
              : [];
          for (const raw of arr) {
            if (!raw || typeof raw !== "object") continue;
            const name = String(raw.name || "").trim();
            const content = String(raw.content || "").trim();
            if (!name && !content) continue;
            const createdAt =
              typeof raw.createdAt === "number"
                ? raw.createdAt
                : Date.parse(String(raw.createdAt || "")) || now;
            let id = String(raw.id ?? "").trim();
            if (!id || existing.has(id)) {
              id = `imp_${now}_${cleaned.length}_${Math.random()
                .toString(36)
                .slice(2, 7)}`;
            }
            existing.add(id);
            cleaned.push({ id, name: name || "未命名", content, createdAt });
          }
        } catch {
          /* 单文件解析失败则跳过 */
        }
      };
      r.onloadend = () => {
        pending--;
        if (pending > 0) return;
        ev.target.value = "";
        if (!cleaned.length) {
          toast("未找到有效条目");
          return;
        }
        const nx = [...cleaned, ...entries];
        setEntries(nx);
        writeKbEntries(nx);
        onKbChanged?.();
        toast(`已导入 ${cleaned.length} 条（JSON）`);
      };
      r.readAsText(f);
    });
  };
  /** 导入 Markdown（单文件：标题由正文推导——H1 优先，否则首行；空则用文件名） */
  const importMarkdown = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      ev.target.value = "";
      const content = String(r.result || "").trim();
      if (!content) {
        toast("文件为空");
        return;
      }
      const base = (
        f.name.replace(/\.(md|markdown|txt)$/i, "") || "未命名"
      ).trim();
      const entry: KbEntry = {
        id: "imp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        name: deriveEntryTitle(content, base || "未命名"),
        content,
        createdAt: Date.now(),
      };
      const nx = [entry, ...entries];
      setEntries(nx);
      writeKbEntries(nx);
      onKbChanged?.();
      toast("已导入 Markdown");
    };
    r.readAsText(f);
  };

  // ---- Browse（带历史缓存 + 增量展示：先出搜索结果，AI 文章就绪后原地补上）----
  // force=true 时强制刷新（绕过缓存重新搜索 + 生成，保证数据实时更新）
  const browse = async (q?: string, force = false) => {
    const u = (q ?? webUrl).trim();
    if (!u) return;
    activeBrowseRef.current = u;
    setWebContent("");
    setWebError("");
    setWebLoading(true);
    setArticleMd("");
    setArticleSources([]);
    setArticleLoading(false);
    emittedRef.current = "";
    /** 文章就绪 → 落库为产物（同一轮浏览内去重，避免轮询重复写入） */
    const emitArticle = (
      topic: string,
      article: string,
      srcs: { title?: string; url?: string }[],
    ) => {
      const text = (article || "").trim();
      if (!text) return;
      const key = `${topic}|${text.length}|${text.slice(0, 40)}`;
      if (emittedRef.current === key) return;
      emittedRef.current = key;
      const sources = (srcs || [])
        .filter((s) => !!s.url)
        .slice(0, 8)
        .map((s) => ({ title: s.title || s.url || "", url: s.url || "" }));
      onBrowseArtifact?.({
        kind: "article",
        title: topic,
        topic,
        content: text,
        sources,
      });
    };
    // 关键词搜索（复用缓存；生成中时轮询等待，保证「加载页不提前消失」）
    const runKeyword = async (kw: string, firstForce = false) => {
      setWebUrl(kw);
      // 按搜索速度/深度调整来源数与正文长度：Fast 精简、deep 加量
      const speed = loadSearchSpeed();
      const depth = loadSearchDepth();
      const maxSources = speed === "fast" ? 3 : depth === "deep" ? 6 : 4;
      const perSourceChars =
        speed === "fast" ? 1400 : depth === "deep" ? 2600 : 2200;
      const opts = { maxSources, perSourceChars };
      // 首次调用：firstForce 时绕过缓存强制生成；后续轮询读缓存（loading 标记防并发重复生成）
      let r = await searchWithCache(kw, { ...opts, force: firstForce });
      // 阶段1：等待拿到搜索结果内容（最多约 55s；期间保持加载页）
      if (r.loading && !r.content) {
        const deadline = Date.now() + 55_000;
        while (Date.now() < deadline && r.loading && !r.content) {
          await new Promise((res) => setTimeout(res, 700));
          if (activeBrowseRef.current !== kw) return;
          r = await searchWithCache(kw, opts);
        }
      }
      if (activeBrowseRef.current !== kw) return;
      // 阶段1 结束：能展示就立刻展示（含生成中的文章骨架），不再卡在加载页
      setFromCache(!!r.cached);
      if (r.content) {
        setWebContent(r.content);
        setArticleMd(r.article || "");
        setArticleLoading(r.loading || false);
        setArticleSources(
          (r.sources || [])
            .filter((s) => !!s.url)
            .map((s) => ({ title: s.title || s.url, url: s.url })),
        );
        if (r.article) emitArticle(kw, r.article, r.sources || []);
      } else if (r.loading) {
        // 仍无内容但还在生成：视为超时，给重试而非误导性的空态
        setWebError("搜索较慢，请稍后点击重试");
        setArticleLoading(false);
      } else {
        // 搜索完成但无结果：给出明确提示（区别于从未搜索过的空态）
        setWebContent("");
        setWebError("未找到相关结果，请换一个关键词试试");
        setArticleLoading(false);
      }
      // 阶段2：内容已展示、文章仍在生成 → 继续等文章，就绪后原地补上（不闪退加载态）
      if (r.content && r.loading) {
        const deadline = Date.now() + 90_000;
        let nr = r;
        while (Date.now() < deadline && nr.loading) {
          await new Promise((res) => setTimeout(res, 800));
          if (activeBrowseRef.current !== kw) return;
          nr = await searchWithCache(kw, opts);
        }
        if (activeBrowseRef.current !== kw) return;
        setArticleMd(nr.article || "");
        setArticleLoading(false);
        setArticleSources(
          (nr.sources || [])
            .filter((s) => !!s.url)
            .map((s) => ({ title: s.title || s.url, url: s.url })),
        );
        emitArticle(kw, nr.article || "", nr.sources || []);
        setWebError(nr.loading ? "文章生成较慢，可稍后重试" : "");
      }
    };
    try {
      if (/^https?:\/\//i.test(u)) {
        // 搜索引擎 URL（如 google/bing/duckduckgo）→ 提取 q 参数转关键词搜索
        const lower = u.toLowerCase();
        if (
          lower.includes("google.") ||
          lower.includes("bing.com") ||
          lower.includes("duckduckgo") ||
          lower.includes("baidu.com")
        ) {
          try {
            const qp = new URL(u).searchParams.get("q");
            if (qp) {
              await runKeyword(qp, force);
              return;
            }
          } catch {}
        }
        setWebUrl(u);
        const text = await fetchWebpage(u);
        if (activeBrowseRef.current !== u) return;
        if (text) {
          setWebContent(text);
          const title = deriveWebTitle(text, u);
          onBrowseArtifact?.({
            kind: "web",
            title,
            url: u,
            content: text,
            sources: [{ title, url: u }],
          });
        } else {
          // URL 抓取失败（如搜索引擎 CORS 拦截）时回退为关键词搜索
          let q2 = u;
          try {
            const url = new URL(u);
            const qp = url.searchParams.get("q");
            if (qp) q2 = qp;
            else q2 = url.hostname.replace(/^www\./i, "");
          } catch {
            q2 = u
              .replace(/^https?:\/\//i, "")
              .replace(/^www\./i, "")
              .replace(/\/.*$/, "");
          }
          await runKeyword(q2, force);
        }
      } else if (
        /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+\.?$/.test(u)
      ) {
        // 纯域名（不含空格）才按网址抓取，否则按关键词搜索
        const full = "https://" + u;
        setWebUrl(full);
        const text = await fetchWebpage(full);
        if (activeBrowseRef.current !== full) return;
        setWebContent(text || "");
        if (text) {
          const title = deriveWebTitle(text, full);
          onBrowseArtifact?.({
            kind: "web",
            title,
            url: full,
            content: text,
            sources: [{ title, url: full }],
          });
        } else setWebError("无法获取内容，请点击重试");
      } else {
        // 关键词搜索：抓取多个结果正文 + AI 综合文章，带历史缓存
        await runKeyword(u, force);
      }
    } catch {
      if (activeBrowseRef.current !== u) return;
      setWebContent("");
      setWebError("搜索失败，请稍后重试");
    } finally {
      if (activeBrowseRef.current === u) setWebLoading(false);
    }
  };

  // AI 触发搜索/浏览时自动执行（[SEARCH:] / [BROWSE:] / 卡片点击）
  useEffect(() => {
    if (initUrl) {
      setTab("artifacts");
      setWebUrl(initUrl);
      setWebContent("");
      browse(initUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initUrl, searchNonce]);

  /** 产物保存到知识库（标题由正文推导）；配置 Notion 时双写到云端 */
  const saveArtifactToKb = (artifact: Artifact) => {
    if (!artifact.content.trim()) return;
    void saveKbEntrySmart({
      title: deriveEntryTitle(artifact.content, artifact.title || "产物"),
      content: artifact.content,
      mode: loadKbStoreMode(),
    }).then((res) => {
      if (res.error) toast(res.error);
    });
    // 刷新本地条目列表，让保存的条目立刻出现在知识库
    setEntries(loadKbEntries());
    toast("已保存到知识库");
  };

  return (
    // 学习 Live2D 角色卡片的卡片样式：小外边距 + 大圆角 + 边框，让 Agent 面板整体浮起
    <div
      className={
        "relative flex min-w-0 flex-col overflow-hidden " +
        (fullscreen
          ? "h-full w-full bg-surface"
          : "m-2 h-[calc(100%-1rem)] rounded-card border border-line bg-surface")
      }
    >
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 pointer-events-none">
          <div className="rounded-card border border-line bg-surface p-6 text-center">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              释放文件到编辑器
            </p>
            <p className="mt-1 text-xs text-gray-400">.md / .txt</p>
          </div>
        </div>
      )}

      {/* Header：统一分段 tab（知识库/产物/Live2D/设置）；View 已合并进「产物」，不再单独占 tab */}
      <div
        className={
          "shrink-0 items-center gap-1 border-b border-gray-100 px-2 py-2 dark:border-gray-800 " +
          (fullscreen ? "hidden" : "flex")
        }
      >
        <div className="flex min-w-0 flex-1 gap-0.5 whitespace-nowrap rounded-control border border-line bg-sunken p-0.5">
          <button
            onClick={() => setTab("kb")}
            title="知识库"
            className={
              "hidden flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-1.5 py-1.5 text-xs font-medium transition sm:px-2 " +
              (tab === "kb"
                ? "bg-surface text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)] animate-[kpop_0.18s_ease-out] dark:shadow-none"
                : "text-fg-muted hover:text-fg")
            }
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
            <span className="hidden sm:inline">知识库</span>
          </button>
          {/* 产物：本会话生成的文章/文档/搜索/网页/知识条/图片/笔记（原 View 已合并到这里） */}
          <button
            onClick={() => setTab("artifacts")}
            title="产物（文章 / 搜索 / 网页 / 文档 / 知识条 / 图片 / 笔记）"
            className={
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-1.5 py-1.5 text-xs font-medium transition sm:px-2 " +
              (tab === "artifacts"
                ? "bg-surface text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)] animate-[kpop_0.18s_ease-out] dark:shadow-none"
                : "text-fg-muted hover:text-fg")
            }
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75A2.25 2.25 0 016 4.5h4.19a2.25 2.25 0 011.59.66l1.06 1.06a2.25 2.25 0 001.59.66H18a2.25 2.25 0 012.25 2.25v7.62A2.25 2.25 0 0118 18.75H6a2.25 2.25 0 01-2.25-2.25V6.75z"
              />
            </svg>
            <span className="hidden sm:inline">产物</span>
          </button>
          {/* Live2D tab 常显（不因开关隐藏）；未开启时由 Live2DStage 显示空态提示 */}
          <button
            onClick={() => setTab("live2d")}
            title="Live2D"
            className={
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-1.5 py-1.5 text-xs font-medium transition sm:px-2 " +
              (tab === "live2d"
                ? "bg-surface text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)] animate-[kpop_0.18s_ease-out] dark:shadow-none"
                : "text-fg-muted hover:text-fg")
            }
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21a9 9 0 100-18 9 9 0 000 18z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 10h.01M15 10h.01M9 14.5c.9.8 2.2 1.3 3 1.3s2.1-.5 3-1.3"
              />
            </svg>
            <span className="hidden sm:inline">Live2D</span>
          </button>
          {/* 设置 tab：并入统一分段，风格一致 */}
          <button
            onClick={() => setTab("settings")}
            title="设置"
            className={
              "hidden flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-1.5 py-1.5 text-xs font-medium transition sm:px-2 " +
              (tab === "settings"
                ? "bg-surface text-fg shadow-[0_1px_0_rgba(0,0,0,0.04)] animate-[kpop_0.18s_ease-out] dark:shadow-none"
                : "text-fg-muted hover:text-fg")
            }
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span className="hidden sm:inline">设置</span>
          </button>
        </div>
      </div>

      {/* tab 内容切换动画：key 变化触发淡入（不遮盖其它关闭路径） */}
      <div
        key={tab}
        className="flex min-h-0 flex-1 flex-col animate-[kfade_0.22s_ease-out]"
      >
        {/* TAB 1: 产物（原 View 的搜索/浏览/文章生成已合并到这里） */}
        {tab === "artifacts" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {(() => {
              const list = artifacts || [];
              const current =
                list.find((a) => a.id === activeArtifactId) || list[0];
              // 产物页保持极简：列表 + 详情（不重复渲染活动卡）
              const busyCurrent =
                !!current &&
                (webLoading || articleLoading) &&
                !!webUrl &&
                (current.topic === webUrl || current.title === webUrl);
              return (
                <>
                  {artifactOpen && current ? (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <ArtifactDetail
                        artifact={current}
                        busy={busyCurrent}
                        onBack={() => setArtifactOpen(false)}
                        onSaveToKb={() => saveArtifactToKb(current)}
                        onDelete={() => {
                          onDeleteArtifact?.(current.id);
                          setArtifactOpen(false);
                        }}
                        onAsk={onAsk}
                        onOpenKb={() => setTab("kb")}
                        onRegenerate={
                          current.kind === "article"
                            ? () => {
                                const q =
                                  current.topic || current.title || webUrl;
                                if (q) void browse(q, true);
                              }
                            : undefined
                        }
                      />
                    </div>
                  ) : (
                    <ArtifactList
                      items={list}
                      activeId={current?.id}
                      onSelect={(id) => {
                        onSelectArtifact?.(id);
                        setArtifactOpen(true);
                      }}
                      onDelete={(id) => onDeleteArtifact?.(id)}
                    />
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* TAB 2: Knowledge Base（紧凑头部 + 分类 tab + 条目网格） */}
        {tab === "kb" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 头部：单行工具条（搜索 / Notion 状态 / ⋯ 操作），不再常驻大字提示 */}
            <div className="flex flex-none items-center gap-1.5 px-2.5 pt-2.5">
              {searchOpen ? (
                <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-control border border-line bg-surface px-2">
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-fg-muted"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                  </svg>
                  <input
                    autoFocus
                    value={entrySearch}
                    onChange={(e) => setEntrySearch(e.target.value)}
                    placeholder="搜索页面…"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted"
                  />
                  <button
                    onClick={() => {
                      setEntrySearch("");
                      setSearchOpen(false);
                    }}
                    title="关闭搜索"
                    aria-label="关闭搜索"
                    className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full text-fg-muted transition hover:bg-sunken hover:text-fg"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  {hasNotionCfg() && (
                    <span
                      className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted"
                      title={
                        syncStatus.error ||
                        (localUnsyncedCount > 0
                          ? `本机 ${localUnsyncedCount} 条未同步，可在右侧 ⋯ 菜单迁移到 Notion`
                          : "知识库与 Notion 自动双向同步")
                      }
                    >
                      <NotionIcon className="h-3 w-3 shrink-0 text-fg-muted" />
                      <span className="truncate">
                        {syncStatus.state === "syncing"
                          ? "同步中…"
                          : syncStatus.error
                            ? "同步失败"
                            : `Notion · ${syncedCount}/${entries.length} 已同步`}
                      </span>
                    </span>
                  )}
                  <button
                    onClick={() => setSearchOpen(true)}
                    title="搜索页面"
                    aria-label="搜索页面"
                    className="ml-auto grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-control text-fg-muted transition hover:bg-sunken hover:text-fg"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                    </svg>
                  </button>
                </>
              )}
              {/* ⋯ 菜单：迁移到 Notion / 撤销 / 导入导出（原底部浮动面板里的操作全部上移） */}
              <div className="relative shrink-0" ref={kbMenuRef}>
                <button
                  onClick={() => setKbMenuOpen((v) => !v)}
                  title="更多操作"
                  aria-label="更多操作"
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-control text-fg-muted transition hover:bg-sunken hover:text-fg"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>
                {kbMenuOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-card border border-line bg-surface py-1">
                    {hasNotionCfg() && localUnsyncedCount > 0 && (
                      <button
                        onClick={() => {
                          setKbMenuOpen(false);
                          void handleMigrateToRoot();
                        }}
                        disabled={migrating}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted transition hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {migrating
                          ? "迁移中…"
                          : `迁移到知识库（${localUnsyncedCount}）`}
                      </button>
                    )}
                    {hasKbSnapshot() && (
                      <button
                        onClick={() => {
                          setKbMenuOpen(false);
                          handleUndo();
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
                      >
                        撤销
                      </button>
                    )}
                    <div className="my-1 border-t border-line" />
                    <button
                      onClick={exportJSON}
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
                    >
                      导出 JSON
                    </button>
                    <button
                      onClick={exportMD}
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
                    >
                      导出 Markdown
                    </button>
                    <div className="my-1 border-t border-line" />
                    <label
                      onClick={() => setKbMenuOpen(false)}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
                    >
                      导入 JSON
                      <input
                        type="file"
                        accept=".json"
                        multiple
                        onChange={importJSON}
                        className="hidden"
                      />
                    </label>
                    <label
                      onClick={() => setKbMenuOpen(false)}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg-muted transition hover:bg-sunken hover:text-fg"
                    >
                      导入 Markdown
                      <input
                        type="file"
                        accept=".md,.markdown,.txt"
                        onChange={importMarkdown}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
            {/* 两栏：页面树 + Obsidian 风格右栏（全屏 lg 以上） */}
            <div className="flex min-h-0 flex-1">
              <div className="relative flex min-h-0 flex-1 flex-col lg:border-r lg:border-line">
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5 pb-16">
                  <KbPageTree
                    entries={treeEntries}
                    activeId={activeEntry?.id}
                    collapsed={collapsedPages}
                    onToggleCollapse={toggleCollapsePage}
                    onOpen={openEntryFromTree}
                    onNewChild={startNewChild}
                    onRename={handleRename}
                    onRestoreAutoTitle={handleRestoreAutoTitle}
                    onDelete={handleDeleteEntry}
                    onReorder={handleReorder}
                    onMove={handleMove}
                    movingId={movingId}
                    empty={
                      entrySearch.trim()
                        ? "没有匹配的页面"
                        : hasNotionCfg()
                          ? "知识库还没有页面，点击下方 ＋ 新建"
                          : "暂无条目，点击下方 ＋ 新建"
                    }
                  />
                </div>
                {/* 底部：新建页面（单击直达编辑器；搜索/导入导出已上移到头部） */}
                <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
                  <button
                    onClick={startNewPage}
                    title="新建页面"
                    aria-label="新建页面"
                    className="pointer-events-auto grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg-muted transition hover:text-fg active:scale-95"
                  >
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>
              </div>
              <KbInsightPanel
                entries={entries}
                active={activeEntry || undefined}
                onOpen={(id) => {
                  const target = entries.find((x) => x.id === id);
                  if (target) openEntryFromTree(target);
                }}
                onTag={(tag) => {
                  setSearchOpen(true);
                  setEntrySearch(`#${tag}`);
                }}
                notionReady={hasNotionCfg()}
                syncedCount={syncedCount}
                unsyncedCount={localUnsyncedCount}
                syncing={syncStatus.state === "syncing"}
                onSync={() => void handleMigrateToRoot()}
                visible={!!fullscreen}
              />
            </div>
          </div>
        )}

        {/* TAB 3: Editor（自动保存 + 返回知识库；已删除草稿/存为知识按钮） */}
        {tab === "edit" && (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex flex-none items-center gap-2 border-b border-gray-50 px-2 py-1.5 dark:border-gray-800">
                <button
                  onClick={goBackToKb}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  title="返回知识库"
                  aria-label="返回知识库"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" d="M19 12H5m7-7l-7 7 7 7" />
                  </svg>
                </button>
                <span className="min-w-0 truncate text-xs font-medium text-gray-600 dark:text-gray-300">
                  {activeEntry ? activeEntry.name : "新建条目"}
                </span>
                {!activeEntry && mdContent.trim() && (
                  <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                    自动保存
                  </span>
                )}
              </div>
              {/* 新建条目：可选父页面（子页面；仅已同步 Notion 的页面可作为父） */}
              {!activeEntry && (
                <div className="flex flex-none items-center gap-1.5 border-b border-gray-50 px-2 py-1 dark:border-gray-800">
                  <span className="shrink-0 text-[10px] text-gray-400">
                    子页
                  </span>
                  <select
                    value={draftParentId}
                    onChange={(e) => setDraftParentId(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-600 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  >
                    <option value="">无（顶层页面）</option>
                    {entries.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <KbEditorBoundary
                fallbackValue={activeEntry ? activeEntry.content : mdContent}
                onFallbackChange={activeEntry ? updateEntry : setMdContent}
              >
                <Suspense
                  fallback={
                    <div className="grid flex-1 place-items-center text-[11px] text-gray-400">
                      编辑器加载中…
                    </div>
                  }
                >
                  {activeEntry ? (
                    <KbBlockEditor
                      key={activeEntry.id}
                      value={activeEntry.content}
                      onChange={updateEntry}
                      placeholder="在此输入内容…（首个 H1 或首行将作为标题）"
                    />
                  ) : (
                    <KbBlockEditor
                      key="new"
                      value={mdContent}
                      onChange={setMdContent}
                      placeholder="在此输入内容…（首个 H1 或首行将作为标题）"
                    />
                  )}
                </Suspense>
              </KbEditorBoundary>
              <div className="flex flex-none items-center justify-between gap-2 border-t border-gray-100 px-3 py-1.5 dark:border-gray-800">
                <span className="min-w-0 truncate">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white px-2.5 py-1 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                    {mdContent ? `${draftWordCount} 字` : "Markdown"}
                    {draftSaved ? (
                      <span className="flex items-center gap-0.5 font-medium text-green-600 dark:text-green-400">
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        已保存
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 font-medium text-amber-500 dark:text-amber-400">
                        <svg
                          className="h-3 w-3 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                          />
                        </svg>
                        保存中
                      </span>
                    )}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  {/* 清空 */}
                  <button
                    onClick={clearEditor}
                    className="grid h-7 w-7 place-items-center rounded-lg text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    title="清空"
                    aria-label="清空"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <KbInsightPanel
              entries={entries}
              active={activeEntry || undefined}
              onOpen={(id) => {
                const target = entries.find((x) => x.id === id);
                if (target) openEntryFromTree(target);
              }}
              notionReady={hasNotionCfg()}
              syncedCount={syncedCount}
              unsyncedCount={localUnsyncedCount}
              syncing={syncStatus.state === "syncing"}
              onSync={() => void handleMigrateToRoot()}
              visible={!!fullscreen}
            />
          </div>
        )}

        {/* TAB: Live2D（AI 化身；未开启时显示空态提示） */}
        {tab === "live2d" && <Live2DStage enabled={live2dOn} />}

        {/* TAB 4: Settings（用户设置迁入 Agent 面板） */}
        {tab === "settings" &&
          (settings ? (
            <SettingsTab {...settings} />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-xs text-gray-400">
              设置暂不可用
            </div>
          ))}
      </div>

      {/* 数据操作保护：友好确认弹窗 */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ""}
        message={confirm?.message}
        danger={confirm?.danger}
        confirmText={confirm?.confirmText}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm()}
      />
    </div>
  );
}
