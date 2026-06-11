import { useState, useEffect, useCallback, useRef } from 'react'
import { Entry, Tag } from '../../../types'
import { getEntryById, updateEntry } from '../../../lib/ipc'
import { TagBadge } from '../../../components/shared'
import { ArrowLeft, Eye, Code } from 'lucide-react'

interface Props {
  entryId: string
  tags: Tag[]
  onSave: () => void
  onCancel: () => void
}

export function MarkdownEditor({ entryId, tags, onSave, onCancel }: Props) {
  const [entry, setEntry] = useState<(Entry & { tags: Tag[] }) | null>(null)
  const [title, setTitle] = useState('')
  const [contentMd, setContentMd] = useState('')
  const [date, setDate] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    getEntryById(entryId).then(d => {
      if (!d) return
      setEntry(d); setTitle(d.title); setContentMd(d.contentMd); setDate(d.date)
    })
  }, [entryId])

  const doSave = useCallback(async (t: string, c: string, d: string) => {
    setSaving(true)
    try {
      await updateEntry(entryId, { title: t, contentMd: c, contentHtml: renderMarkdown(c), date: d })
      setLastSaved(new Date())
    } catch (e) { console.error('Save failed:', e) }
    finally { setSaving(false) }
  }, [entryId])

  const handleContentChange = (v: string) => {
    setContentMd(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(title, v, date), 2000)
  }

  const handleTitleChange = (v: string) => {
    setTitle(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(v, contentMd, date), 2000)
  }

  const handleDateChange = (v: string) => {
    setDate(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(title, contentMd, v), 2000)
  }

  const handleSaveAndClose = async () => {
    if (timer.current) clearTimeout(timer.current)
    await doSave(title, contentMd, date)
    onSave()
  }

  // 键盘快捷键
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '/') { e.preventDefault(); setShowSource(v => !v) }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSaveAndClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [title, contentMd, date])

  const wordCount = contentMd.replace(/\s/g, '').length

  if (!entry) {
    return <div className="flex-1 flex items-center justify-center text-[#6a6a6a] bg-[#1e1e1e]">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-[13px] text-[#969696] hover:text-[#cccccc]">
            <ArrowLeft size={15} /> 返回
          </button>
          <div className="w-px h-4 bg-[#3c3c3c]" />
          <input
            type="date" value={date} onChange={e => handleDateChange(e.target.value)}
            className="text-[13px] bg-[#3c3c3c] text-[#cccccc] border border-[#3c3c3c] rounded px-2 py-0.5 focus:border-[#007acc]"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSource(!showSource)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded transition-colors ${showSource ? 'bg-[#37373d] text-[#cccccc]' : 'text-[#969696] hover:bg-[#2a2d2e]'}`}
            title="Ctrl+/ 切换源码"
          >
            {showSource ? <Code size={13} /> : <Eye size={13} />}
            {showSource ? '源码' : '预览'}
          </button>
          <span className="text-[11px] text-[#6a6a6a] min-w-[60px] text-right">
            {saving ? '保存中...' : lastSaved ? `已保存 ${fmtTime(lastSaved)}` : ''}
          </span>
          <button onClick={handleSaveAndClose} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4]">完成</button>
        </div>
      </div>

      {/* 标题 */}
      <div className="px-10 pt-6 pb-2 shrink-0">
        <input
          type="text" value={title} onChange={e => handleTitleChange(e.target.value)}
          placeholder="博文标题..."
          className="w-full text-2xl font-bold bg-transparent text-[#e0e0e0] placeholder-[#3c3c3c] border-none outline-none"
        />
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-hidden flex">
        <textarea
          value={contentMd}
          onChange={e => handleContentChange(e.target.value)}
          placeholder="开始写作... 支持 Markdown 语法"
          className={`${showSource ? 'flex-1' : 'flex-1'} resize-none px-10 py-4 bg-transparent text-[#cccccc] leading-relaxed font-mono text-[14px] border-none outline-none`}
        />
        {!showSource && (
          <div className="flex-1 px-10 py-4 border-l border-[#2d2d2d] overflow-y-auto">
            <div className="prose-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(contentMd) }} />
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-[#3c3c3c] bg-[#252526] text-[11px] text-[#6a6a6a] shrink-0">
        <div className="flex items-center gap-4">
          <span>{wordCount} 字</span>
          <span>📅 {date}</span>
          {entry.tags?.map(t => (
            <span key={t.id} className="flex items-center gap-1"><TagBadge color={t.color} size="sm" />{t.name}</span>
          ))}
        </div>
        <span>Ctrl+/ 源码 · Ctrl+S 保存</span>
      </div>
    </div>
  )
}

// 简易 Markdown → HTML
function renderMarkdown(md: string): string {
  let h = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
  h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>')
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  h = h.replace(/^---$/gm, '<hr />')
  h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>')
  h = h.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
  h = h.replace(/\n\n/g, '</p><p>')
  h = h.replace(/\n/g, '<br />')
  return '<p>' + h + '</p>'
}

function fmtTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
