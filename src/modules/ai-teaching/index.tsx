import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, X, Send, Loader2, Bot, FileText, Wrench, Plus, Trash2, BookOpen, Compass, CalendarClock, Gauge, PenLine, Presentation, ChevronLeft, ChevronRight, ChevronDown, Feather, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ArrowLeft, ExternalLink, Folder, Search } from 'lucide-react'
import {
  agentSessions, agentNewSession, agentMessages, agentDeleteSession,
  agentChat, agentAbort, onAgentStep, llmGetUsage, getSettingRaw, agentSetSessionInstructions, llmListProviders, llmReasoningCapable,
  workspaceGetCurrent, workspaceListDir, workspaceReadFile, docsPptxPages,
  agentRenameSession, aiTeachEnsureSessionFolder, aiTeachSessionFolder, aiTeachRenameSessionFolder, aiTeachDeleteSessionFolder, aiTeachReadConstraints, aiTeachWriteConstraints, aiTeachOrganizeDoc, onAiTeachNotice,
  aiTeachListWorkspaces, aiTeachCreateWorkspace, aiTeachRenameWorkspace, aiTeachDeleteWorkspace, aiTeachAssignSession, aiTeachSetLastWorkspace,
  aiTeachSrcRead, aiTeachSrcAdd, aiTeachSrcRemove, aiTeachSrcExtract, aiTeachSrcPick,
} from '../../lib/ipc'
import { AiTeachFileTree } from './AiTeachFileTree'
import { QuizMode } from '../../components/shared/QuizMode'
import { extractQuizzes } from '../../components/shared/QuizParser'
import { showToast } from '../../lib/toast'
import { showGlobalConfirm } from '../../lib/globalConfirm'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'
import type { AgentSessionInfo, AgentStoredMessage, AgentTraceStep, AgentChange, AgentChatResult, LlmUsageInfo, LlmProviderInfo, AiTeachWorkspaceInfo, AiTeachSourceEntry } from '../../types'

/**
 * 「AI教学」模块（原 id immersive / 沉浸式 Agent；总纲 docs/ai-teaching-module-rework.md，
 * 历史设计 docs/agent-immersive-mode-design.md M0 骨架）
 * 独立全屏 Tab（五区布局），与轻问答共用 AgentRunner 会话库与 agent:step 推送。
 * 已实现：会话列表/新建任务（场景模板）/发送/回复渲染/实时步骤/轨迹折叠/改动清单可跳编辑器；
 * P1 会话⇄文件夹绑定：新建对话即建 `{MM-DD} 标题` 文件夹（.session.json 锚点）、重命名同步改夹、
 * 删除会话按 aiTeachDeleteSessionFolder（ask/keep/delete）处理文件夹（进系统回收站）。
 * P2 约束文件化：会话要求唯一真相源 = 会话文件夹 CONSTRAINTS.md（弹层读写文件，主进程每轮重读注入）。
 * P3 中栏改版：AI 回答去气泡平铺 + 逐条操作条（整理成文档/复制/轨迹）；右缘快速定位条（标题锚点）；
 * 输入区流式停止键 + 本对话模型/思考强度合一菜单（仅本对话生效）；顶栏收敛（时间线/文档视图/文档地图退役）。
 * P4 左栏 VS Code 化（§3.7/3.9）：多分区侧栏（资源管理器=产物根文件树全套操作 / 会话 / 任务规划），
 * 折叠贴靠+状态记忆，左右侧栏整体收放记忆；md 点击 → 中栏文档阅读视图（方案 B：工具行+宽幅渲染+h2/h3 大纲+滚动记忆）。
 * P5 工作区两层（§3.2-6）：记住上次工作区直接进（3-38），顶栏工作区 chip 回「工作区选择页」（卡片统计/搜索/新建/改名/删除=仅解归属）；
 * 一个工作区=一门课程含多对话，元数据入仓库 .knowbase/modules/aiTeaching/workspaces.json；
 * 顶栏页签=本工作区对话（会话列表区退役）、工作区 chip 返回选择页；左栏树挂工作区文件夹层；
 * 新对话自动归属当前工作区，产物落 `AI教学/{工作区}/{MM-DD 标题}/`（存量扁平文件夹不迁移，锚点扫描双深度兼容）。
 * P7 题目视图（§3.2-7/3-9）：中栏「对话 ⇄ 题目」切换器；AI 按 quiz 围栏协议出题（注入格式规则），
 * 题目自动收录进题目视图，答题复用知识库 QuizMode（判分/解析/错题），交卷后成绩报告落会话文件夹 `测验·*.md`，
 * 逐题记录经 quizRecord:report（aiTeach: 命名空间）入知识库错题体系（3-10）。
 * P6 素材库（§3.13 结构 v3）：右栏「素材库」展示 SOURCE.md 条目（工作区 SOURCES/{对话夹}/），「＋素材」表单登记
 * （类型/存放/页码区间仅 pdf·pptx 拆起止，3-28 程序解析写入）、pdf/pptx 一键区间提取为同级可编辑提取稿（3-20/3-26），
 * SOURCE.md 与提取稿经 AgentRunner 素材目录注入供 AI 编号引用（3-29，每轮重读）。
 * 占位（P8）：用户画像（§3.14 两层 PROFILE.md）。
 */

/** P5：工作区卡片「最近活跃」相对时间（updated_at 'YYYY-MM-DD HH:MM:SS' 本地串） */
function wsAgo(iso: string | null): string {
  if (!iso) return '无'
  const t = new Date(iso.replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return '无'
  const d = Date.now() - t
  if (d < 86400000) return '今天'
  if (d < 172800000) return '昨天'
  return iso.slice(5, 10)
}

/** P4 §3.9-1：侧栏分区头（VS Code 式贴靠——收起只剩头，展开体占剩余高度） */
function SectionHead({ open, title, onToggle, right }: { open: boolean; title: string; onToggle: () => void; right?: React.ReactNode }) {
  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-1 px-2 py-1.5 shrink-0 select-none cursor-pointer border-t border-[var(--border-color)] text-[11px] font-semibold tracking-wide text-[var(--text-muted)] hover:bg-[var(--bg-hover)] first:border-t-0 ${open ? 'bg-[var(--bg-secondary)]' : ''}`}
    >
      {open ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
      <span className="truncate">{title}</span>
      {right && <span className="ml-auto flex items-center gap-0.5" onClick={e => e.stopPropagation()}>{right}</span>}
    </div>
  )
}

/** P3b：思考强度档位（与主进程 LlmInvokeRequest.effort 同口径） */
type Effort = 'off' | 'low' | 'medium' | 'high'
const EFFORT_LABEL: Record<Effort, string> = { off: '关闭', low: '低', medium: '中', high: '高' }

/** P3a（3-13）：回答锚点标题——取首行 markdown 标题（主进程已注入标题规则）；无标题退首行截断，再退「回答N」 */
function msgAnchorTitle(content: string, n: number): string {
  const lines = String(content ?? '').split('\n')
  for (const l of lines) {
    const m = /^\s{0,3}#{1,6}\s+(.+)/.exec(l)
    const t = m?.[1]?.replace(/[*`>]/g, '').trim()
    if (t) return t.slice(0, 40)
  }
  const first = (lines.find(l => l.trim().length > 0) ?? '').trim()
  return first ? first.slice(0, 28) : `回答 ${n + 1}`
}

interface Template {
  id: string
  label: string
  icon: React.ReactNode
  desc: string
  goal: string
  steps: string[]
  /** 模板会话新建后自动发出的开场指令 */
  opening: string
}

const TEMPLATES: Template[] = [
  {
    id: 'teach', label: '跟我学（教学）', icon: <BookOpen size={13} />,
    desc: '喂资料，学到大纲确认与测验',
    goal: '把我提供的资料教到我会：先出大纲待我确认，再分步精讲，最后出题检验。',
    steps: ['通读资料', '学习大纲', '分章精讲', '随堂测验', '沉淀复习笔记'],
    opening: '【教学任务】我接下来会提供学习资料（网址/文件/仓库笔记均可）。请按教学流程：① 通读我给的资料后产出学习大纲并等待我确认（不要直接开讲）；② 确认后分步精讲，每步讲完停一下让我提问；③ 最后出几道题检验并讲解。全程用简体中文。',
  },
  {
    id: 'research', label: '深度研读（织网）', icon: <Compass size={13} />,
    desc: '把相关笔记读透并整理成专题页',
    goal: '把一个主题在仓库里的所有相关内容研读一遍，讲给我听，并产出一张带双链的专题页草稿待确认写入。',
    steps: ['定位相关笔记', '批量通读', '综合讲解', '专题页草稿', '确认写入'],
    opening: '【研读任务】我要研究一个主题，会告诉你主题关键词。请用 vault.search 找出仓库内相关笔记并通读，向我综合讲解，然后产出一张「主题专题」.md 草稿（含指向来源页的 [[双链]]）等待我确认后再写入。',
  },
  {
    id: 'review', label: '周复盘', icon: <CalendarClock size={13} />,
    desc: '读日程/日记/打卡生成周报',
    goal: '总结我指定的一段时间：成就、回落与下周建议，产出周报草稿。',
    steps: ['读取模块数据', '生成周报草稿', '确认写入'],
    opening: '【复盘任务】请读取我的日程待办、日记、习惯打卡与番茄钟统计，生成一份复盘报告草稿（成就/回落/下周建议），等待我确认后写入周总结。',
  },
]

/** 内置工具 → 中文简称（缺省回退短名） */
const TOOL_CN: Record<string, string> = {
  'builtin.vault.list': '列目录', 'builtin.vault.read': '读笔记文件', 'builtin.vault.search': '搜笔记内容',
  'builtin.vault.write': '写笔记文件', 'builtin.vault.edit': '修改笔记', 'builtin.vault.rename': '重命名',
  'builtin.vault.trash': '移回收站', 'builtin.vault.resolve-ref': '校验引用',
  'builtin.knowledge.search': '搜知识库', 'builtin.knowledge.read': '读知识页', 'builtin.knowledge.create-page': '建知识页',
  'builtin.knowledge.append-page': '追加知识页', 'builtin.blog.create-entry': '写日记', 'builtin.schedule.create-todo': '建待办',
  'builtin.checkin.check-habit': '打卡', 'builtin.habits.list': '查习惯', 'builtin.habits.stats': '习惯统计',
  'builtin.bookmarks.search': '搜书签', 'builtin.pomodoro.summary': '专注统计', 'builtin.schedule.list-todos': '查待办',
  'builtin.web.search': '联网搜索', 'builtin.web.read': '读网页', 'builtin.docs.read-text': '提取 PDF/PPT',
}
function toolName(name?: string): string {
  const s = String(name ?? '')
  return TOOL_CN[s] ?? (s.startsWith('builtin.') ? s.slice(8) : s || '工具')
}

interface UiMsg {
  id?: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  trace?: AgentTraceStep[]
}

