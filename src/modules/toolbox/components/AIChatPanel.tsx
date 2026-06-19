import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader2 } from 'lucide-react'
import { aiChat } from '../../../lib/ipc'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'
import { showToast } from '../../../lib/toast'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  onBack: () => void
}

export function AIChatPanel({ onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    const payload = messages.concat(userMsg).map(m => ({
      role: m.role,
      content: m.content,
    }))

    const result = await aiChat({ messages: payload })

    if (result.error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${result.error}` }])
      showToast({ type: 'error', message: result.error })
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: result.content || '(空白回复)' }])
    }
    setLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <button
          onClick={onBack}
          className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          ← 返回
        </button>
        <Bot size={18} className="text-[var(--accent)]" />
        <h2 className="text-[15px] font-medium text-[var(--text-primary)]">AI 助手</h2>
        <span className="text-[11px] text-[var(--text-muted)] ml-auto">Enter 发送 · Shift+Enter 换行</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <Bot size={40} strokeWidth={1} className="text-[var(--text-muted)]" />
            <div>
              <p className="text-[14px] text-[var(--text-primary)] font-medium">有什么可以帮你的？</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-1">
                可以帮你写作、翻译、解释代码、整理思路...
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
              msg.role === 'user'
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                : 'bg-[var(--accent)]/15 text-[var(--accent)]'
            }`}>
              {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>

            {/* Bubble */}
            <div className={`max-w-[75%] rounded-lg px-4 py-2.5 ${
              msg.role === 'user'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)]'
            }`}>
              {msg.role === 'user' ? (
                <p className="text-[13px] whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <MarkdownPreview content={msg.content} />
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex gap-3">
            <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center">
              <Bot size={14} />
            </div>
            <div className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg px-4 py-2.5">
              <Loader2 size={16} className="animate-spin text-[var(--accent)]" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-[var(--border-color)] shrink-0">
        <div className="flex items-end gap-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 focus-within:border-[var(--accent)] transition-colors">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none resize-none placeholder:text-[var(--text-disabled)] max-h-[120px]"
            style={{ minHeight: 24 }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="shrink-0 p-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
