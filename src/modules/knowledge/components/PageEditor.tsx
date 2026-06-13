import { useState, useEffect, useCallback, useRef } from 'react'
import { marked } from 'marked'
import { ArrowLeft, Trash2, Eye, Edit3, Star, FileText } from 'lucide-react'
import type { KnowledgePage, KnowledgeCategory } from '../../../types'
import { getKnowledgePageById, updateKnowledgePage, deleteKnowledgePage, getKnowledgeBacklinks, updateKnowledgeLinks, toggleKnowledgeStar, getSetting, setSetting } from '../../../lib/ipc'
import { ConfirmDialog } from '../../../components/shared'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'

interface Props {
  pageId: string
  categories: KnowledgeCategory[]
  allPages: KnowledgePage[]
  zoom?: number
  onBack: () => void
  onDeleted: () => void
  onNavigate: (id: string) => void
  onUpdate: () => void
}

export function PageEditor({ pageId, categories, allPages, zoom = 1, onBack, onDeleted, onNavigate, onUpdate }: Props) {
  const [page, setPage] = useState<KnowledgePage | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState(false)
  const [backlinks, setBacklinks] = useState<KnowledgePage[]>([])
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const contentRef = useRef(content)
  const titleRef = useRef(title)
  const pageRef = useRef(page)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => { titleRef.current = title }, [title])
  useEffect(() => { pageRef.current = page }, [page])

  useEffect(() => {
    Promise.all([
      getKnowledgePageById(pageId).then(p => {
        if (p) { setPage(p); setTitle(p.title); setContent(p.contentMd) }
      }),
      getKnowledgeBacklinks(pageId).then(setBacklinks)
    ])
  }, [pageId])

  useEffect(() => {
    getSetting('skipDeleteConfirm_knowledge').then(v => {
      if (v === true) setSkipDeleteConfirm(true)
    })
  }, [])

  const doSave = useCallback(async (t: string, c: string) => {
    if (!pageRef.current) return
    try {
      const links = parseWikiLinks(c)
      await updateKnowledgePage(pageRef.current.id, { title: t, contentMd: c, contentHtml: marked.parse(c, { async: false }) as string })
      await updateKnowledgeLinks(pageRef.current.id, links)
      setSaving(false)
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    if (!page) return
    setSaving(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(title, content), 2000)
    return () => clearTimeout(saveTimer.current)
  }, [title, content, page, doSave])

  // Monaco mount handler — register wiki-link completion provider
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    monaco.languages.registerCompletionItemProvider('markdown', {
      triggerCharacters: ['['],
      provideCompletionItems(model, position) {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })

        const lastOpen = textUntilPosition.lastIndexOf('[[')
        const lastClose = textUntilPosition.lastIndexOf(']]')
        if (lastOpen <= lastClose) return { suggestions: [] }

        const query = textUntilPosition.slice(lastOpen + 2).toLowerCase()
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: lastOpen + 3,
          endColumn: position.column
        }

        const matches = allPages
          .filter(p => p.title.toLowerCase().includes(query) && p.id !== pageId)
          .slice(0, 8)

        return {
          suggestions: matches.map(p => ({
            label: p.title,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: p.title + ']]',
            range,
            detail: p.isStarred ? '⭐ 收藏' : undefined,
          }))
        }
      }
    })

    editor.focus()
  }

  const handleDelete = async () => {
    if (!page) return
    if (skipDeleteConfirm) {
      await deleteKnowledgePage(page.id)
      onDeleted()
    } else {
      setShowDeleteConfirm(true)
    }
  }

  const handleToggleStar = async () => {
    if (!page) return
    try {
      const updated = await toggleKnowledgeStar(page.id)
      setPage({ ...page, isStarred: updated.isStarred })
      onUpdate()
    } catch (e) { console.error(e) }
  }

  if (!page) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="border-2 border-[var(--border-color)] border-t-[#007acc] rounded-full w-5 h-5 animate-spin" />
    </div>
  )

  const getCategoryPath = (catId: string | null): string => {
    if (!catId) return '未分类'
    const parts: string[] = []
    let current = categories.find(c => c.id === catId)
    while (current) { parts.unshift(current.name); current = categories.find(c => c.id === current!.parentId) }
    return parts.join(' > ')
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Main editing area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
          <div className="flex items-center gap-2.5">
            <button onClick={onBack} className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1.5">
              <ArrowLeft size={17} /> 返回
            </button>
            <button onClick={handleToggleStar} className={`${page.isStarred ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'} hover:text-[var(--warning)]`}>
              <Star size={17} fill={page.isStarred ? '#c5a332' : 'none'} />
            </button>
            <span className="text-[11px] text-[var(--text-muted)]">{getCategoryPath(page.categoryId)}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className={`w-2.5 h-2.5 rounded-full ${saving ? 'bg-[var(--warning)]' : 'bg-green-500'}`} />
            <span className="text-[12px] text-[var(--text-secondary)]">{saving ? '未保存' : '已保存'}</span>
            <button onClick={() => setPreview(v => !v)} className={`p-1.5 rounded text-xs ${preview ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`} title="Ctrl+/">
              {preview ? <Edit3 size={16} /> : <Eye size={16} />}
            </button>
            <button onClick={handleDelete} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--danger)]" title="删除">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        {preview ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <h1 className="text-xl font-bold text-[#e0e0e0] mb-3">{title}</h1>
            <div className="prose-content" dangerouslySetInnerHTML={{ __html: page.contentHtml || (marked.parse(content, { async: false }) as string) }} />
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            <input
              className="w-full bg-transparent text-xl font-bold text-[#e0e0e0] px-6 py-3 outline-none border-b border-[var(--border-color)] placeholder:text-[var(--text-disabled)] shrink-0"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="页面标题"
            />
            <div className="flex-1">
              <Editor
                language="markdown"
                value={content}
                onChange={v => setContent(v || '')}
                theme="vs-dark"
                onMount={handleEditorMount}
                loading={<div className="flex items-center justify-center h-full text-[var(--text-muted)]">加载编辑器...</div>}
                options={{
                  fontSize: Math.round(13 * zoom),
                  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
                  lineNumbers: 'on',
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  renderWhitespace: 'selection',
                  renderLineHighlight: 'line',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 8, bottom: 16 },
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  overviewRulerBorder: false,
                  guides: { indentation: true },
                  tabSize: 2,
                  insertSpaces: true,
                  bracketPairColorization: { enabled: true },
                  matchBrackets: 'always',
                  selectionHighlight: true,
                  quickSuggestions: true,
                  suggest: { showWords: false },
                  placeholder: '开始写 Markdown... 使用 [[页面名]] 创建链接',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      {page && (
        <ConfirmDialog
          open={showDeleteConfirm}
          title="确认删除"
          message={`确定要删除知识页面「${page.title || '无标题'}」吗？删除后可在回收站恢复，30天后将自动清空。`}
          onConfirm={(skipNext) => {
            if (skipNext) {
              setSetting('skipDeleteConfirm_knowledge', true)
              setSkipDeleteConfirm(true)
            }
            setShowDeleteConfirm(false)
            deleteKnowledgePage(page!.id).then(() => onDeleted())
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Right: Backlinks */}
      {backlinks.length > 0 && (
        <div className="w-48 shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col">
          <div className="px-3 py-2 border-b border-[var(--border-color)]">
            <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase">反向链接 · {backlinks.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {backlinks.map(bl => (
              <div key={bl.id} onClick={() => onNavigate(bl.id)} className="px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] border-b border-[#2d2d2d]">
                <span className="text-[12px] text-[var(--text-primary)] truncate block">{bl.title || '无标题'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function parseWikiLinks(md: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g
  const links: string[] = []
  let m
  while ((m = re.exec(md)) !== null) {
    const title = m[1].split('|')[0].trim()
    if (!links.includes(title)) links.push(title)
  }
  return links
}
