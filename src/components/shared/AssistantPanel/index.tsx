import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Sparkles, X, Menu, Plus, Trash2, Loader2, Wrench, Bot, FileText, Copy, Check, Square,
  Pencil, RefreshCw, Languages,
} from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { getAssistantContext } from '../../../lib/assistantContext'
import { showToast } from '../../../lib/toast'
import { MarkdownPreview } from '../MarkdownPreview'
import { TranslateCard } from '../TranslateCard'
import {
  agentSessions, agentNewSession, agentMessages, agentDeleteSession,
  agentChat, agentRegenerate, agentEditMessage, agentDeleteMessage,
  llmListProviders, copyText, agentAbort,
} from '../../../lib/ipc'
import type { AgentSessionInfo, AgentStoredMessage, AgentTraceStep, AgentContextInfo } from '../../../types'

/**
 * 全局 AI 助手侧栏（方案 B）：任意界面 Ctrl+J / 右下角按钮唤起，
 * 会话留存 + 上下文感知（正在查看的知识库页面自动附带）。
 * 拖拽左缘调宽；拖到 320px 以下松手 = 整体关闭（snap），不会误触下层模块侧栏。
 */

/** 选区矩形（viewport 坐标），供翻译卡片智能定位 */
interface SelRect { left: number; top: number; right: number; bottom: number }

interface UiMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  trace?: AgentTraceStep[]
  createdAt?: string
}

function nowLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 落库消息 → UI 消息（保留 id 供编辑/删除/重新生成定位） */
function toUi(m: AgentStoredMessage): UiMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    trace: m.traceJson ? (() => { try { return JSON.parse(m.traceJson) as AgentTraceStep[] } catch { return undefined } })() : undefined,
  }
}

