import { useState, useEffect, useCallback, useRef } from 'react'
import { getEntryById, updateEntry } from '../../../lib/ipc'
import { ArrowLeft, Eye, Code } from 'lucide-react'
import { marked } from 'marked'
import Editor, { type OnMount } from '@monaco-editor/react'

interface Props {
  entryId: string; showLineNumbers: boolean; onSave: () => void; onCancel: () => void
}

function renderMarkdown(md: string): string {
  if (!md) return '<p></p>'
  return marked.parse(md, { async: false }) as string
}

export function MarkdownEditor({ entryId, showLineNumbers, onSave, onCancel }: Props) {
  const [contentMd, setContentMd] = useState('')
  const [date, setDate] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const contentRef = useRef(contentMd)
  const dateRef = useRef(date)

  // Keep refs synced for the debounced save
  useEffect(() => { contentRef.current = contentMd }, [contentMd])
  useEffect(() => { dateRef.current = date }, [date])

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

  const handleChange = (v: string | undefined) => {
    const val = v || ''
    setContentMd(val)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(val, dateRef.current), 2000)
  }

  const handleSaveAndClose = async () => {
    if (timer.current) clearTimeout(timer.current)
    await doSave(contentRef.current, dateRef.current)
    onSave()
  }

  // Ctrl+/ toggle preview, Ctrl+S save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '/') { e.preventDefault(); setShowPreview(v => !v) }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSaveAndClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const wordCount = contentMd.replace(/\s/g, '').length

  if (!loaded) {
    return <div className="flex-1 flex items-center justify-center text-[#6a6a6a] bg-[#1e1e1e]">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
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
      <div className="flex-1 overflow-hidden bg-[#1e1e1e]">
        {showPreview ? (
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-10 py-6">
              <div className="prose-content text-[15px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(contentMd) }} />
            </div>
          </div>
        ) : (
          <Editor
            language="markdown"
            value={contentMd}
            onChange={handleChange}
            theme="vs-dark"
            loading={<div className="flex items-center justify-center h-full text-[#6a6a6a]">加载编辑器...</div>}
            options={{
              fontSize: 14,
              fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
              lineNumbers: showLineNumbers ? 'on' : 'off',
              minimap: { enabled: false },
              wordWrap: 'on',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              renderWhitespace: 'selection',
              renderLineHighlight: 'line',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 16, bottom: 16 },
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              folding: true,
              lineDecorationsWidth: 0,
              lineNumbersMinChars: 3,
              guides: { indentation: true },
              tabSize: 2,
              insertSpaces: true,
              selectionHighlight: true,
              occurrencesHighlight: 'off',
              bracketPairColorization: { enabled: true },
              matchBrackets: 'always',
              placeholder: '开始写作...',
            }}
          />
        )}
      </div>

      {/* status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-[#3c3c3c] bg-[#007acc] text-[11px] text-white shrink-0">
        <span>{wordCount} 字</span>
        <span>Ctrl+/ 预览 · Ctrl+S 保存</span>
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
