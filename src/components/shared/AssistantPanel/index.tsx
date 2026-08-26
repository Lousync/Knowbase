import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Sparkles, X, Menu, Plus, Trash2, Loader2, Wrench, Bot, FileText,
} from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { getAssistantContext } from '../../../lib/assistantContext'
import { showToast } from '../../../lib/toast'
import {
  agentSessions, agentNewSession, agentMessages, agentDeleteSession,
  agentChat, llmListProviders,
} from '../../../lib/ipc'
import type { AgentSessionInfo, AgentStoredMessage, AgentTraceStep } from '../../../types'

/**
 * 全局 AI 助手侧栏（方案 B）：任意界面 Ctrl+J / 右下角按钮唤起，
 * 会话留存 + 上下文感知（正在查看的知识库页面自动附带）。
 */

interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  trace?: AgentTraceStep[]
}

export function AssistantPanel() {
  const { s, update } = useSettings()
  const [open, setOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([])
  const [providersOk, setProvidersOk] = useState<boolean | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const ctxVersionRef = useRef(0)

  const width = Math.min(520, Math.max(320, Number(s.assistantWidth ?? 380)))

  const refreshSessions = useCallback(async () => {
    try { setSessions(await agentSessions()) } catch { /* ignore */ }
  }, [])

  // 检查是否有可用模型供应商（决定引导态）
  useEffect(() => {
    llmListProviders()
      .then(r => setProvidersOk(r.providers.some(p => p.enabled && p.models.length > 0)))
      .catch(() => setProvidersOk(false))
  }, [])

  useEffect(() => { if (open) void refreshSessions() }, [open, refreshSessions])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pending, drawerOpen])

  // Ctrl+J 全局开关
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id)
    setDrawerOpen(false)
    try {
      const rows: AgentStoredMessage[] = await agentMessages(id)
      setMessages(rows.map(m => ({
        role: m.role,
        content: m.content,
        trace: m.traceJson ? (() => { try { return JSON.parse(m.traceJson) as AgentTraceStep[] } catch { return undefined } })() : undefined,
      })))
    } catch { setMessages([]) }
  }, [])

  const newSession = useCallback(async () => {
    const sRow = await agentNewSession().catch(() => null)
    if (!sRow) return
    setSessions(prev => [sRow, ...prev])
    setActiveId(sRow.id)
    setMessages([])
    setDrawerOpen(false)
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

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || pending) return
    let sid = activeId
    if (!sid) {
      const sRow = await agentNewSession().catch(() => null)
      if (!sRow) return
      sid = sRow.id
      setActiveId(sid)
    }
    const ctx = getAssistantContext()
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setPending(true)
    ctxVersionRef.current++
    try {
      const r = await agentChat(sid, text, ctx ?? undefined)
      if (r.ok && r.reply !== undefined) {
        setMessages(prev => [...prev, { role: 'assistant', content: r.reply!, trace: r.trace }])
      } else {
        showToastSafe(`AI 调用失败：${r.error ?? '未知错误'}`)
      }
    } finally {
      setPending(false)
      void refreshSessions()
    }
  }, [input, pending, activeId, refreshSessions])

  const ctx = open ? getAssistantContext() : null

  return (
    <>
      {/* 悬浮入口 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="AI 助手 (Ctrl+J)"
          className="fixed z-40 bottom-16 right-5 w-11 h-11 rounded-full bg-[var(--accent)] text-white shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <Sparkles size={19} />
        </button>
      )}

      {/* 侧栏面板 */}
      {open && (
        <div
          className="fixed z-40 top-[48px] bottom-10 right-0 flex flex-col bg-[var(--bg-primary)] border-l border-[var(--border-color)] shadow-2xl"
          style={{ width }}
        >
          {/* 头部 */}
          <div className="h-9 shrink-0 px-2.5 flex items-center gap-1 border-b border-[var(--border-color)]">
            <button onClick={() => setDrawerOpen(v => !v)} title="会话列表"
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
            {/* 会话抽屉 */}
            {drawerOpen && (
              <div className="absolute inset-y-0 left-0 w-52 z-10 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col">
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
                      <span className="flex-1 min-w-0 truncate">{sess.title}</span>
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

            {/* 消息区 */}
            <div className="flex-1 min-w-0 flex flex-col">
              {providersOk === false ? (
                <NoProviderHint onGoSettings={() => { setOpen(false); window.dispatchEvent(new CustomEvent('settings:open')) }} />
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                    {messages.length === 0 && !pending && (
                      <div className="pt-8 text-center text-[12px] text-[var(--text-muted)] leading-relaxed px-4">
                        在这里可以直接询问你正在查看的内容。<br />
                        例如打开一篇知识库页面后问：「总结一下这一页」。
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i}>
                        <Bubble msg={m} />
                        {m.trace && m.trace.length > 0 && <TraceBlock steps={m.trace} />}
                      </div>
                    ))}
                    {pending && (
                      <div className="mr-6 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                        <Loader2 size={13} className="animate-spin" /> 思考与调用工具中…
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>

                  {/* 上下文徽章 */}
                  {ctx && (
                    <div className="px-3 pb-1 shrink-0">
                      <span className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-md bg-[var(--bg-selected)] border border-[var(--border-color)] text-[11px] text-[var(--text-secondary)]">
                        <FileText size={10} className="shrink-0 text-[var(--accent)]" />
                        <span className="truncate">{ctx.label}</span>
                        <span className="text-[var(--text-disabled)]">·将随提问附带</span>
                      </span>
                    </div>
                  )}

                  {/* 输入区 */}
                  <div className="p-2.5 shrink-0 flex items-end gap-2 border-t border-[var(--border-color)]">
                    <textarea
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

          {/* 宽度拖拽条 */}
          <div
            className="absolute top-0 left-[-3px] w-1.5 h-full cursor-ew-resize hover:bg-[var(--accent)]/30"
            onMouseDown={e => {
              e.preventDefault()
              const startX = e.clientX
              const startW = width
              const move = (ev: MouseEvent) => {
                const w = Math.min(520, Math.max(320, startW + (startX - ev.clientX)))
                void update('assistantWidth', w)
              }
              const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
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

function Bubble({ msg }: { msg: UiMessage }) {
  return (
    <div className={`px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
      msg.role === 'user'
        ? 'ml-6 bg-[var(--bg-selected)] border border-[var(--border-color)]'
        : 'mr-6 bg-[var(--bg-secondary)] border border-[var(--border-color)]'
    }`}>
      {msg.content}
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

function showToastSafe(message: string): void {
  showToast({ type: 'error', message })
}