function nowLocal(): string { return new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
function fmtTime(iso: string): string { try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
function fmtTok(n: number): string { return n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

export function AiTeachingModule({ isActive, zenLevel = 0, onZenLevelChange }: { isActive?: boolean; zenLevel?: number; onZenLevelChange?: (n: number) => void }) {
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTitle, setActiveTitle] = useState('')
  const [template, setTemplate] = useState<Template>(TEMPLATES[0])
  const [messages, setMessages] = useState<UiMsg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [liveSteps, setLiveSteps] = useState<AgentTraceStep[]>([])
  const [lastChanges, setLastChanges] = useState<AgentChange[] | null>(null)
  // P3b（§3.8 第五轮 R12/R14）：本对话模型/思考强度覆盖（内存级，仅本对话生效）+ 整理成文档状态
  const convoLlm = useRef<Map<string, { modelId?: string; effort?: Effort }>>(new Map())
  const [convoModel, setConvoModel] = useState('')
  const [convoEffort, setConvoEffort] = useState<Effort>('off')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [providerList, setProviderList] = useState<LlmProviderInfo[]>([])
  const [modelCapable, setModelCapable] = useState(false)
  const [organized, setOrganized] = useState<Record<string, string>>({})
  // P4（§3.7/3.9）：左栏 VS Code 多分区（折叠贴靠+状态记忆）+ 侧栏整体收放 + 中栏文档阅读视图（方案 B）
  const [collapsedSec, setCollapsedSec] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('aiTeach.sections.collapsed') || '{}') } catch { return {} } })
  const toggleSec = useCallback((k: string) => setCollapsedSec(prev => {
    const n = { ...prev, [k]: !prev[k] }
    localStorage.setItem('aiTeach.sections.collapsed', JSON.stringify(n))
    return n
  }), [])
  const [leftOpen, setLeftOpen] = useState(() => localStorage.getItem('aiTeach.leftOpen') !== '0')
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('aiTeach.rightOpen') !== '0')
  const toggleSide = (side: 'left' | 'right') => {
    if (side === 'left') { const v = !leftOpen; setLeftOpen(v); localStorage.setItem('aiTeach.leftOpen', v ? '1' : '0') }
    else { const v = !rightOpen; setRightOpen(v); localStorage.setItem('aiTeach.rightOpen', v ? '1' : '0') }
  }
  const [aiTeachRoot, setAiTeachRoot] = useState('AI教学')
  const [docView, setDocView] = useState<{ rel: string; name: string; content: string } | null>(null)
  const [docOutline, setDocOutline] = useState<Array<{ id: string; text: string; lv: number }>>([])
  const docScrollRef = useRef<HTMLDivElement>(null)
  const docScrollPos = useRef<Record<string, number>>({})
  const openDocView = useCallback(async (rel: string) => {
    const cur = await workspaceGetCurrent().catch(() => null)
    const rootId = (cur as { rootId?: string } | null)?.rootId
    if (!rootId) { showToast({ type: 'error', message: '尚未打开仓库' }); return }
    const r = await workspaceReadFile(rootId, rel).catch(() => null)
    if (!r || typeof r.content !== 'string') { showToast({ type: 'error', message: '读取文档失败' }); return }
    setDocView({ rel, name: rel.split('/').pop() ?? rel, content: r.content }) // 与逐页阅读互斥靠渲染优先级：docView > reader > 对话
  }, [])
  useEffect(() => { void getSettingRaw('aiTeachRootDir').then(v => { const s = String(v ?? '').trim(); if (s) setAiTeachRoot(s) }).catch(() => {}) }, [])
  // 阅读视图渲染完成：DOM 收集 h2/h3 大纲 + 恢复滚动位置（§3.9-2 状态记忆）
  useEffect(() => {
    if (!docView) { setDocOutline([]); return }
    const raf = requestAnimationFrame(() => {
      const els = docScrollRef.current?.querySelectorAll('h2, h3') ?? []
      setDocOutline(Array.from(els).map(el => ({ id: (el as HTMLElement).id, text: (el.textContent ?? '').trim(), lv: el.tagName === 'H2' ? 2 : 3 })).filter(x => x.id && x.text))
      if (docScrollRef.current) docScrollRef.current.scrollTop = docScrollPos.current[docView.rel] ?? 0
    })
    return () => cancelAnimationFrame(raf)
  }, [docView])

  // ---------- P5 工作区两层（§3.2-6；3-6/3-8 按建议：元数据入仓库 .knowbase、跟随当前激活仓库） ----------
  const [wsList, setWsList] = useState<AiTeachWorkspaceInfo[]>([])
  const [wsSessionMap, setWsSessionMap] = useState<Record<string, string>>({})
  const [lastWsId, setLastWsId] = useState<string | null>(null)
  const [activeWs, setActiveWs] = useState<string | null>(null) // null = 工作区选择页（3-38：默认记住上次直接进，仅首次/无记忆时可见）
  const activeWsRef = useRef<string | null>(null)
  useEffect(() => { activeWsRef.current = activeWs }, [activeWs])
  const wsMapRef = useRef<Record<string, string>>({})
  useEffect(() => { wsMapRef.current = wsSessionMap }, [wsSessionMap])
  const [wsSearch, setWsSearch] = useState('')
  const [wsModal, setWsModal] = useState<{ mode: 'create' | 'rename'; id?: string; value: string } | null>(null)
  const refreshWorkspaces = useCallback(async () => {
    const r = await aiTeachListWorkspaces().catch(() => null)
    if (!r) return
    setWsList(r.workspaces); setWsSessionMap(r.sessionWs); setLastWsId(r.lastWorkspaceId)
  }, [])
  useEffect(() => { void refreshWorkspaces() }, [refreshWorkspaces])
  const wsActive = activeWs && activeWs !== '__none__' ? wsList.find(w => w.id === activeWs) ?? null : null
  const wsTreeSeg = (() => {
    if (!wsActive) return ''
    const p = `${aiTeachRoot}/`
    return wsActive.folderRel.startsWith(p) ? wsActive.folderRel.slice(p.length) : wsActive.folderRel
  })()
  const treeBase = wsTreeSeg ? `${aiTeachRoot}/${wsTreeSeg}` : aiTeachRoot
  const wsSessions = useMemo(
    () => sessions.filter(s => (wsSessionMap[s.id] ?? '__none__') === (activeWs ?? '__none__')),
    [sessions, wsSessionMap, activeWs],
  )
  // ---------- P7 题目视图（§3.2-7/3-9 中栏顶部切换器；答题复用知识库 QuizMode，3-10 记录持久化） ----------
  const [midView, setMidView] = useState<'chat' | 'quiz'>('chat')
  const [quizOpen, setQuizOpen] = useState(false)
  const [lastQuizReport, setLastQuizReport] = useState<{ rel: string; score: string } | null>(null)
  const quizItems = useMemo(
    () => messages.filter(m => m.role === 'assistant').flatMap(m => extractQuizzes(m.content)),
    [messages],
  )
  const [showNewMenu, setShowNewMenu] = useState(false)
  // ---- Token 消耗统计（月度走 llm:getUsage）----
  const [usage, setUsage] = useState<LlmUsageInfo | null>(null)
  const [defaultModel, setDefaultModel] = useState('')
  const [tokenOpen, setTokenOpen] = useState(false)
  useEffect(() => {
    void llmGetUsage().then(setUsage).catch(() => null)
    void getSettingRaw('defaultChatModel').then(v => setDefaultModel(String(v ?? ''))).catch(() => {})
  }, [])
  // P1：主进程侧不可静默的提示（根目录改名迁移失败/目标占用等）
  useEffect(() => onAiTeachNotice((msg) => { if (msg) showToast({ type: 'warning', message: msg }) }), [])
  // 会话级全局要求（P2 §2.3：唯一真相源=会话文件夹 CONSTRAINTS.md；DB 字段仅旧会话读兼容）
  const [activeInstr, setActiveInstr] = useState('')
  const [instrRel, setInstrRel] = useState('')
  const [instrOpen, setInstrOpen] = useState(false)
  const [instrDraft, setInstrDraft] = useState('')
  const [instrDismiss, setInstrDismiss] = useState(false)
  // PPT 素材与逐页阅读（docs:pptxPages）
  const [sources, setSources] = useState<Array<{ rel: string; name: string }>>([])
  const [pickOpen, setPickOpen] = useState(false)
  const [pickList, setPickList] = useState<Array<{ rel: string; name: string }>>([])
  const [pickLoading, setPickLoading] = useState(false)
  const [reader, setReader] = useState<{ rel: string; name: string; pages: Array<{ n: number; text: string }>; cur: number } | null>(null)
  const [activeIdRef, chatIdRef] = [useRef<string | null>(null), useRef('')]
  const bottomRef = useRef<HTMLDivElement>(null)
  // P3a 快速定位条：消息滚动容器 + 当前锚点高亮
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeAnchor, setActiveAnchor] = useState(0)
  const liveRef = useRef(liveSteps)

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { liveRef.current = liveSteps }, [liveSteps])

  // ---- 禅模式（唯一作用域 = 本模块）----
  // Esc 退出：本模块浮层（会话要求/Token 明细/新建菜单/素材选择）优先关闭，再退禅
  const zenActive = zenLevel >= 1 && !!onZenLevelChange
  useEffect(() => {
    if (!isActive || !zenActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (instrOpen || tokenOpen || showNewMenu || pickOpen) {
        setInstrOpen(false); setTokenOpen(false); setShowNewMenu(false); setPickOpen(false)
        return
      }
      e.preventDefault()
      onZenLevelChange?.(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, zenActive, onZenLevelChange, instrOpen, tokenOpen, showNewMenu, pickOpen])

  // 离开本模块 Tab 自动退出禅（保活架构组件不卸载，必须监听 isActive）
  useEffect(() => {
    if (!isActive && zenLevel > 0) onZenLevelChange?.(0)
  }, [isActive, zenLevel, onZenLevelChange])

  // P2（§2.3/2-6）：会话约束读取——文件唯一真相源；无文件夹的旧会话读兼容回退 DB 字段一次
  const loadConstraints = useCallback(async (sid: string, dbFallback: string): Promise<void> => {
    const r = await aiTeachReadConstraints(sid).catch(() => null)
    const text = r && r.ok ? (r.relPath ? (r.text ?? '').trim() : dbFallback) : dbFallback
    if (activeIdRef.current === sid) { setActiveInstr(text); setInstrRel(r?.relPath ?? '') }
  }, [])

  const refreshSessions = useCallback(async () => {
    const list = await agentSessions().catch(() => [])
    setSessions(list)
    // P5：选择页状态（activeWs=null）不自动开会话；进工作区后只在本工作区会话里选
    const cur = activeIdRef.current ? list.find(s => s.id === activeIdRef.current) : undefined
    const pool = activeWsRef.current
      ? list.filter(s => (wsMapRef.current[s.id] ?? '__none__') === activeWsRef.current)
      : []
    const first = activeWsRef.current ? (cur ?? pool[0]) : undefined
    if (first) {
      setActiveId(first.id)
      setActiveTitle(first.title)
      setInstrDismiss(false)
      void loadConstraints(first.id, first.instructions ?? '')
    } else if (!activeWsRef.current) {
      setActiveId(null)
      setActiveInstr(''); setInstrRel('')
    }
  }, [loadConstraints])

  const refreshMessages = useCallback(async (sid: string) => {
    const rows = await agentMessages(sid).catch(() => [] as AgentStoredMessage[])
    setMessages(rows.map(m => ({
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
      trace: m.traceJson ? (() => { try { return JSON.parse(m.traceJson) as AgentTraceStep[] } catch { return undefined } })() : undefined,
    })))
  }, [])

  // 打开 AI教学 Tab 时同步会话
  useEffect(() => { void refreshSessions() }, [refreshSessions, isActive])

  // P1 重命名会话（双击列表行）：agentRenameSession + 文件夹同步改名
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // 实时步骤（agent:step，按 chatId 过滤）
  useEffect(() => {
    return onAgentStep(({ chatId, step }) => {
      if (chatId !== chatIdRef.current) return
      setLiveSteps(prev => [...prev.slice(-29), step])
    })
  }, [])

  // 切换会话
  const openSession = useCallback(async (sid: string, title: string) => {
    setActiveId(sid); setActiveTitle(title); setLastChanges(null); setLiveSteps([])
    setDocView(null) // 切会话退出文档阅读（P4）
    setMidView('chat'); setQuizOpen(false); setLastQuizReport(null) // P7 复位
    const row = sessions.find(s => s.id === sid)
    setInstrDismiss(false)
    void loadConstraints(sid, row?.instructions ?? '')
    await refreshMessages(sid)
  }, [refreshMessages, sessions, loadConstraints])

  const sendText = useCallback(async (raw: string, cid: string): Promise<AgentChatResult | null> => {
    setPending(true); setLiveSteps([])
    const sid = activeIdRef.current
    if (!sid) { setPending(false); return null }
    setMessages(prev => [...prev, { role: 'user', content: raw, createdAt: nowLocal() }])
    const ov = convoLlm.current.get(sid)
    const r = await agentChat(sid, raw, undefined, cid, 'aiTeaching', ov?.modelId, ov?.effort)
    setLastChanges(r?.changes && r.changes.length ? r.changes : null)
    await refreshMessages(sid)
    setPending(false)
    return r
  }, [refreshMessages])

  const doSend = useCallback(async () => {
    const text = input.trim()
    if (!text || pending) return
    setInput('')
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    const r = await sendText(text, cid)
    if (r && !r.ok && r.code !== 'ABORTED') showToast({ type: 'error', message: `AI 调用失败：${r.error ?? ''}` })
  }, [input, pending, sendText])

  // 新建任务（模板）：自动发开场指令并选中该会话
  const newTask = useCallback(async (tpl: Template) => {
    const row = await agentNewSession(`${tpl.label}`).catch(() => null)
    if (!row) return
    // P5：先归属当前工作区（元数据真相源），再建夹——ensure 在主进程读归属决定两层路径
    if (activeWs && activeWs !== '__none__') await aiTeachAssignSession(row.id, activeWs).catch(() => null)
    // P1（2-2）：新建对话确认即建会话文件夹（懒建语义下空会话也不删）；P2 模板播种后载入展示
    void aiTeachEnsureSessionFolder(row.id).then(async r => {
      if (r && !r.ok && r.error) showToast({ type: 'error', message: `会话文件夹创建失败：${r.error}` })
      await loadConstraints(row.id, '')
      await refreshWorkspaces()
    })
    setTemplate(tpl)
    setActiveId(row.id); setActiveTitle(row.title)
    activeIdRef.current = row.id
    setMessages([]); setLastChanges(null); setShowNewMenu(false); setActiveInstr(''); setInstrRel(''); setInstrDismiss(false); setDocView(null)
    setMidView('chat'); setQuizOpen(false); setLastQuizReport(null) // P7 复位
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    void sendText(tpl.opening, cid)
    void refreshSessions()
  }, [sendText, refreshSessions, loadConstraints, activeWs, refreshWorkspaces])

  // ---------- P5：工作区进出与管理 ----------
  const enterWs = useCallback((id: string) => {
    setActiveWs(id); activeWsRef.current = id
    setWsSearch('')
    if (id !== '__none__') void aiTeachSetLastWorkspace(id)
    const own = sessions
      .filter(s => (wsSessionMap[s.id] ?? '__none__') === id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (own.length) {
      void openSession(own[0].id, own[0].title)
    } else {
      activeIdRef.current = null
      setActiveId(null); setActiveTitle(''); setMessages([]); setLastChanges(null); setLiveSteps([]); setDocView(null)
      setActiveInstr(''); setInstrRel('')
      setMidView('chat'); setQuizOpen(false); setLastQuizReport(null)
    }
    void refreshSessions()
  }, [sessions, wsSessionMap, openSession, refreshSessions])
  // 3-38（已拍板）：记住上次工作区，进模块直接回到上次的对话；换区走顶栏工作区 chip 回选择页。
  // 只在选择页态（用户未手动退出过：boot 尝试仅一次）且记忆有效时自动进入；首次使用停留在选择页。
  const wsBootRef = useRef(false)
  useEffect(() => {
    if (wsBootRef.current || wsList.length === 0) return
    wsBootRef.current = true
    if (activeWs === null && lastWsId && wsList.some(w => w.id === lastWsId)) enterWs(lastWsId)
  }, [wsList, lastWsId, activeWs, enterWs])
  const exitToPicker = useCallback(() => {
    setActiveWs(null); activeWsRef.current = null
    void refreshWorkspaces()
  }, [refreshWorkspaces])
  const submitWsModal = useCallback(async () => {
    if (!wsModal) return
    const name = wsModal.value.trim()
    if (!name) { setWsModal(null); return }
    if (wsModal.mode === 'create') {
      const r = await aiTeachCreateWorkspace(name)
      setWsModal(null)
      if (!r.ok || !r.workspace) { showToast({ type: 'error', message: r.error ?? '创建工作区失败' }); return }
      showToast({ type: 'info', message: `已创建工作区「${r.workspace.name}」` })
      await refreshWorkspaces()
      enterWs(r.workspace.id)
    } else {
      const r = await aiTeachRenameWorkspace(wsModal.id ?? '', name)
      if (!r.ok) showToast({ type: 'error', message: r.error ?? '工作区改名失败' })
      else showToast({ type: 'info', message: '工作区已改名（产物文件夹同步）' })
      await refreshWorkspaces()
      setWsModal(null)
    }
  }, [wsModal, refreshWorkspaces, enterWs])
  const removeWs = useCallback(async (w: AiTeachWorkspaceInfo) => {
    const okGo = await showGlobalConfirm({
      title: `删除工作区「${w.name}」`,
      message: '只删除工作区本身（归属元数据）：「AI教学」下的文件夹与其中对话都保留在原处（3-39：不迁移、也不再显示在界面中），产物文件不删。',
      confirmLabel: '删除工作区', variant: 'danger',
    })
    if (!okGo) return
    const r = await aiTeachDeleteWorkspace(w.id)
    if (!r.ok) { showToast({ type: 'error', message: r.error ?? '删除失败' }); return }
    if (activeWs === w.id) { setActiveWs(null); activeWsRef.current = null }
    await refreshWorkspaces()
  }, [activeWs, refreshWorkspaces])
  const wsFiltered = useMemo(() => {
    const q = wsSearch.trim().toLowerCase()
    return q ? wsList.filter(w => w.name.toLowerCase().includes(q)) : wsList
  }, [wsList, wsSearch])

  /** P7：快捷发问（空题目视图引导；与输入框同链路，自动带 aiTeaching 规则） */
  const sendQuick = useCallback((text: string) => {
    if (pending) return
    if (!activeIdRef.current) { showToast({ type: 'warning', message: '先在「对话」里发一条消息或新建任务' }); return }
    setMidView('chat')
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    void sendText(text, cid)
  }, [pending, sendText])

  /** P7（测验结果联动产物）：整卷答完 → 报告 md 落会话文件夹 `测验·随堂测验 MM-DD HH:mm.md` */
  const handleQuizFinish = useCallback(async (s: { total: number; correctCount: number; records: Array<{ no: number; correct: boolean; picked: string }> }) => {
    const sid = activeIdRef.current
    if (!sid) return
    const now = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    const stamp = `${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`
    const byNo = new Map(quizItems.map(q => [q.no, q]))
    const pct = s.total ? Math.round((s.correctCount / s.total) * 100) : 0
    const lines: string[] = [
      '### 随堂测验报告',
      '',
      `> 会话「${activeTitle || '未命名'}」 · 得分 **${s.correctCount} / ${s.total}**（${pct}%） · ${stamp}`,
      '',
      '| 题号 | 我的答案 | 结果 |',
      '|---|---|---|',
      ...s.records.map(r => `| ${r.no} | ${r.picked} | ${r.correct ? '✓' : '✗'} |`),
    ]
    const wrong = s.records.filter(r => !r.correct)
    if (wrong.length) {
      lines.push('', '## 错题解析', '')
      for (const r of wrong) {
        const item = byNo.get(r.no)
        if (!item) continue
        lines.push(`**第 ${item.no} 题** ${(item.question || '').replace(/\s*\n+\s*/g, ' ').slice(0, 200)}`, '', `我选了 ${r.picked}，正确答案 **${item.answer}**。`, '', item.explanation || '（本题无解析）', '')
      }
    } else {
      lines.push('', '全部答正确，保持状态 💪')
    }
    lines.push('', '_报告由 AI教学题目视图在答题完成后自动生成；题干与解析以对话原文为准。_')
    const r = await aiTeachOrganizeDoc(sid, `随堂测验 ${stamp}`, lines.join('\n'), '测验').catch(() => null)
    if (r && r.ok && r.relPath) {
      setLastQuizReport({ rel: r.relPath, score: `${s.correctCount}/${s.total}` })
      showToast({ type: 'info', message: `测验成绩 ${s.correctCount}/${s.total} · 报告已存 ${r.relPath.split('/').pop()}` })
      void refreshWorkspaces()
    } else {
      showToast({ type: 'error', message: `测验报告落盘失败${r?.error ? `：${r.error}` : ''}` })
    }
  }, [quizItems, activeTitle, refreshWorkspaces])

  // ---------- P6 素材库（§3.13 结构 v3：SOURCE.md 登记 + 区间提取稿） ----------
  const [srcEntries, setSrcEntries] = useState<AiTeachSourceEntry[]>([])
  const [srcFileRel, setSrcFileRel] = useState<string | null>(null)
  const [srcForm, setSrcForm] = useState<null | { name: string; type: string; path: string; storage: '已入库' | '仅引用'; rangeFrom: string; rangeTo: string; note: string }>(null)
  const [srcBusy, setSrcBusy] = useState<number | null>(null)
  const refreshSources = useCallback(async (sid: string | null) => {
    if (!sid) { setSrcEntries([]); setSrcFileRel(null); return }
    const r = await aiTeachSrcRead(sid).catch(() => null)
    if (r?.ok) { setSrcEntries(r.entries ?? []); setSrcFileRel(r.relPath ?? null) }
    else { setSrcEntries([]); setSrcFileRel(null) }
  }, [])
  useEffect(() => { void refreshSources(activeId) }, [activeId, refreshSources])
  const openSrcFile = (rel: string) => window.dispatchEvent(new CustomEvent('kb-open-in-editor', { detail: { relPath: rel } }))
  const submitSrcForm = async () => {
    if (!activeId || !srcForm) return
    const name = srcForm.name.trim()
    if (!name) { showToast({ type: 'warning', message: '素材名称必填' }); return }
    const r = await aiTeachSrcAdd(activeId, {
      name, type: srcForm.type, path: srcForm.path.trim(), storage: srcForm.storage,
      rangeFrom: srcForm.rangeFrom.trim() || undefined, rangeTo: srcForm.rangeTo.trim() || undefined, note: srcForm.note.trim(),
    }).catch((e: Error) => ({ ok: false as const, error: e.message }))
    if (r.ok) { await refreshSources(activeId); setSrcForm(null); showToast({ type: 'info', message: '✓ 已写入 SOURCE.md' }) }
    else showToast({ type: 'error', message: `登记失败：${r.error ?? '未知错误'}` })
  }
  const pickSrcFile = async () => {
    const r = await aiTeachSrcPick().catch(() => null)
    if (r?.ok && r.path) setSrcForm(f => (f ? { ...f, path: r.path as string, storage: '已入库' } : f))
  }
  const doExtract = async (no: number) => {
    if (!activeId) return
    setSrcBusy(no)
    const r = await aiTeachSrcExtract(activeId, no).catch((e: Error) => ({ ok: false as const, error: e.message }))
    setSrcBusy(null)
    if (r.ok && r.relPath) { await refreshSources(activeId); showToast({ type: 'info', message: `提取完成：${r.relPath.split('/').pop()}` }); openSrcFile(r.relPath) }
    else showToast({ type: 'error', message: `提取失败：${(r as { error?: string }).error ?? '未知错误'}` })
  }
  const doRemoveSrc = async (no: number, nm: string) => {
    if (!activeId) return
    const yes = await showGlobalConfirm({ title: '移除素材登记', message: `从 SOURCE.md 删除条目 #${no}「${nm}」？素材原件与提取稿文件不会被删除。`, confirmLabel: '移除', variant: 'danger' })
    if (!yes) return
    const r = await aiTeachSrcRemove(activeId, no).catch((e: Error) => ({ ok: false as const, error: e.message }))
    if (r?.ok) { await refreshSources(activeId); showToast({ type: 'info', message: '已移除登记' }) }
    else showToast({ type: 'error', message: `移除失败：${(r as { error?: string })?.error ?? ''}` })
  }

  /** P2（2-6）：保存会话要求 = 写会话文件夹 CONSTRAINTS.md（懒建兜底）；清掉旧 DB 字段残留防双真相源 */
  const saveInstr = async (): Promise<void> => {
    const sid = activeIdRef.current
    if (!sid) return
    const text = instrDraft.trim().slice(0, 2000)
    const r = await aiTeachWriteConstraints(sid, text).catch(() => null)
    if (r && r.ok) {
      const hadDb = !!sessions.find(s => s.id === sid)?.instructions
      if (hadDb) void agentSetSessionInstructions(sid, '').catch(() => null)
      setActiveInstr(text); setInstrRel(r.relPath ?? ''); setInstrDismiss(false); setInstrOpen(false)
      showToast({ type: 'info', message: text ? '已保存到 CONSTRAINTS.md（编辑器里可直接改，AI 每轮发送时重读）' : '已清除本会话约束' })
    } else {
      showToast({ type: 'error', message: `约束保存失败${r?.error ? `：${r.error}` : ''}` })
    }
  }

  // ---- PPT 素材：从当前仓库选取 .pptx 并逐页阅读（docs:pptxPages）----
  const refreshPptxList = useCallback(async () => {
    setPickLoading(true)
    setPickList([])
    try {
      const cur = await workspaceGetCurrent().catch(() => null)
      const rootId = (cur as { rootId?: string } | null)?.rootId
      if (!rootId) return
      const found: Array<{ rel: string; name: string }> = []
      const walk = async (dir: string, depth: number) => {
        if (depth > 3 || found.length > 200) return
        const res = await workspaceListDir(rootId, dir).catch(() => null)
        for (const e of res?.entries ?? []) {
          const rel = dir ? `${dir}/${e.name}` : e.name
          if (e.type === 'dir') await walk(rel, depth + 1)
          else if (e.name.toLowerCase().endsWith('.pptx')) found.push({ rel, name: e.name })
        }
      }
      await walk('', 1)
      setPickList(found)
    } finally {
      setPickLoading(false)
    }
  }, [])

  const openPptxReader = useCallback(async (rel: string, name: string) => {
    const r = await docsPptxPages(rel).catch(() => null)
    if (!r?.ok || !r.pages || r.pages.length === 0) {
      showToast({ type: 'error', message: (r as { error?: string } | null)?.error || '读取失败（暂仅支持 .pptx）' })
      return
    }
    setReader({ rel, name, pages: r.pages, cur: 0 })
    setPickOpen(false)
  }, [])

  const addSourceFromPick = useCallback(async (rel: string, name: string) => {
    setSources(prev => (prev.some(s => s.rel === rel) ? prev : [...prev, { rel, name }]))
    void openPptxReader(rel, name)
  }, [openPptxReader])

  const goPage = useCallback((delta: number) => {
    setReader(r => {
      if (!r) return r
      const next = Math.min(Math.max(r.cur + delta, 0), r.pages.length - 1)
      return next === r.cur ? r : { ...r, cur: next }
    })
  }, [])

  /** 让 AI 讲解当前页（把该页文字发进对话） */
  const talkCurrentPage = useCallback(async () => {
    if (!reader || pending) return
    const page = reader.pages[reader.cur]
    if (!page) return
    setReader(null) // P3a：讲当前页退出阅读视图回对话流（reader 激活才占用中栏）
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    const text = `我在逐页阅读 PPT《${reader.name}》第 ${reader.cur + 1} 页。请基于这一页讲清楚要点，讲完停一下等我的问题：\n\n${page.text.slice(0, 2200)}`
    void sendText(text, cid)
  }, [reader, pending, sendText])

  const removeSource = useCallback((rel: string) => {
    setSources(prev => prev.filter(s => s.rel !== rel))
    setReader(r => (r && r.rel === rel ? null : r))
  }, [])

  /** 提交重命名：DB 标题 + 会话文件夹同步（无文件夹的旧会话不主动建，2-5 懒创建时自然用新名） */
  const commitRename = useCallback(async (sid: string) => {
    const t = renameDraft.trim().slice(0, 40)
    setRenamingId(null)
    const row = sessions.find(s => s.id === sid)
    if (!t || !row || t === row.title) return
    setSessions(prev => prev.map(s => (s.id === sid ? { ...s, title: t } : s)))
    if (activeIdRef.current === sid) setActiveTitle(t)
    await agentRenameSession(sid, t).catch(() => null)
    void aiTeachRenameSessionFolder(sid, t).then(r => {
      if (r && !r.ok && r.error) showToast({ type: 'error', message: `会话文件夹改名失败：${r.error}` })
    })
  }, [renameDraft, sessions])

  /** 删除会话（P1，2-4）：对话记录必删；产物文件夹按 aiTeachDeleteSessionFolder 设置处理 */
  const delSession = useCallback(async (e: React.MouseEvent, sid: string, title?: string) => {
    e.stopPropagation()
    const mode = String((await getSettingRaw('aiTeachDeleteSessionFolder').catch(() => null)) ?? 'ask')
    let rmFolder = false
    if (mode !== 'keep') {
      const f = await aiTeachSessionFolder(sid).catch(() => null)
      if (f?.ok && f.relPath) {
        if (mode === 'delete') rmFolder = true
        else {
          rmFolder = await showGlobalConfirm({
            title: '删除会话',
            message: `对话记录「${title ?? ''}」将被删除。该会话在仓库中的产物文件夹「${f.relPath}」是否一并移入系统回收站？（「保留文件夹」= 只删对话记录）`,
            confirmLabel: '删除文件夹',
            cancelLabel: '保留文件夹',
            variant: 'danger',
          })
        }
      }
    }
    await agentDeleteSession(sid).catch(() => null)
    if (rmFolder) void aiTeachDeleteSessionFolder(sid).then(r => {
      if (r && !r.ok && r.error) showToast({ type: 'error', message: `会话文件夹删除失败：${r.error}` })
    })
    if (activeIdRef.current === sid) { setActiveId(null); setMessages([]); activeIdRef.current = null }
    void refreshSessions()
  }, [refreshSessions])

  const toolCount = liveSteps.filter(s => s.kind === 'tool').length
  const lastStep = liveSteps[liveSteps.length - 1]
  // P3a（§3.8-1）：快速定位条锚点——每条 AI 回答取首行标题（标题规则由主进程注入，3-13）
  const anchors = useMemo(
    () => messages.flatMap((m, idx) => (m.role === 'assistant' ? [{ idx, title: msgAnchorTitle(m.content, idx) }] : [])),
    [messages])
  const jumpToAnchor = useCallback((idx: number) => {
    scrollRef.current?.querySelector(`[data-msg-idx="${idx}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])
  const onConvScroll = useCallback(() => {
    const c = scrollRef.current
    if (!c || anchors.length === 0) return
    const top = c.getBoundingClientRect().top
    let cur = 0
    anchors.forEach((a, i) => {
      const el = c.querySelector(`[data-msg-idx="${a.idx}"]`)
      if (el && el.getBoundingClientRect().top - top <= 90) cur = i
    })
    setActiveAnchor(cur)
  }, [anchors])
  useEffect(() => { setActiveAnchor(0) }, [activeId])

  // P3b：切会话时同步模型/思考强度控件到该会话的覆盖值（未覆盖=跟随全局默认）
  useEffect(() => {
    const ov = activeId ? convoLlm.current.get(activeId) : undefined
    setConvoModel(ov?.modelId ?? '')
    setConvoEffort(ov?.effort ?? 'off')
  }, [activeId])
  const effModel = convoModel || defaultModel
  const effModelBare = effModel.includes(':') ? effModel.slice(effModel.indexOf(':') + 1) : effModel
  useEffect(() => {
    if (!effModelBare) { setModelCapable(false); return }
    void llmReasoningCapable(effModelBare).then(setModelCapable).catch(() => setModelCapable(false))
  }, [effModelBare])
  useEffect(() => {
    // 换到不支持的模型 → 强度自动回「关闭」（整区禁用同屏已呈现）
    if (!modelCapable && convoEffort !== 'off') {
      setConvoEffort('off')
      const sid = activeIdRef.current
      const cur = sid ? convoLlm.current.get(sid) : undefined
      if (cur && sid) convoLlm.current.set(sid, { ...cur, effort: 'off' })
    }
  }, [modelCapable, convoEffort])
  const pickModel = (val: string): void => {
    const sid = activeIdRef.current
    if (!sid) return
    convoLlm.current.set(sid, { ...(convoLlm.current.get(sid) ?? {}), modelId: val })
    setConvoModel(val)
  }
  const pickEffort = (e: Effort): void => {
    const sid = activeIdRef.current
    if (!sid) return
    convoLlm.current.set(sid, { ...(convoLlm.current.get(sid) ?? {}), effort: e })
    setConvoEffort(e)
  }
  const openModelMenu = (): void => {
    if (!modelMenuOpen) void llmListProviders().then(res => setProviderList(res.providers ?? [])).catch(() => null)
    setModelMenuOpen(v => !v)
  }

  /** P3b「整理成文档」（§3.8-2）：本条回答落盘会话文件夹（懒建夹 2-5 + 幂等跳转 3-14 默认直出） */
  const organizeDocFor = async (content: string, idx: number, mid: string | undefined): Promise<void> => {
    const sid = activeIdRef.current
    if (!sid) return
    const key = mid ?? `idx${idx}`
    const existing = organized[key]
    if (existing) { void openDocView(existing); return } // P4 方案 B 入口②：已生成 → 中栏阅读
    const title = msgAnchorTitle(content, idx)
    const r = await aiTeachOrganizeDoc(sid, title, content).catch(() => null)
    if (r?.ok && r.relPath) {
      setOrganized(prev => ({ ...prev, [key]: r.relPath as string }))
      showToast({ type: 'info', message: `已生成文档：${r.relPath.split('/').pop()}（左栏/编辑器可见可改）` })
    } else {
      showToast({ type: 'error', message: `整理失败${r?.error ? `：${r.error}` : ''}` })
    }
  }
  const tokenStats = useMemo(() => {
    const all: AgentTraceStep[] = [...messages.flatMap(m => m.trace ?? []), ...liveSteps]
    let llmTokens = 0, llmRounds = 0, toolCalls = 0, durationMs = 0
    for (const s of all) {
      durationMs += s.durationMs || 0
      if (s.kind === 'llm') { llmRounds++; llmTokens += s.tokens ?? 0 } else { toolCalls++ }
    }
    return { llmTokens, llmRounds, toolCalls, durationMs }
  }, [messages, liveSteps])
  const monthTokens = usage?.monthTokens ?? 0
  const budget = usage?.budget ?? 0

  /** P7：中栏顶部「对话 ⇄ 题目」分段切换器（3-9 按 §六 L399 形态） */
  const chipCls = (on: boolean) => `px-2 py-1 rounded-md text-[11.5px] transition-colors ${on ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`
  const midChips = (
    <div className="shrink-0 flex items-center gap-1 px-3 pt-2 select-none">
      <button onClick={() => setMidView('chat')} className={chipCls(midView === 'chat')}>💬 对话</button>
      <button onClick={() => setMidView('quiz')} className={chipCls(midView === 'quiz')}>📝 题目{quizItems.length > 0 ? `（${quizItems.length}）` : ''}</button>
      {lastQuizReport && (
        <button onClick={() => { void openDocView(lastQuizReport.rel) }} title="中栏阅读最近一次测验报告"
          className="ml-auto text-[10.5px] px-1.5 py-0.5 rounded-md text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors truncate max-w-[220px]">
          🧾 最近测验 {lastQuizReport.score} · 报告 →
        </button>
      )}
    </div>
  )

  return (
    <div className="h-full flex flex-col min-h-0 bg-[var(--bg-primary)]">
      {/* P5（§3.2-6/页签即会话切换器）：顶栏 = 工作区 chip（返回选择页）+ 对话页签 + 新建任务 + 工具组 */}
      {activeWs ? (
      <>
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 shrink-0 select-none">
        <button onClick={exitToPicker} title="返回工作区选择页"
          className="shrink-0 flex items-center gap-1 max-w-[150px] px-1.5 py-0.5 rounded-md text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Folder size={12} className="shrink-0 text-[var(--accent)]" />
          <span className="truncate">{wsActive?.name ?? '工作区'}</span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto">
          {wsSessions.map(s => (
            <div key={s.id} onClick={() => { void openSession(s.id, s.title) }}
              title={s.id === activeId ? `当前对话：${activeTitle}` : s.title}
              className={`group shrink-0 flex items-center gap-1 px-2 h-[22px] rounded-md cursor-pointer text-[11.5px] transition-colors max-w-[160px] ${s.id === activeId ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] ring-1 ring-inset ring-[var(--accent)]/40' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
              {renamingId === s.id ? (
                <input autoFocus value={renameDraft} maxLength={40} onChange={e => setRenameDraft(e.target.value)}
                  onBlur={() => void commitRename(s.id)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commitRename(s.id) } else if (e.key === 'Escape') { e.stopPropagation(); setRenamingId(null) } }}
                  onClick={e => e.stopPropagation()}
                  className="w-24 px-1 py-0 rounded border border-[var(--accent)] bg-[var(--input-bg)] text-[11px] text-[var(--text-primary)] outline-none" />
              ) : (
                <>
                  <span className="truncate" title={s.title} onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameDraft(s.title) }}>{s.title}</span>
                  <button onClick={e => { e.stopPropagation(); void delSession(e, s.id, s.title) }} title="删除会话"
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-400 transition-opacity shrink-0"><X size={10} /></button>
                </>
              )}
            </div>
          ))}
          <div className="relative shrink-0">
            <button onClick={() => setShowNewMenu(v => !v)} title="新建任务"
              className="flex items-center px-1 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"><Plus size={13} /></button>
            {showNewMenu && (
              <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl z-20 overflow-hidden">
                {TEMPLATES.map(t => (
                  <button key={t.id} onClick={() => void newTask(t)}
                    className="w-full flex items-start gap-2 px-2.5 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors">
                    <span className="mt-0.5 text-[var(--accent)]">{t.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[12px] text-[var(--text-primary)]">{t.label}</span>
                      <span className="block text-[10.5px] text-[var(--text-muted)]">{t.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-0.5">

          {/* 会话要求（仅本会话生效的全局约束） */}
          <div className="relative shrink-0">
            <button
              onClick={() => { setInstrDraft(activeInstr); setInstrOpen(v => !v) }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] transition-colors ${activeInstr ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'} ${instrOpen ? 'bg-[var(--bg-hover)]' : ''}`}
              title="会话约束：写入本会话文件夹的 CONSTRAINTS.md，AI 每轮发送时重读（编辑器里可直接改）">
              <PenLine size={12} />
              <span className="max-w-[120px] truncate">会话要求</span>
              {activeInstr && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
            </button>
            {instrOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-[340px] z-30 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl overflow-hidden select-text">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  <span className="text-[11.5px] font-medium text-[var(--text-primary)]">本会话约束 · CONSTRAINTS.md</span>
                  <button onClick={() => setInstrOpen(false)} className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"><X size={12} /></button>
                </div>
                <div className="p-3 space-y-2">
                  <textarea
                    value={instrDraft}
                    onChange={e => setInstrDraft(e.target.value)}
                    rows={4} maxLength={2000}
                    placeholder={'例如：\n· 只用中文回答\n· 这个对话只聊 Linux 内核\n· 每次先给结论再展开\n（留空保存 = 清除）'}
                    className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] resize-none outline-none focus:border-[var(--accent)]"
                  />
                  {instrRel && <div className="text-[10.5px] text-[var(--text-muted)] px-0.5 truncate" title={instrRel}>落盘于：{instrRel}</div>}
                  <div className="flex gap-1 justify-end">
                    {activeInstr && (
                      <button onClick={() => { setInstrDraft(''); void saveInstr() }}
                        className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:text-red-400 transition-colors">
                        清除
                      </button>
                    )}
                    <button onClick={() => { void saveInstr() }}
                      className="px-1.5 py-0.5 rounded-md text-[11.5px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors">保存</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Token 消耗指示（默认收起；展开看本会话/月度明细） */}
          <div className="relative shrink-0">
            <button onClick={() => setTokenOpen(v => !v)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] transition-colors ${tokenOpen ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
              title="Token 消耗明细">
              <Gauge size={12} />
              <span className="tabular-nums">≈ {fmtTok(tokenStats.llmTokens)}</span>
            </button>
            {tokenOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-[300px] z-30 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl overflow-hidden select-text">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  <span className="text-[11.5px] font-medium text-[var(--text-primary)]">Token 明细</span>
                  <button onClick={() => setTokenOpen(false)} className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"><X size={12} /></button>
                </div>
                <div className="p-3 space-y-2.5 text-[11.5px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">模型</span>
                    <span className="text-[var(--text-primary)] truncate max-w-[190px]">{defaultModel || '（默认配置）'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">本会话 LLM tokens</span>
                    <span className="tabular-nums font-medium text-[var(--text-primary)]">{fmtTok(tokenStats.llmTokens)}{tokenStats.llmTokens >= 1000 ? `（${Math.round(tokenStats.llmTokens)}）` : ''}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    {[['模型轮次', String(tokenStats.llmRounds)], ['工具调用', String(tokenStats.toolCalls)], ['耗时', `${Math.round(tokenStats.durationMs / 1000)}s`]].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-[var(--bg-secondary)] py-1.5">
                        <div className="text-[10.5px] text-[var(--text-muted)]">{k}</div>
                        <div className="tabular-nums text-[12px] font-medium">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-[var(--border-color)] pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--text-muted)]">本月 LLM tokens</span>
                      <span className="tabular-nums">{fmtTok(monthTokens)}{budget > 0 && <span className="text-[var(--text-muted)]"> / {fmtTok(budget)}</span>}</span>
                    </div>
                    {budget > 0 ? (
                      <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (monthTokens / budget) * 100)}%`, background: monthTokens / budget > 0.85 ? '#a32d2d' : '#185fa5' }} />
                      </div>
                    ) : (
                      <div className="text-[10.5px] text-[var(--text-muted)]">未设月度预算（设置 → AI 工具 可配置上限）</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* P3b（§3.8-2/连锁）：顶栏「文档地图」退役——产物导航由逐条「整理成文档」+ P4 左栏资源管理器承接；
              顶栏恒为：会话要求 + Token 仪表 +（P5 工作区 chip）+ 禅模式 */}

          {/* 禅模式（唯一作用域 = 本模块）：一键窗口全屏 + 隐壳（标题栏/活动栏隐藏）；再点或 Esc 退出 */}
          {onZenLevelChange && (
            <button
              onClick={() => onZenLevelChange(zenLevel >= 1 ? 0 : 2)}
              title={zenLevel >= 1 ? '退出禅模式 (Esc)' : '禅模式 · 全屏沉浸'}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] transition-colors ${
                zenLevel >= 1
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Feather size={12} />
              {zenLevel >= 1 ? '退出禅' : '禅模式'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* 左栏（P4 §3.7）：VS Code 多分区——资源管理器 / 会话 / 任务规划；折叠贴靠（§3.9-1）状态记忆 */}
        <aside className={`shrink-0 border-r border-[var(--border-color)] flex flex-col min-h-0 bg-[var(--bg-secondary)] ${leftOpen ? 'w-[248px]' : 'w-[26px]'}`}>
          {!leftOpen ? (
            <button onClick={() => toggleSide('left')} title="展开侧边栏"
              className="h-8 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
              <PanelLeftOpen size={13} />
            </button>
          ) : (
            <>
              <SectionHead open={!collapsedSec.explorer} title="资源管理器" onToggle={() => toggleSec('explorer')} />
              {!collapsedSec.explorer && (
                <div className="flex-1 min-h-0 pb-1">
                  <AiTeachFileTree
                    subRel={wsTreeSeg}
                    activeRel={docView && docView.rel.startsWith(`${treeBase}/`) ? docView.rel.slice(treeBase.length + 1) : null}
                    onOpenMd={(rel) => { void openDocView(`${treeBase}/${rel}`) }}
                    onOpenExternal={(rel) => { window.dispatchEvent(new CustomEvent('kb-open-in-editor', { detail: { relPath: `${treeBase}/${rel}` } })) }}
                  />
                </div>
              )}

              {/* P5：会话列表区退役（§3.7「页签即会话切换器」）——切会话走顶栏页签条 */}

              <SectionHead open={!collapsedSec.plan} title="任务规划" onToggle={() => toggleSec('plan')} />
              {!collapsedSec.plan && (
                <div className={`shrink-0 p-2 border-t border-[var(--border-color)] ${collapsedSec.sessions && !collapsedSec.explorer ? '' : 'overflow-y-auto max-h-[40%]'}`}>
                  <div className="text-[11.5px] text-[var(--text-primary)] leading-relaxed">{template.goal}</div>
                  <div className="mt-2 space-y-1">
                    {template.steps.map((st, i) => (
                      <div key={st} className="flex items-center gap-1.5 text-[11.5px]">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${i === 0 && pending ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>{i + 1}</span>
                        <span className={i === 0 && pending ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}>{st}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="shrink-0 flex items-center border-t border-[var(--border-color)]">
                <button onClick={() => toggleSide('left')} title="折叠侧边栏"
                  className="h-6 flex items-center gap-1 px-2 text-[10.5px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
                  <PanelLeftClose size={11} /> 折叠侧栏
                </button>
              </div>
            </>
          )}
        </aside>

        {/* 中栏：阅读视图（P4 方案 B 接管） > 逐页阅读 > 对话流 */}
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          {docView ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] text-[11.5px] select-none">
                <button onClick={() => setDocView(null)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors shrink-0">
                  <ArrowLeft size={12} /> 返回对话
                </button>
                <FileText size={12} className="shrink-0 text-[var(--accent)]" />
                <span className="font-medium truncate text-[var(--text-primary)]" title={docView.rel}>{docView.name}</span>
                <span className="text-[10px] text-[var(--text-muted)] truncate hidden xl:inline">{docView.rel}</span>
                <button onClick={() => { const rel = docView.rel; window.dispatchEvent(new CustomEvent('kb-open-in-editor', { detail: { relPath: rel } })) }}
                  className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                  title="在编辑器标签页中打开（可编辑保存）">
                  <ExternalLink size={11} /> 在编辑器中打开 ↗
                </button>
              </div>
              <div className="flex-1 flex min-h-0">
                <div ref={docScrollRef} onScroll={e => { docScrollPos.current[docView.rel] = (e.target as HTMLDivElement).scrollTop }} className="flex-1 overflow-y-auto min-h-0">
                  <div className="max-w-[820px] mx-auto py-5 px-6">
                    <MarkdownPreview content={docView.content} />
                  </div>
                </div>
                {docOutline.length > 2 && (
                  <div className="w-[150px] shrink-0 border-l border-[var(--border-color)] overflow-y-auto py-2 hidden lg:block" title="文档大纲（h2/h3，点击定位）">
                    <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">大纲</div>
                    {docOutline.map((h, i) => (
                      <button key={`${h.id}-${i}`} onClick={() => { const el = docScrollRef.current?.querySelector(`[id="${CSS.escape(h.id)}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                        className={`block w-full text-left px-2.5 py-0.5 text-[10.5px] truncate text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors ${h.lv === 3 ? 'pl-5' : ''}`}
                        title={h.text}>{h.text}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : !reader && midView === 'quiz' ? (
            /* P7（§3.2-7）：题目视图——题目 = 对话回答里的 ```quiz 围栏协议块（QuizParser 解析） */
            <div className="flex-1 flex flex-col min-h-0 relative">
              {midChips}
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="max-w-[820px] mx-auto w-full px-4 py-4 space-y-2">
                  {quizItems.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="text-[13px] text-[var(--text-secondary)]">本对话还没有题目</div>
                      <div className="mt-1 text-[11.5px] text-[var(--text-muted)]">让 AI 在「对话」里出题（按测验协议自动收录到这里），或快捷发起：</div>
                      <div className="mt-4 flex items-center justify-center gap-2">
                        {['根据最近的讲解内容出 5 道选择题', '围绕本会话主题出 3 道基础题'].map(t => (
                          <button key={t} onClick={() => sendQuick(t)}
                            className="px-2.5 py-1 rounded-lg border border-[var(--border-color)] text-[11.5px] text-[var(--text-secondary)] hover:border-[var(--accent)]/60 hover:text-[var(--text-primary)] transition-colors">{t}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5">
                        <button onClick={() => setQuizOpen(true)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[12.5px] hover:opacity-90 transition-opacity">
                          <Presentation size={13} /> 开始答题（{quizItems.length} 题）
                        </button>
                        <span className="text-[10.5px] text-[var(--text-muted)]">自动判分、错题显示解析；交卷后成绩报告落会话文件夹</span>
                      </div>
                      {quizItems.map((q, i) => (
                        <div key={`${q.no}-${i}`} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2.5">
                          <div className="text-[12px] leading-relaxed text-[var(--text-primary)]">
                            <span className="text-[var(--text-muted)] mr-1.5 tabular-nums">{i + 1}.</span>
                            {q.question.split('\n')[0].slice(0, 140)}
                          </div>
                          <div className="mt-1 text-[10.5px] text-[var(--text-muted)]">选项 {q.options.map(o => o.key).join('/')}{q.points ? ` · ${q.points}` : ''} · 来自对话消息</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
              {quizOpen && activeId && quizItems.length > 0 && (
                <QuizMode
                  quizzes={quizItems}
                  pageTitle={activeTitle || '随堂测验'}
                  pageId={`aiTeach:${activeId}`}
                  onClose={() => setQuizOpen(false)}
                  onFinish={handleQuizFinish}
                />
              )}
            </div>
          ) : !reader ? (
            <>
              {midChips}
              {activeInstr && !instrDismiss && (
                <div className="shrink-0 flex items-center gap-2 mx-4 mt-2 px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[11px] text-[var(--text-secondary)]">
                  <PenLine size={11} className="shrink-0 text-[var(--accent)]" />
                  <span className="flex-1 min-w-0 truncate" title={activeInstr}><b className="font-medium text-[var(--text-primary)]">本会话要求：</b>{activeInstr}</span>
                  <button onClick={() => { setInstrOpen(true); setInstrDraft(activeInstr) }} className="shrink-0 text-[var(--accent)] hover:underline">编辑</button>
                  <button onClick={() => setInstrDismiss(true)} title="隐藏（不删除）" className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={11} /></button>
                </div>
              )}
              <div className="relative flex-1 min-h-0">
              <div ref={scrollRef} onScroll={onConvScroll} className="absolute inset-0 overflow-y-auto pl-4 pr-8 py-3 space-y-3 min-h-0">
                {messages.length === 0 && !pending && (
                  <div className="h-full flex items-center justify-center text-[12px] text-[var(--text-muted)]">开始对话</div>
                )}
                {messages.map((m, idx) => (
                  <div key={m.id ?? idx} data-msg-idx={idx} className={m.role === 'user' ? 'flex justify-end' : 'min-w-0'}>
                    {m.role === 'user' ? (
                      /* 用户消息保留右侧气泡（§3.8-3：仅 AI 回复去气泡） */
                      <div className="max-w-[86%] min-w-0 bg-[var(--accent)] text-white rounded-xl rounded-br-sm px-3.5 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap">{m.content}</div>
                    ) : (
                      /* P3a 去气泡：助手回复平铺 markdown 原生排版；P3b 轻量操作条（§3.8-3：整理成文档/复制/轨迹折叠） */
                      <div className="min-w-0">
                        <MarkdownPreview content={m.content} />
                        <div className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center gap-2.5">
                          <button onClick={() => { void organizeDocFor(m.content, idx, m.id) }}
                            className={`hover:underline ${organized[m.id ?? `idx${idx}`] ? 'text-[var(--accent)]' : ''}`}>
                            {organized[m.id ?? `idx${idx}`] ? '✓ 已生成文档 →' : '整理成文档'}
                          </button>
                          <button onClick={() => { void navigator.clipboard.writeText(m.content).then(() => showToast({ type: 'info', message: '已复制本条回答' })).catch(() => null) }}
                            className="hover:underline">复制</button>
                          <span className="text-[var(--text-muted)]">{fmtTime(m.createdAt)}</span>
                          {m.trace && m.trace.length > 0 && (
                            <details className="cursor-pointer select-none">
                              <summary className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">调用轨迹（{m.trace.length} 步）</summary>
                              <ul className="mt-1 space-y-0.5">
                                {m.trace.map((st, j) => (
                                  <li key={j} className="flex items-center gap-1 text-[10.5px]">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.ok ? 'bg-[var(--success)]' : 'bg-red-500'}`} />
                                    <Wrench size={9} className="shrink-0 text-[var(--text-muted)]" />
                                    <span className="truncate">{st.kind === 'tool' ? toolName(st.name) : '思考'}</span>
                                    <span className="ml-auto tabular-nums text-[var(--text-muted)]">{st.durationMs}ms{st.tokens ? ` · ${st.tokens}t` : ''}</span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {pending && (
                  <div className="flex justify-start">
                    <div className="max-w-[86%] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3.5 py-2.5 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <Loader2 size={13} className="animate-spin shrink-0" />
                      <span className="min-w-0">
                        {!lastStep ? '正在思考…'
                          : lastStep.kind === 'tool'
                            ? (lastStep.ok
                              ? <>正在调用 <span className="text-[var(--accent)]">{toolName(lastStep.name)}</span>（第 {toolCount} 次工具调用）</>
                              : <>执行 {toolName(lastStep.name)} 失败，正在调整…</>)
                            : <>思考中…（已调用 {toolCount} 次工具）</>}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
                </div>
                {/* 右缘快速定位条（§3.8-1，3-13）：每条回答一个刻度，hover 预览标题，点击滚动定位 */}
                {anchors.length > 1 && (
                  <div className="absolute right-1 top-2 bottom-2 w-3 flex flex-col items-center justify-evenly z-10">
                    {anchors.map((a, i) => (
                      <button key={a.idx} onClick={() => jumpToAnchor(a.idx)}
                        title={a.title}
                        className={`group relative w-1.5 rounded-full transition-all ${i === activeAnchor ? 'h-3 bg-[var(--accent)]' : 'h-1.5 bg-[var(--border-color)] hover:bg-[var(--text-muted)]'}`}>
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 hidden group-hover:block whitespace-nowrap max-w-[260px] truncate px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[10px] text-[var(--text-primary)] shadow z-20">{a.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-[var(--border-color)] p-2 bg-[var(--bg-secondary)]">
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void doSend() } }}
                  rows={2} placeholder="粘贴资料或输入指令…（Enter 发送）"
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] resize-none outline-none focus:border-[var(--accent)]" />
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1" />
                  {/* 模型 + 思考强度合一菜单（P3b R12/R14）：仅本对话生效 */}
                  <div className="relative">
                    <button onClick={openModelMenu}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                      title="本对话模型与思考强度（仅本对话生效，默认跟随 设置→AI 默认模型）">
                      <Bot size={11} />
                      <span className="max-w-[140px] truncate">{effModelBare || '默认'}</span>
                      {convoEffort !== 'off' && <span className="text-[var(--accent)]">· 🧠{EFFORT_LABEL[convoEffort]}</span>}
                      <ChevronRight size={10} className="-rotate-90 shrink-0" />
                    </button>
                    {modelMenuOpen && (
                      <div className="absolute bottom-full right-0 mb-1.5 w-[280px] z-30 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl overflow-hidden select-none">
                        <div className="px-3 py-1.5 text-[10.5px] text-[var(--text-muted)] bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">模型 · 仅本对话生效</div>
                        <div className="max-h-[220px] overflow-y-auto py-1">
                          {providerList.filter(p => p.enabled && p.models.length > 0).flatMap(p =>
                            p.models.map(mm => {
                              const val = `${p.id}:${mm}`
                              const sel = effModel === val
                              return (
                                <button key={val} onClick={() => pickModel(val)}
                                  className={`w-full flex items-center gap-1.5 px-3 py-1 text-left text-[11.5px] hover:bg-[var(--bg-hover)] transition-colors ${sel ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                                  <span className="text-[9.5px] text-[var(--text-muted)] shrink-0">{p.name}</span>
                                  <span className="truncate flex-1">{mm}</span>
                                  {sel && <span className="shrink-0">✓</span>}
                                </button>
                              )
                            }))}
                          {providerList.filter(p => p.enabled && p.models.length > 0).length === 0 && (
                            <div className="px-3 py-3 text-[11px] text-[var(--text-muted)]">尚无启用的供应商（设置 → AI 模型中添加）</div>
                          )}
                        </div>
                        <div className="px-3 pt-1.5 flex items-center justify-between border-t border-[var(--border-color)] bg-[var(--bg-secondary)]">
                          <span className="text-[10.5px] text-[var(--text-muted)]">思考强度</span>
                          {!modelCapable && <span className="text-[10px] text-[var(--text-muted)]">当前模型不支持</span>}
                        </div>
                        <div className={`flex gap-1 px-3 py-2 bg-[var(--bg-secondary)] ${modelCapable ? '' : 'opacity-40 pointer-events-none'}`}>
                          {(['off', 'low', 'medium', 'high'] as const).map(e => (
                            <button key={e} onClick={() => pickEffort(e)}
                              className={`flex-1 px-1 py-0.5 rounded-md text-[11px] transition-colors ${convoEffort === e ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
                              {EFFORT_LABEL[e]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* P3b（R12）：流式输出中发送键 → 停止键（深色底白方块），点击中断、保留已落库内容 */}
                  {pending ? (
                    <button onClick={() => { void agentAbort(chatIdRef.current) }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-80 transition-opacity"
                      title="停止生成（已完成的轮次保留）">
                      <span className="w-2 h-2 rounded-[2px] bg-current shrink-0" /> 停止
                    </button>
                  ) : (
                    <button onClick={() => { void doSend() }} disabled={!input.trim()}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors">
                      <Send size={12} /> 发送
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* 幻灯片逐页阅读（素材 .pptx）：reader 激活时占用中栏（P3a 起为对话流的二选一视图） */
            <div className="flex flex-col min-h-0">
              <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-[var(--border-color)] text-[11.5px]">
                <Presentation size={12} className="text-[var(--text-muted)] shrink-0" />
                <span className="font-medium truncate">{reader.name}</span>
                <span className="text-[var(--text-muted)] shrink-0">素材阅读</span>
                <span className="flex-1" />
                <span className="text-[var(--text-muted)] tabular-nums shrink-0">第 {reader.cur + 1} / {reader.pages.length} 页</span>
                <button onClick={() => goPage(-1)} disabled={reader.cur === 0}
                  className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors" title="上一页">
                  <ChevronLeft size={13} />
                </button>
                <button onClick={() => goPage(1)} disabled={reader.cur >= reader.pages.length - 1}
                  className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors" title="下一页">
                  <ChevronRight size={13} />
                </button>
                <button onClick={() => { void talkCurrentPage() }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors shrink-0">
                  讲解此页
                </button>
                <button onClick={() => setReader(null)} className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors shrink-0" title="关闭">
                  <X size={13} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="max-w-[860px] mx-auto py-4 px-5">
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-4 min-h-[260px]">
                    <div className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] mb-3">
                      第 {reader.cur + 1} 页 · 原文编号 {reader.pages[reader.cur]?.n}
                    </div>
                    {reader.pages[reader.cur]?.text?.trim() ? (
                      <pre className="whitespace-pre-wrap break-words font-[var(--font-sans)] text-[13px] leading-relaxed">{reader.pages[reader.cur]?.text}</pre>
                    ) : (
                      <div className="text-[12px] text-[var(--text-muted)]">（本页无文字内容——多为图表演示页）</div>
                    )}
                  </div>
                  <div className="flex justify-between mt-3">
                    <button onClick={() => goPage(-1)} disabled={reader.cur === 0}
                      className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">
                      ← 上一页
                    </button>
                    <button onClick={() => { void talkCurrentPage() }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors">
                      让 AI 讲这一页
                    </button>
                    <button onClick={() => goPage(1)} disabled={reader.cur >= reader.pages.length - 1}
                      className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">
                      下一页 →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 右栏（P4 可收放记忆）：资料 / 产物 / 改动 */}
        <aside className={`shrink-0 border-l border-[var(--border-color)] flex flex-col min-h-0 bg-[var(--bg-secondary)] ${rightOpen ? 'w-[280px] overflow-y-auto' : 'w-[26px]'}`}>
          {!rightOpen ? (
            <button onClick={() => toggleSide('right')} title="展开右栏"
              className="h-8 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
              <PanelRightOpen size={13} />
            </button>
          ) : (
          <>
          <div className="shrink-0">
            <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] shrink-0 select-none">
              <span title="工作区 SOURCES/{对话}/SOURCE.md（§3.13 素材库结构 v3）">素材库{srcEntries.length > 0 ? `（${srcEntries.length}）` : ''}</span>
              <div className="ml-auto flex items-center gap-1">
                {srcFileRel && (
                  <button onClick={() => { void openDocView(srcFileRel) }} title="中栏阅读 SOURCE.md"
                    className="px-1 py-0.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors">SOURCE</button>
                )}
                <button onClick={() => activeId && setSrcForm({ name: '', type: 'pdf', path: '', storage: '已入库', rangeFrom: '', rangeTo: '', note: '' })}
                  disabled={!activeId} title={activeId ? '添加素材（写入 SOURCE.md）' : '先选择对话'}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors">
                  <Plus size={11} /> 素材
                </button>
              </div>
            </div>
            {srcEntries.length > 0 ? (
              <div className="p-2 space-y-1">
                {srcEntries.map(e => {
                  const extMatch = /^✓\s*→\s*(.+)$/.exec(e.extracted)
                  const dirRel = srcFileRel ? srcFileRel.slice(0, srcFileRel.lastIndexOf('/')) : ''
                  const extractable = (e.type === 'pdf' || e.type === 'pptx') && !extMatch && e.range && e.range !== '-'
                  const inRepo = e.path.startsWith('./') || (srcFileRel && !/^[a-zA-Z]:|^https?:|^\//.test(e.path))
                  return (
                    <div key={e.no} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-[10px] font-medium text-[var(--text-muted)]">#{e.no}</span>
                        <span className="flex-1 min-w-0 truncate text-[11.5px] text-[var(--text-primary)]" title={e.note || e.name}>{e.name}</span>
                        <span className="shrink-0 px-1 rounded text-[9.5px] uppercase text-[var(--text-muted)] border border-[var(--border-color)]">{e.type}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10.5px] text-[var(--text-muted)]">
                        {e.range && e.range !== '-' && <span title="页码区间">p{e.range}</span>}
                        <span title={e.path}>{e.storage === '已入库' ? '已入库' : (e.path.startsWith('http') ? '链接' : '引用')}</span>
                        <div className="ml-auto flex items-center gap-1.5">
                          {extMatch && dirRel && (
                            <button onClick={() => { void openDocView(`${dirRel}/${extMatch[1].trim()}`) }} title="阅读提取稿（可编辑）"
                              className="text-[var(--accent)] hover:opacity-80 transition-opacity">提取稿 ✓</button>
                          )}
                          {extractable && (
                            <button onClick={() => { void doExtract(e.no) }} disabled={srcBusy === e.no}
                              className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors">
                              {srcBusy === e.no ? <Loader2 size={9} className="animate-spin" /> : <BookOpen size={9} />}{srcBusy === e.no ? '提取中…' : '提取'}
                            </button>
                          )}
                          {inRepo && e.path.startsWith('./') && dirRel && e.type === 'pptx' && (
                            <button onClick={() => { void openPptxReader(`${dirRel}/${e.path.slice(2)}`, e.name) }} title="逐页阅读原件"
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">原件</button>
                          )}
                          <button onClick={() => { void doRemoveSrc(e.no, e.name) }} title="移除登记（不删文件）"
                            className="text-[var(--text-muted)] hover:text-red-400 transition-colors"><X size={10} /></button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)] leading-relaxed">
                {activeId ? '本对话还没登记素材。\n点右上「＋ 素材」登记，或在对话里让 AI 按 SOURCE.md 模板登记。' : '先选择一个对话。'}
              </div>
            )}
          </div>
          <div className="shrink-0">
            <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] shrink-0 select-none">
              <span>资料来源{sources.length > 0 ? `（${sources.length}）` : ''}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <span className="relative">
                  <button onClick={() => { if (!pickOpen) void refreshPptxList(); setPickOpen(v => !v) }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
                    <Plus size={11} /> PPT 素材
                  </button>
                  {pickOpen && (
                    <div className="absolute right-0 top-full mt-1 w-60 z-30 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl overflow-hidden">
                      <div className="px-2.5 py-1.5 border-b border-[var(--border-color)] text-[10.5px] text-[var(--text-muted)]">从当前仓库选 .pptx</div>
                      <div className="max-h-52 overflow-y-auto py-1">
                        {pickLoading ? (
                          <div className="px-2.5 py-2 text-[11px] text-[var(--text-muted)] flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> 扫描仓库…</div>
                        ) : pickList.length === 0 ? (
                          <div className="px-2.5 py-2 text-[11px] text-[var(--text-muted)]">未找到 .pptx</div>
                        ) : (
                          pickList.map(p => (
                            <button key={p.rel} onClick={() => { void addSourceFromPick(p.rel, p.name) }}
                              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[11.5px] hover:bg-[var(--bg-hover)] transition-colors">
                              <Presentation size={11} className="shrink-0 text-[var(--accent)]" />
                              <span className="truncate">{p.rel}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </span>
              </div>
            </div>
            {sources.length > 0 ? (
              <div className="p-2">
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden">
                  {sources.map(s => {
                    const active = reader?.rel === s.rel
                    return (
                      <div key={s.rel} className={`flex items-center gap-1.5 px-2 py-1 text-[11.5px] ${active ? 'bg-[var(--bg-hover)]' : ''}`}>
                        <button onClick={() => { void openPptxReader(s.rel, s.name) }} title="逐页阅读"
                          className={`flex-1 min-w-0 flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity ${active ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                          <Presentation size={11} className="shrink-0 text-[var(--accent)]" />
                          <span className="truncate">{s.name}</span>
                          {active && <span className="text-[10px] text-[var(--text-muted)] shrink-0">阅读中 {reader!.cur + 1}/{reader!.pages.length}</span>}
                        </button>
                        {active && !pending && (
                          <button onClick={() => { void talkCurrentPage() }} title="让 AI 讲当前页"
                            className="shrink-0 text-[11px] text-[var(--accent)] px-1 py-0.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors">讲解</button>
                        )}
                        <button onClick={() => removeSource(s.rel)} title="移除"
                          className="shrink-0 text-[var(--text-muted)] hover:text-red-400 transition-colors"><X size={11} /></button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">暂无素材</div>
            )}
          </div>
          <div className="shrink-0 pb-2">
            <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] shrink-0 select-none">产物</div>
            <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">暂无产物</div>
          </div>
          <div className="shrink-0 pb-2">
            <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] shrink-0 select-none">本次改动{lastChanges ? `（${lastChanges.length}）` : ''}</div>
            {lastChanges && lastChanges.length > 0 ? (
              <div className="p-2">
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden">
                  <ul className="py-1 max-h-40 overflow-y-auto">
                    {lastChanges.map((c, i) => (
                      <li key={i}>
                        {c.file ? (
                          <button onClick={() => window.dispatchEvent(new CustomEvent('kb-open-in-editor', { detail: { relPath: c.file } }))}
                            title="在编辑器中打开"
                            className="w-full flex items-center gap-1.5 px-2.5 py-1 text-left text-[11.5px] group hover:bg-[var(--bg-hover)] transition-colors">
                            <FileText size={10} className="shrink-0 text-[var(--accent)]" />
                            <span className="shrink-0 text-[var(--accent)]">{c.action}</span>
                            <span className="truncate text-[var(--text-primary)]">{c.target}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11.5px]">
                            <FileText size={10} className="shrink-0 text-[var(--text-muted)]" />
                            <span className="shrink-0 text-[var(--accent)]">{c.action}</span>
                            <span className="truncate text-[var(--text-secondary)]">{c.target}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">本轮暂无写入改动</div>
            )}
          </div>
          <div className="flex-1" />
          <div className="p-2 shrink-0 flex items-center justify-between">
            <button onClick={() => { if (activeId && !pending) { setMessages([]); void refreshMessages(activeId) } }}
              className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors text-left">
              刷新当前会话
            </button>
            <button onClick={() => toggleSide('right')} title="折叠右栏"
              className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
              <PanelRightClose size={12} />
            </button>
          </div>
          </>
          )}
        </aside>
      </div>
      </>
      ) : (
      /* P5：工作区选择页（进入模块首屏；3-7 未拍板 → 按验收条款每次先见选择页 + 「继续上次工作区」快捷入口） */
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 py-12">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Sparkles size={16} className="text-[var(--accent)]" />
            <span className="text-[12px] tracking-wide">AI教学</span>
          </div>
          <h1 className="mt-3 text-[22px] font-semibold text-[var(--text-primary)]">选择工作区</h1>
          <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)] leading-relaxed">一个工作区 = 一门课程或一个主题，内含多个对话。工作区跟随当前仓库，元数据存仓库 <code className="px-1 rounded bg-[var(--bg-hover)] text-[11.5px]">.knowbase/modules/aiTeaching/</code>。</p>
          {lastWsId && wsList.find(w => w.id === lastWsId) && (
            <button onClick={() => enterWs(lastWsId)}
              className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[12.5px] text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors">
              <ArrowLeft size={12} className="rotate-180" /> 继续上次工作区「{wsList.find(w => w.id === lastWsId)?.name}」
            </button>
          )}
          <div className="mt-6 flex items-center gap-2">
            <div className="flex-1 relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={wsSearch} onChange={e => setWsSearch(e.target.value)} placeholder="搜索工作区…"
                className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
            </div>
            <button onClick={() => setWsModal({ mode: 'create', value: '' })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[12.5px] hover:opacity-90 transition-opacity"><Plus size={12} /> 新建工作区</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {wsFiltered.map(w => (
              <div key={w.id} onClick={() => enterWs(w.id)}
                className="group relative rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 cursor-pointer hover:border-[var(--accent)]/50 transition-colors"
                title={w.folderRel}>
                <div className="flex items-center gap-2 min-w-0">
                  <Folder size={14} className="shrink-0 text-[var(--accent)]" />
                  <span className="text-[14px] font-medium text-[var(--text-primary)] truncate">{w.name}</span>
                  {w.id === lastWsId && <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">上次</span>}
                </div>
                <div className="mt-2 text-[11.5px] text-[var(--text-muted)]">{w.sessionCount} 个对话 · {w.docCount} 个产物 · 最近活跃 {wsAgo(w.lastActive)}</div>
                <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setWsModal({ mode: 'rename', id: w.id, value: w.name })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"><PenLine size={11} /> 改名</button>
                  <button onClick={() => void removeWs(w)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-[var(--text-secondary)] hover:text-red-400 transition-colors"><Trash2 size={11} /> 删除</button>
                </div>
              </div>
            ))}
            <button onClick={() => setWsModal({ mode: 'create', value: '' })}
              className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-left cursor-pointer hover:border-[var(--accent)]/60 transition-colors">
              <div className="flex items-center gap-2 text-[var(--text-muted)]"><Plus size={14} /><span className="text-[14px] font-medium">新建工作区</span></div>
              <div className="mt-2 text-[11.5px] text-[var(--text-muted)]">如「数学冲刺」「英语精读」，一个课程/主题一个</div>
            </button>
            {wsFiltered.length === 0 && wsSearch.trim() && (
              <div className="col-span-2 py-6 text-center text-[12px] text-[var(--text-muted)]">没有匹配「{wsSearch.trim()}」的工作区</div>
            )}
          </div>
          <div className="mt-8 text-[11px] text-[var(--text-muted)] leading-relaxed">
            对话产物目录：<code className="px-1 rounded bg-[var(--bg-hover)]">{treeBase}/{'{MM-DD 会话标题}'}/</code>；删除工作区只解除归属，文件夹与对话保留。
          </div>
        </div>
        {wsModal && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setWsModal(null)}>
            <div className="w-80 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="mb-2 text-[13px] font-medium text-[var(--text-primary)]">{wsModal.mode === 'create' ? '新建工作区' : '工作区改名'}</div>
              <input autoFocus value={wsModal.value} maxLength={40} onChange={e => setWsModal({ ...wsModal, value: e.target.value })}
                placeholder="课程或主题名，如：数学冲刺"
                className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                onKeyDown={e => { if (e.key === 'Enter') void submitWsModal(); if (e.key === 'Escape') setWsModal(null) }} />
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setWsModal(null)} className="rounded-md px-3 py-1 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">取消</button>
                <button onClick={() => void submitWsModal()} className="rounded-md bg-[var(--accent)] px-3 py-1 text-[12.5px] text-white hover:opacity-90">{wsModal.mode === 'create' ? '创建并进入' : '改名'}</button>
              </div>
            </div>
          </div>
        )}
        {/* P6 添加素材表单（§3.13 拍板：字段对齐模板；页码区间仅 pdf/pptx 且拆起止双输入） */}
        {srcForm && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setSrcForm(null)}>
            <div className="w-[430px] max-w-[92vw] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="mb-1 text-[13px] font-medium text-[var(--text-primary)]">添加素材（登记进 SOURCE.md）</div>
              <div className="mb-3 truncate text-[10.5px] text-[var(--text-muted)]" title={srcFileRel ?? ''}>{srcFileRel ?? '首次登记时自动创建于工作区 SOURCES/ 下'}</div>
              <div className="space-y-2.5 text-[12.5px] text-[var(--text-primary)]">
                <div className="flex items-center gap-2">
                  <label className="w-[52px] shrink-0 text-right text-[11.5px] text-[var(--text-secondary)]">名称 *</label>
                  <input autoFocus value={srcForm.name} maxLength={60} onChange={e => setSrcForm({ ...srcForm, name: e.target.value })} placeholder="如：一次函数课件"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12.5px] outline-none focus:border-[var(--accent)]"
                    onKeyDown={e => { if (e.key === 'Escape') setSrcForm(null) }} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-[52px] shrink-0 text-right text-[11.5px] text-[var(--text-secondary)]">类型</label>
                  <select value={srcForm.type} onChange={e => setSrcForm({ ...srcForm, type: e.target.value })}
                    className="rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]">
                    {['pdf', 'pptx', 'url', 'image', 'md', 'other'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="ml-2 shrink-0 text-[11.5px] text-[var(--text-secondary)]">存放</label>
                  <select value={srcForm.storage} onChange={e => setSrcForm({ ...srcForm, storage: e.target.value === '已入库' ? '已入库' : '仅引用', path: '' })}
                    className="rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]">
                    <option value="已入库">已入库（拷贝原件）</option>
                    <option value="仅引用">仅引用（记路径）</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-[52px] shrink-0 text-right text-[11.5px] text-[var(--text-secondary)]">{srcForm.storage === '已入库' ? '文件' : '地址'}</label>
                  {srcForm.storage === '已入库' ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <button onClick={() => void pickSrcFile()} className="shrink-0 rounded-md border border-[var(--border-color)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">浏览…</button>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]" title={srcForm.path}>{srcForm.path || '未选择文件'}</span>
                    </div>
                  ) : (
                    <input value={srcForm.path} onChange={e => setSrcForm({ ...srcForm, path: e.target.value })} placeholder={srcForm.type === 'url' ? 'https://…' : '仓库内相对路径 / 绝对路径'}
                      className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12.5px] outline-none focus:border-[var(--accent)]" />
                  )}
                </div>
                {(srcForm.type === 'pdf' || srcForm.type === 'pptx') && (
                  <div className="flex items-center gap-2">
                    <label className="w-[52px] shrink-0 text-right text-[11.5px] text-[var(--text-secondary)]">页码</label>
                    <input value={srcForm.rangeFrom} inputMode="numeric" onChange={e => setSrcForm({ ...srcForm, rangeFrom: e.target.value.replace(/\D/g, '') })} placeholder="起始页"
                      className="w-[72px] rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]" />
                    <span className="text-[var(--text-muted)]">–</span>
                    <input value={srcForm.rangeTo} inputMode="numeric" onChange={e => setSrcForm({ ...srcForm, rangeTo: e.target.value.replace(/\D/g, '') })} placeholder="结束页"
                      className="w-[72px] rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]" />
                    <span className="text-[10.5px] text-[var(--text-muted)]">登记后可一键出提取稿</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label className="w-[52px] shrink-0 text-right text-[11.5px] text-[var(--text-secondary)]">备注</label>
                  <input value={srcForm.note} maxLength={80} onChange={e => setSrcForm({ ...srcForm, note: e.target.value })} placeholder="可选（如章节说明）"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12.5px] outline-none focus:border-[var(--accent)]"
                    onKeyDown={e => { if (e.key === 'Enter') void submitSrcForm() }} />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-muted)]">确定=程序解析模板写入文件（3-28）</span>
                <div className="flex gap-2">
                  <button onClick={() => setSrcForm(null)} className="rounded-md px-3 py-1 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">取消</button>
                  <button onClick={() => void submitSrcForm()} disabled={!srcForm.name.trim()}
                    className="rounded-md bg-[var(--accent)] px-3 py-1 text-[12.5px] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">确定登记</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
