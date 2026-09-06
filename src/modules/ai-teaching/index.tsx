import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, X, Send, Loader2, Bot, FileText, Wrench, Plus, Trash2, BookOpen, Compass, CalendarClock, Gauge, PenLine, Presentation, ChevronLeft, ChevronRight, Feather } from 'lucide-react'
import {
  agentSessions, agentNewSession, agentMessages, agentDeleteSession,
  agentChat, agentAbort, onAgentStep, llmGetUsage, getSettingRaw, agentSetSessionInstructions,
  workspaceGetCurrent, workspaceListDir, docsPptxPages,
  agentRenameSession, aiTeachEnsureSessionFolder, aiTeachSessionFolder, aiTeachRenameSessionFolder, aiTeachDeleteSessionFolder, aiTeachReadConstraints, aiTeachWriteConstraints, onAiTeachNotice,
} from '../../lib/ipc'
import { showToast } from '../../lib/toast'
import { showGlobalConfirm } from '../../lib/globalConfirm'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'
import type { AgentSessionInfo, AgentStoredMessage, AgentTraceStep, AgentChange, AgentChatResult, LlmUsageInfo } from '../../types'

/**
 * 「AI教学」模块（原 id immersive / 沉浸式 Agent；总纲 docs/ai-teaching-module-rework.md，
 * 历史设计 docs/agent-immersive-mode-design.md M0 骨架）
 * 独立全屏 Tab（五区布局），与轻问答共用 AgentRunner 会话库与 agent:step 推送。
 * 已实现：会话列表/新建任务（场景模板）/发送/回复渲染/实时步骤/轨迹折叠/改动清单可跳编辑器/文档视图；
 * P1 会话⇄文件夹绑定：新建对话即建 `{MM-DD} 标题` 文件夹（.session.json 锚点）、重命名同步改夹、
 * 删除会话按 aiTeachDeleteSessionFolder（ask/keep/delete）处理文件夹（进系统回收站）。
 * 占位（M1）：素材管理、产物草稿与写入、步骤引擎自动推进、diff 视图。
 */

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
  const [view, setView] = useState<'timeline' | 'doc'>('timeline')
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
    if (list.length > 0) {
      const cur = activeIdRef.current ? list.find(s => s.id === activeIdRef.current) : undefined
      const first = cur ?? list[0]
      setActiveId(first.id)
      setActiveTitle(first.title)
      setInstrDismiss(false)
      void loadConstraints(first.id, first.instructions ?? '')
    } else {
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
    const r = await agentChat(sid, raw, undefined, cid)
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
    // P1（2-2）：新建对话确认即建会话文件夹（懒建语义下空会话也不删）
    void aiTeachEnsureSessionFolder(row.id).then(r => {
      if (r && !r.ok && r.error) showToast({ type: 'error', message: `会话文件夹创建失败：${r.error}` })
    })
    setTemplate(tpl)
    setActiveId(row.id); setActiveTitle(row.title)
    activeIdRef.current = row.id
    setMessages([]); setLastChanges(null); setShowNewMenu(false); setActiveInstr(''); setInstrRel(''); setInstrDismiss(false)
    // P2：模板播种（_templates/CONSTRAINTS.md 存在时）→ 建夹完成后立刻载入展示
    void aiTeachEnsureSessionFolder(row.id).then(async () => { await loadConstraints(row.id, '') })
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    void sendText(tpl.opening, cid)
    void refreshSessions()
  }, [sendText, refreshSessions, loadConstraints])

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
    setView('doc')
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
    setView('timeline')
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
  const assistantMsgs = messages.filter(m => m.role === 'assistant')
  const docMsg = assistantMsgs[assistantMsgs.length - 1]
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

  return (
    <div className="h-full flex flex-col min-h-0 bg-[var(--bg-primary)]">
      {/* 顶栏：任务标题/模板 + 视图切换 */}
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 shrink-0 select-none">
        <Sparkles size={12} className="text-[var(--text-muted)] shrink-0" />
        <span className="text-[11.5px] font-medium text-[var(--text-muted)] truncate">{activeTitle || 'AI教学'}</span>
        <span className="text-[11.5px] text-[var(--text-muted)] px-1.5 py-0.5 rounded-md bg-[var(--bg-hover)] truncate">{template.label}</span>
        <div className="ml-auto flex items-center gap-0.5">

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

          <div className="flex items-center gap-0.5">
            {(['timeline', 'doc'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2 py-0.5 rounded-md text-[11.5px] transition-colors ${view === v ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}>
                {v === 'timeline' ? '时间线' : '文档视图'}
              </button>
            ))}
          </div>

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
        {/* 左栏：任务规划 + 会话 */}
        <aside className="w-[248px] shrink-0 border-r border-[var(--border-color)] flex flex-col min-h-0 bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] shrink-0 select-none">任务规划</div>
          <div className="p-2 border-b border-[var(--border-color)] shrink-0">
            <div className="text-[11.5px] text-[var(--text-primary)] leading-relaxed max-h-16 overflow-hidden">{template.goal}</div>
            <div className="mt-2 space-y-1">
              {template.steps.map((st, i) => (
                <div key={st} className="flex items-center gap-1.5 text-[11.5px]">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${i === 0 && pending ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>{i + 1}</span>
                  <span className={i === 0 && pending ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}>{st}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] shrink-0 select-none">
            <span>会话（{sessions.length}）</span>
            <div className="ml-auto flex items-center gap-0.5">
              <div className="relative">
                <button onClick={() => setShowNewMenu(v => !v)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
                  <Plus size={12} /> 新建任务
                </button>
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
          </div>
          <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-0.5">
            {sessions.map(s => (
              <div key={s.id}
                onClick={() => { void openSession(s.id, s.title) }}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${s.id === activeId ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
                <Bot size={12} className={s.id === activeId ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                <span className="flex-1 min-w-0">
                  {renamingId === s.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      maxLength={40}
                      onChange={e => setRenameDraft(e.target.value)}
                      onBlur={() => void commitRename(s.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitRename(s.id) }
                        else if (e.key === 'Escape') { e.stopPropagation(); setRenamingId(null) }
                      }}
                      onClick={e => e.stopPropagation()}
                      className="w-full px-1 py-0.5 rounded border border-[var(--accent)] bg-[var(--input-bg)] text-[12px] text-[var(--text-primary)] outline-none"
                    />
                  ) : (
                    <span
                      className="block text-[12px] truncate text-[var(--text-primary)]"
                      title="双击重命名（会话文件夹同步改名）"
                      onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameDraft(s.title) }}
                    >{s.title}</span>
                  )}
                </span>
                <button onClick={e => { void delSession(e, s.id, s.title) }}
                  className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-400 transition-opacity">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">暂无会话</div>
            )}
          </div>
        </aside>

        {/* 中栏：对话 / 文档 */}
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          {view === 'timeline' ? (
            <>
              {activeInstr && !instrDismiss && (
                <div className="shrink-0 flex items-center gap-2 mx-4 mt-2 px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[11px] text-[var(--text-secondary)]">
                  <PenLine size={11} className="shrink-0 text-[var(--accent)]" />
                  <span className="flex-1 min-w-0 truncate" title={activeInstr}><b className="font-medium text-[var(--text-primary)]">本会话要求：</b>{activeInstr}</span>
                  <button onClick={() => { setInstrOpen(true); setInstrDraft(activeInstr) }} className="shrink-0 text-[var(--accent)] hover:underline">编辑</button>
                  <button onClick={() => setInstrDismiss(true)} title="隐藏（不删除）" className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={11} /></button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
                {messages.length === 0 && !pending && (
                  <div className="h-full flex items-center justify-center text-[12px] text-[var(--text-muted)]">开始对话</div>
                )}
                {messages.map((m, idx) => (
                  <div key={m.id ?? idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[86%] min-w-0 ${m.role === 'user' ? 'bg-[var(--accent)] text-white rounded-xl rounded-br-sm px-3.5 py-2' : ''}`}>
                      {m.role === 'assistant' && (
                        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3.5 py-2.5">
                          <MarkdownPreview content={m.content} />
                          <div className="text-[10px] text-[var(--text-muted)] mt-1.5 flex items-center gap-3">
                            <span>{fmtTime(m.createdAt)}</span>
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
                      {m.role === 'user' && <span className="text-[13px] leading-relaxed break-words">{m.content}</span>}
                    </div>
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
                      <button onClick={() => { void agentAbort(chatIdRef.current) }}
                        className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-red-400 transition-colors shrink-0">
                        停止
                      </button>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <div className="shrink-0 border-t border-[var(--border-color)] p-2 bg-[var(--bg-secondary)]">
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void doSend() } }}
                  rows={2} placeholder="粘贴资料或输入指令…（Enter 发送）"
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] resize-none outline-none focus:border-[var(--accent)]" />
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1" />
                  <button onClick={() => { void doSend() }} disabled={pending || !input.trim()}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11.5px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors">
                    {pending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} 发送
                  </button>
                </div>
              </div>
            </>
          ) : reader ? (
            /* 幻灯片逐页阅读（素材 .pptx） */
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
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              {docMsg ? (
                <div className="max-w-[880px] mx-auto py-4 px-5">
                  <div className="text-[11.5px] text-[var(--text-muted)] mb-2">文档视图</div>
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-4">
                    <MarkdownPreview content={docMsg.content} />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[12px] text-[var(--text-muted)]">尚无助手回复</div>
              )}
            </div>
          )}
        </section>

        {/* 右栏：资料 / 产物 / 改动 */}
        <aside className="w-[280px] shrink-0 border-l border-[var(--border-color)] flex flex-col min-h-0 overflow-y-auto bg-[var(--bg-secondary)]">
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
          <div className="p-2 shrink-0">
            <button onClick={() => { if (activeId && !pending) { setMessages([]); void refreshMessages(activeId) } }}
              className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors text-left">
              刷新当前会话
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