/** 'YYYY-MM-DD HH:MM:SS' → 今天只显示 HH:mm，更早显示 MM-DD HH:mm */
function fmtTime(raw?: string | null): string {
  if (!raw) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(raw)
  if (!m) return raw.slice(5, 16)
  const d = new Date()
  const sameDay = Number(m[1]) === d.getFullYear() && Number(m[2]) === d.getMonth() + 1 && Number(m[3]) === d.getDate()
  return sameDay ? `${m[4]}:${m[5]}` : `${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}

export function AssistantPanel() {
  const { s, update } = useSettings()
  const [open, setOpen] = useState(false)
  // 动画三态: mounted=DOM 存在(含退场动画期间), shown=滑入到位
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 抽屉动画三态
  const [drawerMounted, setDrawerMounted] = useState(false)
  const [drawerShown, setDrawerShown] = useState(false)
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([])
  const [providersOk, setProvidersOk] = useState<boolean | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragW, setDragW] = useState<number | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  /** 行内编辑用户消息：目标消息 id + 草稿 */
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  /** 选中文本即问：浮动按钮状态与一次性选中上下文 */
  const [selFloat, setSelFloat] = useState<{ x: number; y: number; rect: SelRect; text: string } | null>(null)
  const [selCtx, setSelCtx] = useState<AgentContextInfo | null>(null)
  /** 划词翻译卡片（与「问 AI」浮钮共用选区检测） */
  const [transFloat, setTransFloat] = useState<{ rect: SelRect; text: string } | null>(null)
  /** 会话抽屉卸载兜底定时器（closeDrawer 240ms 后触发） */
  const drawerTimerRef = useRef<number | null>(null)
  const chatIdRef = useRef<string>('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const ctxVersionRef = useRef(0)
  /** 当前会话 id 的实时镜像：回复返回时判断用户是否已切换会话 */
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const savedWidth = Math.min(520, Math.max(320, Number(s.assistantWidth ?? 380)))
  // 拖拽中的实时宽度；低于 320 属于"拖拽关闭"区间，松手即关
  const width = dragW ?? savedWidth
  const snapClosing = dragW !== null && dragW < 320

  const openPanel = useCallback(() => {
    setMounted(true)
    setOpen(true)
    // 双 rAF 确保首帧以关闭位渲染, 再过渡到打开位
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
    setDrawerOpen(false); setDrawerMounted(false); setDrawerShown(false)
  }, [])

  // 卸载时清理抽屉定时器
  useEffect(() => {
    return () => {
      if (drawerTimerRef.current !== null) window.clearTimeout(drawerTimerRef.current)
    }
  }, [])

  const openDrawer = useCallback(() => {
    // 取消尚未触发的关闭卸载定时器，避免重开抽屉被旧定时器卸载
    if (drawerTimerRef.current !== null) {
      window.clearTimeout(drawerTimerRef.current)
      drawerTimerRef.current = null
    }
    setDrawerMounted(true)
    setDrawerOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setDrawerShown(true)))
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setDrawerShown(false) // 滑出动画后卸载 DOM
    // Tailwind v4 用 translate 属性过渡，transitionend 的 propertyName 是
    // 'translate' 而非 'transform'，依赖事件卸载会永久残留（透明遮罩挡住消息区
    // 导致滚轮/点击失效），改用定时器兜底卸载
    if (drawerTimerRef.current !== null) window.clearTimeout(drawerTimerRef.current)
    drawerTimerRef.current = window.setTimeout(() => {
      setDrawerMounted(false)
      drawerTimerRef.current = null
    }, 240)
  }, [])

  const closePanel = useCallback(() => {
    setOpen(false)
    setShown(false) // onTransitionEnd 后卸载 DOM
    closeDrawer()
  }, [closeDrawer])

  const toggleDrawer = useCallback(() => {
    if (drawerOpen) closeDrawer()
    else openDrawer()
  }, [drawerOpen, openDrawer, closeDrawer])

  // Ctrl+J 全局开关
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        if (open) closePanel()
        else openPanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openPanel, closePanel])

  // 主体卡片内 AI 按钮 → ai-assistant:toggle 事件（与 Ctrl+J 同一套开关逻辑）
  useEffect(() => {
    const onToggle = () => { if (open) closePanel(); else openPanel() }
    window.addEventListener('ai-assistant:toggle', onToggle)
    return () => window.removeEventListener('ai-assistant:toggle', onToggle)
  }, [open, openPanel, closePanel])

  // 检查是否有可用模型供应商（决定引导态）——每次打开面板时重新检查，
  // 避免用户先开面板、后去设置配好模型回来仍显示「未配置」的过期状态
  useEffect(() => {
    if (!open) return
    llmListProviders()
      .then(r => setProvidersOk(r.providers.some(p => p.enabled && p.models.length > 0)))
      .catch(() => setProvidersOk(false))
  }, [open])

    const refreshSessions = useCallback(async () => {
    try { setSessions(await agentSessions()) } catch { /* ignore */ }
  }, [])

useEffect(() => { if (open) void refreshSessions() }, [open, refreshSessions])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pending, drawerShown])

  /** 以会话库为准刷新消息（发送/重新生成/编辑/删除后统一走这里，拿到落库 id 与 trace） */
  const refreshMessages = useCallback(async (sid: string) => {
    if (activeIdRef.current !== sid) return
    try {
      const rows: AgentStoredMessage[] = await agentMessages(sid)
      if (activeIdRef.current === sid) setMessages(rows.map(toUi))
    } catch { /* keep current */ }
  }, [])

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id)
    closeDrawer()
    try {
      const rows: AgentStoredMessage[] = await agentMessages(id)
      setMessages(rows.map(toUi))
    } catch { setMessages([]) }
  }, [])

  const newSession = useCallback(async () => {
    const sRow = await agentNewSession().catch(() => null)
    if (!sRow) return
    setSessions(prev => [sRow, ...prev])
    setActiveId(sRow.id)
    setMessages([])
    closeDrawer()
  }, [])

  const removeSession = async (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id)
      setTimeout(() => setDeletingId(cur => (cur === id ? null : cur)), 3000)
      return
    }
    setDeletingId(null)
    await agentDeleteSession(id)
    setSessions(prev => prev.filter(x => x.id !== id))
    if (activeId === id) { setActiveId(null); setMessages([]) }
  }

  // 选中文本即问：mouseup 捕获主内容区（面板外）的非折叠选区 → 浮动按钮
  useEffect(() => {
    const onMouseUp = () => {
      setTimeout(() => {
        try {
          const sel = window.getSelection()
          const text = sel?.toString().trim() ?? ''
          if (!sel || sel.isCollapsed || !text || text.length < 2 || text.length > 2000) { setSelFloat(null); return }
          // 面板内部的选择不触发
          const anchorEl = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
          if (anchorEl?.closest('#assistant-panel-root')) { setSelFloat(null); return }
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          if (!rect || (rect.width === 0 && rect.height === 0)) { setSelFloat(null); return }
          setSelFloat({
            x: Math.min(rect.right + 8, window.innerWidth - 170),
            y: Math.min(rect.bottom + 6, window.innerHeight - 44),
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            text,
          })
        } catch { setSelFloat(null) }
      }, 10)
    }
    const onClear = (e?: Event) => {
      const target = e?.target as Element | undefined
      if (target?.closest?.('[data-sel-float]')) return // 点浮动按钮本身不清除
      setSelFloat(null)
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onClear as EventListener)
    window.addEventListener('scroll', onClear, true)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onClear as EventListener)
      window.removeEventListener('scroll', onClear, true)
    }
  }, [])

  /** 从选中片段发起提问 */
  const askSelection = useCallback((text: string) => {
    window.getSelection()?.removeAllRanges()
    setSelFloat(null)
    setSelCtx({ type: 'selection', label: `选中片段「${text.slice(0, 24)}${text.length > 24 ? '…' : ''}」`, data: { text } })
    openPanel()
    setTimeout(() => inputRef.current?.focus(), 120)
  }, [openPanel])

  /** 从选中片段发起翻译（携带选区矩形，卡片据此智能定位） */
  const translateSelection = useCallback((pos: { rect: SelRect }, text: string) => {
    window.getSelection()?.removeAllRanges()
    setSelFloat(null)
    setTransFloat({ rect: pos.rect, text })
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    // 排队请求不静默丢弃：明确告知正在回复中（可点停止）
    if (pending) {
      showToastSafe('正在回复上一条消息，请等待完成或点击「停止」', 'info')
      return
    }
    let sid = activeId
    if (!sid) {
      const sRow = await agentNewSession().catch(() => null)
      if (!sRow) return
      sid = sRow.id
      setActiveId(sid)
    }
    const ctx = selCtx ?? getAssistantContext()
    setMessages(prev => [...prev, { role: 'user', content: text, createdAt: nowLocal() }])
    setInput('')
    setPending(true)
    ctxVersionRef.current++
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    try {
      const r = await agentChat(sid, text, ctx ?? undefined, cid)
      // 用户在等待期间切换了会话：回复已落库，但不注入当前视图
      if (activeIdRef.current !== sid) {
        showToastSafe('回复已保存到原会话，可在会话列表中查看', 'info')
        return
      }
      if (r.ok && r.reply !== undefined) {
        if (selCtx) setSelCtx(null) // 选中上下文一次性消费
      } else if (r.code === 'ABORTED') {
        showToast({ type: 'info', message: '已停止生成' })
      } else {
        showToastSafe(`AI 调用失败：${r.error ?? '未知错误'}`)
      }
      // 以会话库为准刷新（拿到落库 id/trace；中止时仅剩用户消息也保持一致）
      await refreshMessages(sid)
    } finally {
      setPending(false)
      void refreshSessions()
    }
  }, [input, pending, activeId, refreshSessions, selCtx, refreshMessages])

  /** 重新生成最后一条回复（末条为助手消息时可用） */
  const runRegenerate = useCallback(async () => {
    const sid = activeId
    if (!sid || pending) return
    if (messages.length === 0 || messages[messages.length - 1].role !== 'assistant') return
    setPending(true)
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    try {
      const r = await agentRegenerate(sid, getAssistantContext() ?? undefined, cid)
      if (r.code === 'ABORTED') showToast({ type: 'info', message: '已停止生成' })
      else if (!r.ok) showToastSafe(`重新生成失败：${r.error ?? '未知错误'}`)
      await refreshMessages(sid)
    } finally {
      setPending(false)
      void refreshSessions()
    }
  }, [activeId, pending, messages, refreshMessages, refreshSessions])

  /** 改写用户消息并重推其后回复 */
  const runEdit = useCallback(async (messageId: string, content: string) => {
    const sid = activeId
    if (!sid || pending) return
    setEditing(null)
    setPending(true)
    const cid = crypto.randomUUID()
    chatIdRef.current = cid
    try {
      const r = await agentEditMessage(sid, messageId, content, getAssistantContext() ?? undefined, cid)
      if (r.code === 'ABORTED') showToast({ type: 'info', message: '已停止生成' })
      else if (!r.ok) showToastSafe(`修改失败：${r.error ?? '未知错误'}`)
      await refreshMessages(sid)
    } finally {
      setPending(false)
      void refreshSessions()
    }
  }, [activeId, pending, refreshMessages, refreshSessions])

  /** 删除单条消息（助手消息删除后可用「重新生成」补回） */
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    const sid = activeId
    if (!sid) return
    await agentDeleteMessage(messageId)
    await refreshMessages(sid)
  }, [activeId, refreshMessages])

  const ctx = open ? getAssistantContext() : null

  return (
    <>
      {/* 悬浮入口已移至主体卡片内（App.tsx 渲染，相对主体定位，任务栏展开不遮挡）。
          主体按钮点击时派发 ai-assistant:toggle，由下方 useEffect 统一处理 */}

      {/* 选中文本浮动按钮：主内容区框选任意文字后出现（问 AI / 翻译） */}
      {selFloat && (
        <div
          data-sel-float
          className="fixed z-50 flex items-center gap-0.5 rounded-md bg-[var(--accent)] text-white shadow-lg overflow-hidden"
          style={{ left: selFloat.x, top: selFloat.y }}
          onMouseDown={e => e.preventDefault()}
        >
          <button
            onClick={() => askSelection(selFloat.text)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] hover:bg-black/10 transition-colors"
          >
            <Sparkles size={11} /> 问 AI
          </button>
          <span className="w-px self-stretch bg-white/30" />
          <button
            onClick={() => translateSelection(selFloat, selFloat.text)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] hover:bg-black/10 transition-colors"
          >
            <Languages size={11} /> 翻译
          </button>
        </div>
      )}

      {/* 划词翻译卡片 */}
      {transFloat && (
        <TranslateCard
          rect={transFloat.rect}
          text={transFloat.text}
          onClose={() => setTransFloat(null)}
        />
      )}

      {/* 侧栏面板 */}
      {open && (
        <div
          id="assistant-panel-root"
          className={`fixed z-40 top-[48px] bottom-10 right-0 flex flex-col bg-[var(--bg-primary)] border-l border-[var(--border-color)] shadow-2xl transition-opacity ${snapClosing ? 'opacity-60' : ''}`}
          style={{ width }}
        >
          {/* 头部 */}
          <div className="h-9 shrink-0 px-2.5 flex items-center gap-1 border-b border-[var(--border-color)]">
            <button onClick={toggleDrawer} title="会话列表"
              className={`p-1.5 rounded-md transition-colors ${drawerOpen ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}>
              <Menu size={14} />
            </button>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)]">
              <Sparkles size={13} className="text-[var(--accent)]" /> AI 助手
            </span>
            <button onClick={() => setOpen(false)} title="收起 (Ctrl+J)"
              className="ml-auto p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative flex">
            {/* 消息区 */}
            <div className="flex-1 min-w-0 flex flex-col">
              {providersOk === false ? (
                <NoProviderHint onGoSettings={() => { setOpen(false); window.dispatchEvent(new CustomEvent('settings:open', { detail: { section: 'aiTools', aiTab: 'models' } })) }} />
              ) : (
                <>
                  {/* 抽屉容器：仅包住消息列表，不遮挡上下文徽章与输入框 */}
                  <div className="flex-1 min-h-0 relative">
                    {/* 遮罩：点击空白处收起抽屉 */}
                    {drawerMounted && (
                      <div
                        className={`absolute inset-0 z-[5] bg-black/20 transition-opacity duration-200 ${drawerShown ? 'opacity-100' : 'opacity-0'}`}
                        onClick={closeDrawer}
                      />
                    )}
                    {drawerMounted && (
                      <div
                        className={`absolute inset-y-0 left-0 w-52 z-10 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col transition-transform duration-200 ease-out ${drawerShown ? 'translate-x-0' : '-translate-x-full'}`}
                      >
                        <button onClick={() => { void newSession() }}
                          className="flex items-center gap-1.5 m-2 px-2.5 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
                          <Plus size={12} /> 新会话
                        </button>
                        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
                          {sessions.map(sess => (
                            <div key={sess.id}
                              onClick={() => { void loadSession(sess.id) }}
                              className={`group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-[12px] transition-colors ${
                                activeId === sess.id ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                              }`}>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{sess.title}</span>
                                <span className="block text-[10px] text-[var(--text-disabled)]">{fmtTime(sess.updatedAt)}</span>
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); void removeSession(sess.id) }}
                                className={`shrink-0 p-0.5 rounded ${deletingId === sess.id ? 'text-red-400' : 'text-[var(--text-disabled)] opacity-0 group-hover:opacity-100 hover:text-red-400'}`}
                                title={deletingId === sess.id ? '再点一次确认删除' : '删除会话'}>
                                <Trash2 size={11} />
                              </button>
                            </div>
                          ))}
                          {sessions.length === 0 && (
                            <p className="text-[11px] text-[var(--text-muted)] text-center pt-3">暂无历史会话</p>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="h-full overflow-y-auto px-3 py-3 space-y-2">
                    {messages.length === 0 && !pending && (
                      <div className="pt-8 text-center text-[12px] text-[var(--text-muted)] leading-relaxed px-4">
                        在这里可以直接询问你正在查看的内容。<br />
                        例如打开一篇知识库页面后问：「总结一下这一页」。
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={m.id ?? `live-${i}`} className="group/msg">
                        {m.role === 'assistant' ? (
                          <div className="mr-6 px-3 py-2 rounded-lg text-[12px] leading-relaxed break-words select-text cursor-text bg-[var(--bg-secondary)] border border-[var(--border-color)] [&_.prose-content>:first-child]:mt-0 [&_.prose-content>:last-child]:mb-0 [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_table]:block [&_table]:overflow-x-auto">
                            <MarkdownPreview content={m.content} />
                          </div>
                        ) : (
                          <div className="ml-6 px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap break-words select-text cursor-text bg-[var(--bg-selected)] border border-[var(--border-color)]">
                            {m.content}
                          </div>
                        )}
                        {editing != null && editing.id != null && editing.id === m.id ? (
                          <div className="ml-6 mt-1 space-y-1.5">
                            <textarea
                              value={editing.draft}
                              onChange={e => setEditing({ ...editing, draft: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (editing.draft.trim()) void runEdit(m.id!, editing.draft.trim()) } }}
                              rows={3}
                              autoFocus
                              className="w-full px-2.5 py-2 rounded-md border border-[var(--accent)] bg-[var(--input-bg)] text-[12px] resize-none outline-none"
                            />
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => { if (editing.draft.trim()) void runEdit(m.id!, editing.draft.trim()) }}
                                className="px-2 py-0.5 rounded text-[11px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">保存并重新生成</button>
                              <button onClick={() => setEditing(null)}
                                className="px-2 py-0.5 rounded text-[11px] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">取消</button>
                            </div>
                          </div>
                        ) : (
                          <div className={`flex items-center gap-1.5 px-1 mt-0.5 text-[10px] text-[var(--text-disabled)] ${m.role === 'user' ? 'justify-end ml-6' : 'justify-start mr-6'}`}>
                            {m.createdAt && <span>{fmtTime(m.createdAt)}</span>}
                            <button
                              onClick={async () => {
                                const okFlag = await copyText(m.content)
                                if (okFlag) {
                                  setCopiedIdx(i)
                                  setTimeout(() => setCopiedIdx(cur => (cur === i ? null : cur)), 1500)
                                } else showToastSafe('复制失败')
                              }}
                              className={`flex items-center gap-0.5 transition-opacity hover:text-[var(--text-primary)] ${copiedIdx === i ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'}`}
                              title="复制">
                              {copiedIdx === i ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                              {copiedIdx === i ? '已复制' : '复制'}
                            </button>
                            {m.role === 'user' && m.id && !pending && (
                              <button onClick={() => setEditing({ id: m.id!, draft: m.content })}
                                className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity hover:text-[var(--text-primary)]"
                                title="编辑并重新生成">
                                <Pencil size={10} /> 编辑
                              </button>
                            )}
                            {m.role === 'assistant' && i === messages.length - 1 && !pending && m.id && (
                              <button onClick={() => { void runRegenerate() }}
                                className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity hover:text-[var(--text-primary)]"
                                title="重新生成">
                                <RefreshCw size={10} /> 重新生成
                              </button>
                            )}
                            {m.role === 'assistant' && m.id && !pending && (
                              <button onClick={() => { void handleDeleteMessage(m.id!) }}
                                className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity hover:text-red-400"
                                title="删除该回复">
                                <Trash2 size={10} /> 删除
                              </button>
                            )}
                          </div>
                        )}
                        {m.trace && m.trace.length > 0 && <TraceBlock steps={m.trace} />}
                      </div>
                    ))}
                    {pending && (
                      <div className="mr-6 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                        <Loader2 size={13} className="animate-spin" />
                        <span className="flex-1">思考与调用工具中…</span>
                        <button
                          onClick={() => { void agentAbort(chatIdRef.current) }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-red-400 hover:border-red-400/50 transition-colors shrink-0"
                          title="中断当前请求与工具循环">
                          <Square size={9} className="fill-current" /> 停止
                        </button>
                      </div>
                    )}
                    <div ref={bottomRef} />
                    </div>
                  </div>

                  {/* 上下文徽章（选中文本优先，可清除） */}
                  {(selCtx || ctx) && (
                    <div className="px-3 pb-1 shrink-0">
                      <span className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-md bg-[var(--bg-selected)] border border-[var(--border-color)] text-[11px] text-[var(--text-secondary)]">
                        <FileText size={10} className="shrink-0 text-[var(--accent)]" />
                        <span className="truncate">{(selCtx ?? ctx)!.label}</span>
                        <span className="text-[var(--text-disabled)]">·将随提问附带</span>
                        {selCtx && (
                          <button onClick={() => setSelCtx(null)} title="移除选中上下文"
                            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                            <X size={10} />
                          </button>
                        )}
                      </span>
                    </div>
                  )}

                  {/* 输入区 */}
                  <div className="p-2.5 shrink-0 flex items-end gap-2 border-t border-[var(--border-color)]">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                      rows={2}
                      placeholder="问问任何事…(Enter 发送)"
                      className="flex-1 px-2.5 py-2 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] resize-none outline-none focus:border-[var(--accent)]"
                    />
                    <button onClick={() => { void send() }} disabled={pending || !input.trim()}
                      className="p-2 rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
                      {pending ? <Loader2 size={14} className="animate-spin" /> : <SendIcon />}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 宽度拖拽条：向左拖缩小；低于 320px 松手 = 整体关闭（snap）
              面板为悬浮层且置顶，打开期间本拖拽条独占该边缘，
              不会误触下层（如知识库大纲侧栏）的拖拽条 */}
          <div
            className="absolute top-0 left-[-3px] w-1.5 h-full cursor-ew-resize hover:bg-[var(--accent)]/30"
            onMouseDown={e => {
              e.preventDefault()
              const startX = e.clientX
              const startW = savedWidth
              let latest = startW
              const move = (ev: MouseEvent) => {
                latest = Math.min(520, Math.max(260, startW + (startX - ev.clientX)))
                setDragW(latest)
              }
              const up = () => {
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
                setDragW(null)
                if (latest < 320) {
                  setOpen(false) // snap 关闭
                } else {
                  void update('assistantWidth', latest)
                }
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
          />
        </div>
      )}
    </>
  )
}

function NoProviderHint({ onGoSettings }: { onGoSettings: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center">
        <Bot size={28} className="mx-auto text-[var(--text-muted)]" />
        <p className="text-[13px] text-[var(--text-primary)] mt-3">还没有可用的模型供应商</p>
        <p className="text-[12px] text-[var(--text-muted)] mt-1 leading-relaxed">
          推荐本机安装 <b>CC Switch</b> 并配好 Key 后一键导入。
        </p>
        <button onClick={onGoSettings}
          className="mt-4 px-3 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
          去配置模型
        </button>
      </div>
    </div>
  )
}

function TraceBlock({ steps }: { steps: AgentTraceStep[] }) {
  return (
    <details className="mr-6 mt-1 text-[11px] px-2.5 py-1.5 rounded-md border border-dashed border-[var(--border-color)] text-[var(--text-muted)]">
      <summary className="cursor-pointer select-none">调用轨迹（{steps.length} 步）</summary>
      <ul className="mt-1.5 space-y-1">
        {steps.map((st, j) => (
          <li key={j} className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {st.kind === 'tool' ? <Wrench size={10} /> : <Bot size={10} />}
            <code className="truncate">{st.name ?? 'LLM'}</code>
            <span className="ml-auto tabular-nums shrink-0">{st.durationMs}ms{st.tokens ? ` · ${st.tokens}tok` : ''}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
    </svg>
  )
}

function showToastSafe(message: string, type: 'error' | 'info' = 'error'): void {
  showToast({ type, message })
}
