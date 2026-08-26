import { useEffect, useRef, useState, useCallback } from 'react'
import { Send, Loader2, Wrench, Bot } from 'lucide-react'
import { showToast } from '../../../lib/toast'
import { agentChat, llmListProviders } from '../../../lib/ipc'
import type { AgentChatMessage, AgentTraceStep, LlmProviderInfo } from '../../../types'

/** 设置 → AI 工具 → 对话：最小 AI 助手（工具循环在后端，此处仅展示轨迹） */
export function AiChatTab({ goModels }: { goModels: () => void }) {
  const [providers, setProviders] = useState<LlmProviderInfo[]>([])
  const [checked, setChecked] = useState(false)
  const [messages, setMessages] = useState<AgentChatMessage[]>([])
  const [traces, setTraces] = useState<Record<number, AgentTraceStep[]>>({})
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    llmListProviders()
      .then(r => setProviders(r.providers.filter(p => p.enabled && p.models.length > 0)))
      .finally(() => setChecked(true))
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pending])

  const usable = providers.length > 0
  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || pending) return
    const next: AgentChatMessage[] = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setInput('')
    setPending(true)
    try {
      const r = await agentChat(next.filter(m => m.role === 'user' || m.role === 'assistant'))
      if (r.ok) {
        setTraces(t => ({ ...t, [next.length]: r.trace }))
        setMessages([...next, { role: 'assistant', content: r.reply ?? '(空回复)' }])
      } else {
        setTraces(t => ({ ...t, [next.length]: r.trace }))
        showToast({ type: 'error', message: `AI 调用失败：${r.error}` })
        setMessages(next)
      }
    } finally {
      setPending(false)
    }
  }, [messages, pending])

  if (!checked) return null

  return (
    <div className="flex flex-col h-full max-w-md">
      {!usable ? (
        <div className="px-4 py-8 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-center">
          <Bot size={28} className="mx-auto text-[var(--text-muted)]" />
          <p className="text-[13px] text-[var(--text-primary)] mt-3">还没有可用的模型供应商</p>
          <p className="text-[12px] text-[var(--text-muted)] mt-1 leading-relaxed">
            推荐本机安装 <b>CC Switch</b> 并配好 Key 后，在「模型」页一键导入；<br />
            也可手动添加供应商（支持本地 Ollama）。
          </p>
          <button onClick={goModels}
            className="mt-4 px-3 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
            去配置模型
          </button>
        </div>
      ) : (
        <>
          {/* 消息区 */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {messages.length === 0 && !pending && (
              <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
                试试：「帮我看看最近有哪些知识库页面」「本周打卡情况怎么样？」——助手会自动调用对应工具查询本地数据。
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'ml-8 bg-[var(--bg-selected)] border border-[var(--border-color)]'
                  : 'mr-8 bg-[var(--bg-secondary)] border border-[var(--border-color)]'
              }`}>
                {m.content}
              </div>
            ))}
            {traces[messages.length]?.length > 0 && null}
            {Object.entries(traces).map(([idx, steps]) => (
              parseInt(idx) === messages.length && steps.length > 0 ? (
                <details key={`tr-${idx}`} className="mr-8 text-[11px] px-2.5 py-1.5 rounded-md border border-dashed border-[var(--border-color)] text-[var(--text-muted)]">
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
              ) : null
            ))}
            {pending && (
              <div className="mr-8 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <Loader2 size={13} className="animate-spin" /> 思考与调用工具中…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 输入区 */}
          <div className="mt-3 flex items-end gap-2 shrink-0">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) } }}
              rows={2}
              placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
              className="flex-1 px-2.5 py-2 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] resize-none outline-none focus:border-[var(--accent)]"
            />
            <button onClick={() => { void send(input) }} disabled={pending || !input.trim()}
              className="p-2 rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
              <Send size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
