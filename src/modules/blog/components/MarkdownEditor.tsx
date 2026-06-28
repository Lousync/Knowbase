import { useState, useEffect, useCallback, useRef } from 'react'
import { getEntryById, updateEntry, getTags, createTag, deleteEntry, getSetting, setSetting, openExternal } from '../../../lib/ipc'
import { ArrowLeft, Eye, Code, Plus, X, Trash2, ListTree } from 'lucide-react'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'
import { useSettings } from '../../../lib/SettingsContext'
import { ConfirmDialog } from '../../../components/shared'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import type { Tag } from '../../../types'

interface Props {
  entryId: string; showLineNumbers: boolean; zoom?: number; onSave: () => void; onCancel: () => void
  onContentChange?: (content: string) => void
  onToggleOutline?: () => void
}

const MOOD_OPTIONS = [
  { emoji: '😄', label: '开心' },
  { emoji: '😫', label: '疲倦' },
  { emoji: '😢', label: '难过' },
  { emoji: '😕', label: '困惑' },
]
const MAX_TAGS = 5

export function MarkdownEditor({ entryId, showLineNumbers, zoom = 1, onSave, onCancel, onContentChange, onToggleOutline }: Props) {
  const { s } = useSettings()
  const [contentMd, setContentMd] = useState('')
  const [date, setDate] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const contentRef = useRef(contentMd)
  const dateRef = useRef(date)

  // Tags & States
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [entryTags, setEntryTags] = useState<Tag[]>([])
  const [entryStates, setEntryStates] = useState<string>('')
  const [newTagName, setNewTagName] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)

  const tagsRef = useRef<Tag[]>([])
  const statesRef = useRef('')

  useEffect(() => { contentRef.current = contentMd }, [contentMd])
  useEffect(() => { dateRef.current = date }, [date])
  useEffect(() => { tagsRef.current = entryTags }, [entryTags])
  useEffect(() => { statesRef.current = entryStates }, [entryStates])

  useEffect(() => {
    Promise.all([
      getEntryById(entryId).then(d => {
        if (!d) return
        setContentMd(d.contentMd); setDate(d.date)
        setEntryTags(d.tags || [])
        setEntryStates(d.states || '')
        onContentChange?.(d.contentMd)  // seed outline with existing content
        setLoaded(true)
      }),
      getTags().then(setAllTags)
    ])
  }, [entryId])

  // Load skip-delete setting
  useEffect(() => {
    getSetting('skipDeleteConfirm_blog').then(v => { if (v === true) setSkipDeleteConfirm(true) })
  }, [])

  const handleDeleteEntry = () => {
    if (skipDeleteConfirm) {
      deleteEntry(entryId).then(onSave).catch(console.error)
    } else {
      setShowDeleteConfirm(true)
    }
  }

  const doSave = useCallback(async (c: string, d: string) => {
    setSaving(true)
    try {
      const tagIds = tagsRef.current.map(t => t.id)
      await updateEntry(entryId, {
        contentMd: c,
        contentHtml: '',
        date: d,
        tags: tagIds,
        states: statesRef.current,
      })
      setLastSaved(new Date())
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }, [entryId])

  const handleChange = (v: string | undefined) => {
    const val = v || ''
    setContentMd(val)
    onContentChange?.(val)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(val, dateRef.current), s.autoSaveDebounceMs)
  }

  const handleSaveAndClose = async () => {
    if (timer.current) clearTimeout(timer.current)
    await doSave(contentRef.current, dateRef.current)
    onSave()
  }

  const handleAddTag = async () => {
    const name = newTagName.trim()
    if (!name) { setShowTagInput(false); return }
    if (entryTags.length >= MAX_TAGS) { setShowTagInput(false); setNewTagName(''); return }
    // Existing tag?
    let tag = allTags.find(t => t.name === name)
    if (!tag) {
      tag = await createTag(name)
      setAllTags(prev => [...prev, tag!])
    }
    if (!entryTags.find(t => t.id === tag!.id)) {
      setEntryTags(prev => [...prev, tag!])
    }
    setNewTagName('')
    setShowTagInput(false)
  }

  const handleRemoveTag = (tagId: string) => {
    setEntryTags(prev => prev.filter(t => t.id !== tagId))
  }

  const handleToggleState = (emoji: string) => {
    const states = entryStates.split(',').filter(Boolean)
    const idx = states.indexOf(emoji)
    if (idx >= 0) {
      states.splice(idx, 1)
    } else {
      states.push(emoji)
    }
    setEntryStates(states.join(','))
  }

  // Ctrl+/ toggle preview, Ctrl+S save, Escape back
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '/') { e.preventDefault(); setShowPreview(v => !v) }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSaveAndClose() }
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Outline navigation — scroll editor or preview DOM to target heading
  useEffect(() => {
    const handler = (e: Event) => {
      const { line, id } = (e as CustomEvent).detail as { line: number; id: string }
      if (showPreview) {
        // Preview mode: scroll DOM element
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        // Editing mode: use Monaco editor API
        const ed = editorRef.current
        if (ed) {
          ed.revealLineInCenter(line)
          ed.setPosition({ lineNumber: line, column: 1 })
          ed.focus()
        }
      }
    }
    window.addEventListener('outline:go-to-heading', handler)
    return () => window.removeEventListener('outline:go-to-heading', handler)
  }, [showPreview])

  if (!loaded) {
    return <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] bg-[var(--bg-primary)]">加载中...</div>
  }

  const activeStates = entryStates.split(',').filter(Boolean)

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--bg-primary)]">
      {/* toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ArrowLeft size={15} /> 返回
          </button>
          <div className="w-px h-4 bg-[var(--input-bg)]" />
          <span className="text-[13px] text-[var(--text-primary)] font-medium">{date}</span>

          {/* Mood states */}
          <div className="w-px h-4 bg-[var(--input-bg)]" />
          <div className="flex items-center gap-0.5">
            {MOOD_OPTIONS.map(m => (
              <button
                key={m.emoji}
                onClick={() => handleToggleState(m.emoji)}
                title={m.label}
                className={`text-[15px] px-0.5 rounded transition-opacity ${activeStates.includes(m.emoji) ? 'opacity-100' : 'opacity-30 hover:opacity-60'}`}
              >
                {m.emoji}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)] min-w-[60px] text-right">
            {saving ? '保存中...' : lastSaved ? '已保存 ' + fmtTime(lastSaved) : ''}
          </span>
          <button onClick={() => setShowPreview(!showPreview)}
            className={'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded transition-colors ' + (showPreview ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}
            title="Ctrl+/">
            {showPreview ? <Code size={13} /> : <Eye size={13} />}
            {showPreview ? '源码' : '预览'}
          </button>
          {onToggleOutline && (
            <button onClick={onToggleOutline}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
              title="大纲 (Ctrl+O)">
              <ListTree size={13} />
              大纲
            </button>
          )}
          <button onClick={handleSaveAndClose}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]">
            完成
          </button>
          <button onClick={handleDeleteEntry}
            className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[#e8112320] transition-colors"
            title="删除">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Tag bar */}
      <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0 overflow-x-auto">
        {entryTags.map(t => (
          <span key={t.id}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] shrink-0"
            style={{ backgroundColor: t.color + '20', color: t.color, border: `1px solid ${t.color}40` }}
          >
            {t.name}
            <button onClick={() => handleRemoveTag(t.id)}
              className="hover:text-[var(--danger)] transition-colors"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {entryTags.length < MAX_TAGS && (
          showTagInput ? (
            <input
              autoFocus
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddTag(); if (e.key === 'Escape') { setShowTagInput(false); setNewTagName('') } }}
              onBlur={handleAddTag}
              placeholder="标签名..."
              className="w-20 px-1.5 py-0.5 bg-[var(--input-bg)] border border-[var(--accent)] rounded text-[11px] text-[var(--text-primary)] outline-none"
            />
          ) : (
            <button onClick={() => setShowTagInput(true)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded border border-dashed border-[var(--border-color)] transition-colors"
            >
              <Plus size={10} />标签
            </button>
          )
        )}
        {entryTags.length > 0 && (
          <span className="text-[10px] text-[var(--text-disabled)] ml-1">{entryTags.length}/{MAX_TAGS}</span>
        )}
      </div>

      {/* content */}
      <div className="flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)]">
        {showPreview ? (
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-10 py-6">
              <MarkdownPreview content={contentMd} onLinkClick={href => openExternal(href)} />
            </div>
          </div>
        ) : (
          <Editor
            language="markdown"
            value={contentMd}
            onChange={handleChange}
            onMount={(editor) => { editorRef.current = editor }}
            theme={s.theme === 'light' ? 'vs' : 'vs-dark'}
            loading={<div className="flex items-center justify-center h-full text-[var(--text-muted)]">加载编辑器...</div>}
            options={{
              fontSize: Math.round(s.editorFontSize * zoom),
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
              unicodeHighlight: { nonBasicASCII: false, ambiguousCharacters: false, invisibleCharacters: false },
              placeholder: '开始写作...',
            }}
          />
        )}
      </div>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="确认删除"
        message="确定要删除这篇博文吗？删除后可在回收站恢复，30天后将自动清空。"
        confirmLabel="删除"
        onConfirm={(skipNext) => {
          if (skipNext) {
            setSetting('skipDeleteConfirm_blog', true)
            setSkipDeleteConfirm(true)
          }
          setShowDeleteConfirm(false)
          deleteEntry(entryId).then(onSave).catch(console.error)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

function fmtTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
