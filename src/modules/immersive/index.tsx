import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, X, Send, Loader2, Bot, FileText, Wrench, Plus, Trash2, BookOpen, Compass, CalendarClock, Gauge, PenLine } from 'lucide-react'
import {
  agentSessions, agentNewSession, agentMessages, agentDeleteSession,
  agentChat, agentAbort, onAgentStep, llmGetUsage, getSettingRaw, agentSetSessionInstructions,
} from '../../lib/ipc'
import { showToast } from '../../lib/toast'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'
import type { AgentSessionInfo, AgentStoredMessage, AgentTraceStep, AgentChange, AgentChatResult, LlmUsageInfo } from '../../types'

/**
 * 沉浸式 Agent 模式（docs/agent-immersive-mode-design.md，M0 骨架）
 * 独立全屏 Tab（五区布局），与轻问答共用 AgentRunner 会话库与 agent:step 推送。
 * 已实现：会话列表/新建任务（场景模板）/发送/回复渲染/实时步骤/轨迹折叠/改动清单可跳编辑器/文档视图。
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

export function ImModule({ isActive }: { isActive?: boolean }) {
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
  const [activeIdRef, chatIdRef] = [useRef<string | null>(null), useRef('')]
  const bottomRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef(liveSteps)

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { liveRef.current = liveSteps }, [liveSteps])

  const refreshSessions = useCallback(async () => {
    const list = await agentSessions().catch(() => [])
    setSessions(list)
    if (list.length > 0) {
      const cur = activeIdRef.current ? list.find(s => s.id === activeIdRef.current) : undefined
      const first = cur ?? list[0]
      setActiveId(first.id)
      setActiveTitle(first.title)
      setActiveInstr(first.instructions ?? '')
      setInstrDismiss(false)
    } else {
      setActiveId(null)
      setActiveInstr('')
    }
  }, [])

  const refreshMessages = useCallback(async (sid: string) => {
    const rows = await agentMessages(sid).catch(() => [] as AgentStoredMessage[])
    setMessages(rows.map(m => ({
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
      trace: m.traceJson ? (() => { try { return JSON.parse(m.traceJson) as AgentTraceStep[] } catch { return undefined } })() : undefined,
    })))
  }, [])

  // 打开沉浸 Tab 时同步会话
  useEffect(() => { void refreshSessions() }, [refreshSessions, isActive])

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
    setActiveInstr(row?.instructions ?? '')
    setInstrDismiss(false)
    await refreshMessages(sid)
  }, [refreshMessages, sessions])

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
    setTemplate(tpl)
    setActiveId(row.id); setActiveTitle(row.title)
    activeIdRef.current = row.id
    setMessages([]); setLastChanges(null); setShowNewMenu(false); setActiveInstr(''); setInstrDismiss(false)
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    void sendText(tpl.opening, cid)
    void refreshSessions()
  }, [sendText, refreshSessions])

  /** 保存/清除当前会话的全局要求（仅本会话后续轮次生效） */
  const saveInstr = async (): Promise<void> => {
    const sid = activeIdRef.current
    if (!sid) return
    const text = instrDraft.trim().slice(0, 800)
    const r = await agentSetSessionInstructions(sid, text).catch(() => null)
    if (r && r.ok) {
      setActiveInstr(text); setInstrDismiss(false); setInstrOpen(false)
      setSessions(prev => prev.map(s => (s.id === sid ? { ...s, instructions: text } : s)))
      showToast({ type: 'info', message: text ? '已设置本会话要求（仅本会话生效）' : '已清除本会话要求' })
    } else {
      showToast({ type: 'error', message: '保存失败，请重试' })
    }
  }

  const delSession = useCallback(async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation()
    await agentDeleteSession(sid).catch(() => null)
    if (activeIdRef.current === sid) { setActiveId(null); setMessages([]); activeIdRef.current = null }
    void refreshSessions()
  }, [refreshSessions])

  const toolCount = liveSteps.filter(s => s.kind === 'tool').length
  const lastStep = liveSteps[liveSteps.length - 1]
  const assistantMsgs = messages.filter(m => m.role === 'assistant')
  const docMsg = assistantMsgs[assistantMsgs.length - 1]

  // ---- Token 消耗统计（来自消息轨迹 llm.tokens 与实时步骤；月度走 llm:getUsage）----
  const [usage, setUsage] = useState<LlmUsageInfo | null>(null)
  const [defaultModel, setDefaultModel] = useState('')
  const [tokenOpen, setTokenOpen] = useState(false)
  // 会话级全局要求（仅本会话；056 迁移 + agent:setSessionInstructions）
  const [activeInstr, setActiveInstr] = useState('')
  const [instrOpen, setInstrOpen] = useState(false)
  const [instrDraft, setInstrDraft] = useState('')
  const [instrDismiss, setInstrDismiss] = useState(false)
  useEffect(() => {
    void llmGetUsage().then(setUsage).catch(() => null)
    void getSettingRaw('defaultChatModel').then(v => setDefaultModel(String(v ?? ''))).catch(() => {})
  }, [])
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
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
        <Sparkles size={15} className="text-[var(--accent)] shrink-0" />
        <span className="text-[13px] font-medium truncate">{activeTitle || '沉浸式 Agent'}</span>
        <span className="text-[11px] text-[var(--text-muted)] px-2 py-0.5 rounded-full bg-[var(--bg-hover)] truncate">{template.label}</span>
        <div className="flex-1" />

        {/* 会话要求（仅本会话生效的全局约束） */}
        <div className="relative shrink-0">
          <button
            onClick={() => { setInstrDraft(activeInstr); setInstrOpen(v => !v) }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] transition-colors ${activeInstr ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'} ${instrOpen ? 'bg-[var(--bg-primary)] border border-[var(--border-color)]' : ''}`}
            title="本会话要求：给这个对话挂一条只对它生效的全局要求（如：只用中文 / 只聊这个主题 / 先结论后理由）">
            <PenLine size={12} />
            <span className="max-w-[120px] truncate">{activeInstr ? '会话要求' : '会话要求'}</span>
            {activeInstr && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
          </button>
          {instrOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-[340px] z-30 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <span className="text-[11.5px] font-medium text-[var(--text-primary)]">本会话要求</span>
                <button onClick={() => setInstrOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={12} /></button>
              </div>
              <div className="p-3 space-y-2">
                <textarea
                  value={instrDraft}
                  onChange={e => setInstrDraft(e.target.value)}
                  rows={4} maxLength={800}
                  placeholder={'例如：\n· 只用中文回答\n· 这个对话只聊 Linux 内核\n· 每次先给结论再展开\n（留空保存 = 清除）'}
                  className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] resize-none outline-none focus:border-[var(--accent)]"
                />
                <div className="text-[10.5px] leading-relaxed text-[var(--text-muted)]">仅对本会话生效：后续问答与「重新生成」都会遵守；切换会话互不影响。</div>
                <div className="flex gap-2 justify-end">
                  {activeInstr && (
                    <button onClick={() => { setInstrDraft(''); void saveInstr() }}
                      className="px-2.5 py-1 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-red-400 hover:border-red-400/50 transition-colors text-[12px]">
                      清除
                    </button>
                  )}
                  <button onClick={() => { void saveInstr() }}
                    className="px-3 py-1 rounded-lg bg-[var(--accent)] text-white text-[12px] hover:opacity-90 transition-opacity">保存</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Token 消耗指示（默认收起；展开看本会话/月度明细） */}
        <div className="relative shrink-0">
          <button onClick={() => setTokenOpen(v => !v)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] transition-colors ${tokenOpen ? 'bg-[var(--bg-primary)] text-[var(--accent)] border border-[var(--border-color)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'}`}
            title="Token 消耗明细">
            <Gauge size={12} />
            <span className="tabular-nums">≈ {fmtTok(tokenStats.llmTokens)}</span>
          </button>
          {tokenOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-[300px] z-30 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <span className="text-[11.5px] font-medium text-[var(--text-primary)]">Token 明细</span>
                <button onClick={() => setTokenOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={12} /></button>
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
                <div className="text-[10px] leading-relaxed text-[var(--text-muted)] border-t border-[var(--border-color)] pt-2">
                  tokens 取自每轮模型调用的 usage 与消息轨迹；上下文占用随轮次累积（模型容量条 M1 随模型规格元数据接入）。
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 text-[12px]">
          {(['timeline', 'doc'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded-md transition-colors ${view === v ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-color)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              {v === 'timeline' ? '时间线' : '文档视图'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* 左栏：任务规划 + 会话 */}
        <aside className="w-[248px] shrink-0 border-r border-[var(--border-color)] flex flex-col min-h-0 bg-[var(--bg-secondary)]">
          <div className="p-2.5 border-b border-[var(--border-color)]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">任务规划</span>
              <span className="text-[10px] text-[var(--text-muted)]">M1 自动推进</span>
            </div>
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

          <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
            <span className="text-[11px] text-[var(--text-muted)]">会话（{sessions.length}）</span>
            <div className="relative">
              <button onClick={() => setShowNewMenu(v => !v)}
                className="flex items-center gap-1 text-[11.5px] text-[var(--accent)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors">
                <Plus size={11} /> 新建任务
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
          <div className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-0.5">
            {sessions.map(s => (
              <div key={s.id}
                onClick={() => { void openSession(s.id, s.title) }}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${s.id === activeId ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
                <Bot size={12} className={s.id === activeId ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] truncate text-[var(--text-primary)]">{s.title}</span>
                </span>
                <button onClick={e => { void delSession(e, s.id) }}
                  className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-400 transition-opacity">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="text-[11.5px] text-[var(--text-muted)] px-2 py-3 text-center">暂无会话，点上方「新建任务」开始</div>
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
                  <div className="h-full flex flex-col items-center justify-center text-center gap-1.5">
                    <Sparkles size={26} className="text-[var(--accent)]" />
                    <div className="text-[13px] text-[var(--text-primary)]">{template.label}</div>
                    <div className="text-[11.5px] text-[var(--text-muted)] max-w-sm">{template.goal}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">在下方输入资料链接 / 仓库内文件名，或直接描述任务</div>
                  </div>
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
                        className="px-1.5 py-0.5 rounded border border-[var(--border-color)] hover:text-red-400 hover:border-red-400/50 transition-colors shrink-0">
                        停止
                      </button>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <div className="shrink-0 border-t border-[var(--border-color)] p-2.5 bg-[var(--bg-secondary)]">
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void doSend() } }}
                  rows={2} placeholder="粘贴资料链接、或说「仓库里讲 XX 的笔记读给我听」…（Enter 发送，Shift+Enter 换行）"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] resize-none outline-none focus:border-[var(--accent)]" />
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10.5px] text-[var(--text-muted)]">素材 {lastChanges?.length ? '+改动' : ''} · 每次对话 AI 改动会在右侧「本次改动」列出并可直接打开</span>
                  <div className="flex-1" />
                  <button onClick={() => { void doSend() }} disabled={pending || !input.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[12px] hover:opacity-90 disabled:opacity-40 transition-opacity">
                    {pending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 发送
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              {docMsg ? (
                <div className="max-w-[880px] mx-auto py-4 px-5">
                  <div className="text-[11px] text-[var(--text-muted)] mb-2">文档视图 · 最近一条助手回复全文（长文/方案在此整篇审阅）</div>
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
        <aside className="w-[280px] shrink-0 border-l border-[var(--border-color)] flex flex-col gap-2.5 p-2.5 overflow-y-auto bg-[var(--bg-secondary)]">
          <div>
            <div className="text-[11px] text-[var(--text-muted)] mb-1">资料来源</div>
            <div className="rounded-lg border border-dashed border-[var(--border-color)] px-2.5 py-3 text-center text-[11px] text-[var(--text-muted)]">
              会话中贴的网址 / 仓库文件将在此汇总并标记读取状态<br />（素材管理 M1 开放）
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text-muted)] mb-1">产物</div>
            <div className="rounded-lg border border-dashed border-[var(--border-color)] px-2.5 py-3 text-center text-[11px] text-[var(--text-muted)]">
              AI 拟好的笔记/方案草稿将在此预览并可一键写入知识库<br />（写入链路已就绪，产物提取 M1 开放）
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text-muted)] mb-1">本次改动 {lastChanges ? `（${lastChanges.length}）` : ''}</div>
            {lastChanges && lastChanges.length > 0 ? (
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
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border-color)] px-2.5 py-3 text-center text-[11px] text-[var(--text-muted)]">本轮暂无写入改动</div>
            )}
          </div>
          <div className="flex-1" />
          <button onClick={() => { if (activeId && !pending) { setMessages([]); void refreshMessages(activeId) } }}
            className="text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-left">
            刷新当前会话
          </button>
        </aside>
      </div>
    </div>
  )
}
