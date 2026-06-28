import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Trash2, Eye, Edit3, Star, FileText, ChevronDown, ExternalLink, ListTree, X, ChevronRight, ChevronLeft } from 'lucide-react'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'
import type { KnowledgePage, KnowledgeCategory } from '../../../types'
import { getKnowledgePageById, updateKnowledgePage, getKnowledgeBacklinks, updateKnowledgeLinks, toggleKnowledgeStar, getSetting, setSetting, getAttachmentsPath, openExternal } from '../../../lib/ipc'
import { useSettings } from '../../../lib/SettingsContext'
import { FILE_LANG_OPTIONS, getFileTypeInfo } from '../../../lib/fileTypes'
import { isEditingInput } from '../../../lib/shortcuts'
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
  onTitleChange?: (title: string) => void
  onFileTypeChange?: (fileType: string) => void
  onContentChange?: (content: string) => void
  onToggleOutline?: () => void
}

export function PageEditor({ pageId, categories, allPages, zoom = 1, onBack, onDeleted, onNavigate, onUpdate, onTitleChange, onFileTypeChange, onContentChange, onToggleOutline }: Props) {
  const { s } = useSettings()
  const [page, setPage] = useState<KnowledgePage | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [fileType, setFileTypeState] = useState('')
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [preview, setPreview] = useState(false)
  const [backlinks, setBacklinks] = useState<KnowledgePage[]>([])
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  // Wiki link disambiguation: when multiple pages share the same title
  const [wikiPicker, setWikiPicker] = useState<{ title: string; candidates: KnowledgePage[] } | null>(null)
  const [showBacklinks, setShowBacklinks] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const contentRef = useRef(content)
  const titleRef = useRef(title)
  const pageRef = useRef(page)
  const fileTypeRef = useRef(fileType)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const showDeleteConfirmRef = useRef(showDeleteConfirm)
  const showLangMenuRef = useRef(showLangMenu)
  const isCodeFileRef = useRef(false)
  const isPdfFileRef = useRef(false)

  const isCodeFile = fileType !== '' && fileType !== 'md' && fileType !== 'txt'
  const isPdfFile = fileType === 'pdf'

  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => { titleRef.current = title }, [title])
  useEffect(() => { pageRef.current = page }, [page])
  useEffect(() => { fileTypeRef.current = fileType }, [fileType])
  useEffect(() => { showDeleteConfirmRef.current = showDeleteConfirm }, [showDeleteConfirm])
  useEffect(() => { showLangMenuRef.current = showLangMenu }, [showLangMenu])
  useEffect(() => { isCodeFileRef.current = isCodeFile }, [isCodeFile])
  useEffect(() => { isPdfFileRef.current = isPdfFile }, [isPdfFile])

  const [attachmentsPath, setAttachmentsPath] = useState('')

  useEffect(() => {
    getAttachmentsPath().then(setAttachmentsPath).catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([
      getKnowledgePageById(pageId).then(p => {
        if (p) { setPage(p); setTitle(p.title); setContent(p.contentMd); setFileTypeState(p.fileType || ''); window.dispatchEvent(new CustomEvent('status-filetype', { detail: getFileTypeInfo(p.fileType || '').label })); onTitleChange?.(p.title) }
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
      await updateKnowledgePage(pageRef.current.id, { title: t, contentMd: c, contentHtml: '', fileType: fileTypeRef.current })
      await updateKnowledgeLinks(pageRef.current.id, links)
      setSaving(false)
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    if (!page) return
    setSaving(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(title, content), s.autoSaveDebounceMs)
    return () => clearTimeout(saveTimer.current)
  }, [title, content, page, doSave])

  // Keyboard shortcuts: Ctrl+S, Ctrl+/, Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+S — save immediately
      if (e.ctrlKey && e.key === 's') {
        if (isEditingInput(e)) return
        e.preventDefault()
        clearTimeout(saveTimer.current)
        doSave(titleRef.current, contentRef.current)
        setSaving(false)
        return
      }
      // Ctrl+/ — toggle preview (md/txt only)
      if (e.ctrlKey && e.key === '/') {
        if (isEditingInput(e)) return
        if (isCodeFileRef.current || isPdfFileRef.current) return
        e.preventDefault()
        setPreview(v => !v)
        return
      }
      // Escape — back to list (respect modals)
      if (e.key === 'Escape') {
        if (showDeleteConfirmRef.current) return
        if (showLangMenuRef.current) {
          setShowLangMenu(false)
          return
        }
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doSave, onBack])

  // Outline panel navigation — scroll editor or preview DOM to target heading
  useEffect(() => {
    const handler = (e: Event) => {
      const { line, id } = (e as CustomEvent).detail as { line: number; id: string }
      if (preview) {
        // Reading mode: scroll DOM element
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
  }, [preview])

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

  // Build a breadcrumb path for a page from its category chain
  const getCategoryChain = (p: KnowledgePage): string | null => {
    if (!p.categoryId) return null
    const chain: string[] = []
    let currentId: string | null = p.categoryId
    const visited = new Set<string>()
    while (currentId) {
      if (visited.has(currentId)) break; visited.add(currentId)
      const cat = categories.find(c => c.id === currentId)
      if (cat) { chain.unshift(cat.name); currentId = cat.parentId }
      else break
    }
    return chain.length > 0 ? chain.join(' / ') : null
  }

  // Resolve a title to knowledge base pages. If >1 match, show picker. If 0, return false.
  const resolveInternalLink = (title: string): boolean => {
    const matches = allPages.filter(p => p.title === title)
    if (matches.length === 1) {
      onNavigate(matches[0].id)
      return true
    }
    if (matches.length > 1) {
      setWikiPicker({ title, candidates: matches })
      return true
    }
    return false
  }

  return (
    <div className="flex-1 flex overflow-hidden">
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
            {/* Language switcher — hidden for PDF */}
            {!isPdfFile && (
            <div className="relative">
              <button onClick={() => setShowLangMenu(v => !v)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-colors"
                title="切换语言">
                {FILE_LANG_OPTIONS.find(o => o.ext === fileType)?.label || 'Markdown'}
                <ChevronDown size={11} />
              </button>
              {showLangMenu && (
                <div className="absolute top-full right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-xl z-50 w-36 max-h-60 overflow-y-auto"
                  onMouseLeave={() => setShowLangMenu(false)}>
                  {FILE_LANG_OPTIONS.map(opt => (
                    <button key={opt.ext}
                      onClick={() => {
                        setFileTypeState(opt.ext)
                        setShowLangMenu(false)
                        if (opt.ext !== '' && opt.ext !== 'md' && opt.ext !== 'txt') setPreview(false)
                        onFileTypeChange?.(opt.ext)
                        window.dispatchEvent(new CustomEvent('status-filetype', { detail: opt.label }))
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] ${fileType === opt.ext ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                    >{opt.label}</button>
                  ))}
                </div>
              )}
            </div>
            )}
            <span className={`w-2.5 h-2.5 rounded-full ${saving ? 'bg-[var(--warning)]' : 'bg-green-500'}`} />
            <span className="text-[12px] text-[var(--text-secondary)]">{saving ? '未保存' : '已保存'}</span>
            {!isCodeFile && !isPdfFile && (
            <>
            <button onClick={onToggleOutline} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]" title="大纲视图">
              <ListTree size={16} />
            </button>
            <button onClick={() => setPreview(v => !v)} className={`p-1.5 rounded text-xs ${preview ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`} title="Ctrl+/">
              {preview ? <Edit3 size={16} /> : <Eye size={16} />}
            </button>
            </>
            )}
            <button onClick={handleDelete} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--danger)]" title="删除">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        {isPdfFile ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            <input
              className="w-full bg-transparent text-xl font-bold text-[var(--text-primary)] px-6 py-3 outline-none border-b border-[var(--border-color)] placeholder:text-[var(--text-disabled)] shrink-0"
              value={title}
              onChange={e => { setTitle(e.target.value); onTitleChange?.(e.target.value) }}
              placeholder="PDF 文档名称"
            />
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--text-secondary)]">
              <FileText size={64} className="opacity-20" />
              <p className="text-sm">PDF 文件已导入到本地附件目录</p>
              <button
                onClick={() => {
                  const pdfPath = `${attachmentsPath}\\${page.contentMd}`
                  openExternal(pdfPath)
                }}
                className="flex items-center gap-2 px-4 py-2 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors"
              >
                <ExternalLink size={15} />
                使用系统阅读器打开
              </button>
            </div>
          </div>
        ) : preview ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <h1 className="text-xl font-bold text-[var(--text-primary)] mb-3">{title}</h1>
            <MarkdownPreview
              content={content}
              onWikiLink={title => {
                resolveInternalLink(title)
              }}
              onLinkClick={href => {
                // If it's a web URL, open in browser directly
                if (/^https?:\/\//i.test(href)) { openExternal(href); return }
                // Try to resolve as a knowledge base page by extracting the title from the path
                const basename = href.replace(/^.*[/\\]/, '')
                const titleFromPath = basename.replace(/\.[^.]+$/, '')
                // Collect all matches, prioritized by href exact match first
                let matches = allPages.filter(p => p.title === href)
                if (matches.length === 0) matches = allPages.filter(p => p.title === basename)
                if (matches.length === 0) matches = allPages.filter(p => p.title === titleFromPath)
                if (matches.length === 1) {
                  onNavigate(matches[0].id)
                } else if (matches.length > 1) {
                  setWikiPicker({ title: titleFromPath || basename, candidates: matches })
                } else {
                  openExternal(href)
                }
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            <input
              className="w-full bg-transparent text-xl font-bold text-[var(--text-primary)] px-6 py-3 outline-none border-b border-[var(--border-color)] placeholder:text-[var(--text-disabled)] shrink-0"
              value={title}
              onChange={e => { setTitle(e.target.value); onTitleChange?.(e.target.value) }}
              placeholder="页面标题"
            />
            <div className="flex-1 min-h-0">
              <Editor
                language={getFileTypeInfo(fileType).monacoLang}
                value={content}
                onChange={v => { const c = v || ''; setContent(c); onContentChange?.(c) }}
                theme={s.theme === 'light' ? 'vs' : 'vs-dark'}
                onMount={handleEditorMount}
                loading={<div className="flex items-center justify-center h-full text-[var(--text-muted)]">加载编辑器...</div>}
                options={{
                  fontSize: Math.round(s.editorFontSize * zoom),
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
                  unicodeHighlight: { nonBasicASCII: false, ambiguousCharacters: false, invisibleCharacters: false },
                  selectionHighlight: true,
                  quickSuggestions: true,
                  suggest: { showWords: false },
                  placeholder: getFileTypeInfo(fileType).placeholder,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Wiki disambiguation picker */}
      {wikiPicker && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onClick={() => setWikiPicker(null)}>
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl flex flex-col"
            style={{ width: '420px', maxHeight: '400px' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-color)]">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                多处匹配 &mdash; 选择跳转到
              </span>
              <button onClick={() => setWikiPicker(null)} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
              <p className="px-4 py-1.5 text-[11px] text-[var(--text-muted)]">
                标题 "<span className="text-[var(--text-primary)] font-medium">{wikiPicker.title}</span>" 匹配到 {wikiPicker.candidates.length} 个页面：
              </p>
              {wikiPicker.candidates.map(p => {
                // Show breadcrumb: derive category chain from allPages
                const catChain = getCategoryChain(p, allPages)
                // Format createdAt e.g. "2026-06-15 14:30"
                const ts = p.createdAt ? new Date(p.createdAt) : null
                const dateStr = ts && !isNaN(ts.getTime())
                  ? ts.getFullYear() + '-' +
                    String(ts.getMonth() + 1).padStart(2, '0') + '-' +
                    String(ts.getDate()).padStart(2, '0') + ' ' +
                    String(ts.getHours()).padStart(2, '0') + ':' +
                    String(ts.getMinutes()).padStart(2, '0')
                  : null
                return (
                  <button
                    key={p.id}
                    onClick={() => { onNavigate(p.id); setWikiPicker(null) }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors group"
                  >
                    <FileText size={15} className="shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] text-[var(--text-primary)] truncate block">{p.title}</span>
                      {catChain && (
                        <span className="text-[10px] text-[var(--text-muted)] truncate block">{catChain}</span>
                      )}
                      {dateStr && (
                        <span className="text-[9px] text-[var(--text-muted)] block mt-0.5">创建于 {dateStr}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] group-hover:bg-[var(--accent)]/10">{p.fileType || 'md'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

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
            onDeleted()
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Right: Backlinks — collapsible */}
      <div className={`bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col transition-all duration-200 ${showBacklinks ? 'w-48' : 'w-1'}`}>
        {showBacklinks ? (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase">反向链接 · {backlinks.length}</span>
              <button
                onClick={() => setShowBacklinks(false)}
                className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title="折叠反向链接面板"
              >
                <ChevronRight size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {backlinks.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-[var(--text-disabled)] italic text-center">暂无反向链接</p>
              ) : (
                backlinks.map(bl => (
                  <div key={bl.id} onClick={() => onNavigate(bl.id)} className="px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] border-b border-[var(--border-color)]">
                    <span className="text-[12px] text-[var(--text-primary)] truncate block">{bl.title || '无标题'}</span>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          // Collapsed strip — click to expand
          <div
            className="flex-1 cursor-pointer hover:bg-[var(--accent)]/10 flex items-center justify-center"
            onClick={() => setShowBacklinks(true)}
            title="展开反向链接面板"
          >
            <ChevronLeft size={11} className="text-[var(--text-muted)]" />
          </div>
        )}
      </div>
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
