import { useState, useEffect, useCallback, useRef } from 'react'
import { getEntryById, updateEntry } from '../../../lib/ipc'
import { ArrowLeft, Eye, Code } from 'lucide-react'

interface Props {
  entryId: string; showLineNumbers: boolean; onSave: () => void; onCancel: () => void
}

function renderMarkdown(md: string): string {
  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const fenced: string[] = []
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    fenced.push('<pre><code class="language-' + lang + '">' + esc + '</code></pre>')
    return '\x00' + 'FC' + (fenced.length - 1) + '\x00'
  })
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/^(-{3,}|\*{3,})$/gm, '<hr>')
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/^(\s*)[-*+]\s(.+)$/gm, '<li>$2</li>')
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
  html = html.replace(/\n\n+/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')
  html = '<p>' + html + '</p>'
  html = html.replace(new RegExp('\x00FC(\\d+)\x00', 'g'), (_m, idx) => fenced[parseInt(idx)])
  html = html.replace(/<p>\s*<\/p>/g, '')
  html = html.replace(/<p><\/(h[1-6]|ul|ol|blockquote|pre|hr)>/g, '</$1>')
  html = html.replace(/<(h[1-6]|ul|ol|blockquote|pre|hr)><\/p>/g, '<$1>')
  return html
}

export function MarkdownEditor({ entryId, showLineNumbers, onSave, onCancel }: Props) {
  const [contentMd, setContentMd] = useState('')
  const [date, setDate] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    getEntryById(entryId).then(d => {
      if (!d) return
      setContentMd(d.contentMd); setDate(d.date); setLoaded(true)
    })
  }, [entryId])

  const doSave = useCallback(async (c: string, d: string) => {
    setSaving(true)
    try {
      await updateEntry(entryId, { contentMd: c, contentHtml: renderMarkdown(c), date: d })
      setLastSaved(new Date())
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }, [entryId])

  const handleChange = (v: string) => {
    setContentMd(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(v, date), 2000)
  }

  const handleSaveAndClose = async () => {
    if (timer.current) clearTimeout(timer.current)
    await doSave(contentMd, date)
    onSave()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '/') { e.preventDefault(); setShowPreview(v => !v) }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSaveAndClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [contentMd, date])

  const wordCount = contentMd.replace(/\s/g, '').length
  const lineCount = contentMd.split('\n').length
  const lines = Array.from({ length: Math.max(lineCount, 30) }, (_, i) => i + 1)

  if (!loaded) {
    return <div className="flex-1 flex items-center justify-center text-[#6a6a6a] bg-[#1e1e1e]">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      {/* toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-[13px] text-[#969696] hover:text-[#cccccc]">
            <ArrowLeft size={15} /> 返回
          </button>
          <div className="w-px h-4 bg-[#3c3c3c]" />
          <span className="text-[13px] text-[#cccccc] font-medium">{date}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#6a6a6a] min-w-[60px] text-right">
            {saving ? '保存中...' : lastSaved ? '已保存 ' + fmtTime(lastSaved) : ''}
          </span>
          <button onClick={() => setShowPreview(!showPreview)}
            className={'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded transition-colors ' + (showPreview ? 'bg-[#37373d] text-[#cccccc]' : 'text-[#969696] hover:bg-[#2a2d2e]')}
            title="Ctrl+/">
            {showPreview ? <Code size={13} /> : <Eye size={13} />}
            {showPreview ? '源码' : '预览'}
          </button>
          <button onClick={handleSaveAndClose}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4]">
            完成
          </button>
        </div>
      </div>

      {/* content */}
      <div className="flex-1 overflow-auto bg-[#1a1a1a]">
        {showPreview ? (
          <div className="max-w-3xl mx-auto px-10 py-6">
            <div className="prose-content text-[15px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(contentMd) }} />
          </div>
        ) : (
          <div className="flex min-h-full font-mono">
            {showLineNumbers && (
              <div className="select-none text-right pr-3 pt-6 border-r border-[#2d2d2d] bg-[#1a1a1a] shrink-0 w-12">
                {lines.map(n => (
                  <div key={n} className="text-[13px] leading-[1.75] text-[#858585]" style={{ height: '1.75em' }}>
                    {n <= lineCount ? n : ''}
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={contentMd}
              onChange={e => handleChange(e.target.value)}
              spellCheck={false}
              placeholder="开始写作..."
              className="flex-1 resize-none px-6 py-6 bg-transparent text-[#d4d4d4] text-[14px] leading-[1.75] border-none outline-none placeholder:text-[#3a3a3a] font-mono"
            />
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-[#3c3c3c] bg-[#252526] text-[11px] text-[#6a6a6a] shrink-0">
        <span>{wordCount} 字</span>
        <span>Ctrl+/ 预览  Ctrl+S 保存</span>
      </div>
    </div>
  )
}

function fmtTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
