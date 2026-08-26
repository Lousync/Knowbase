import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Eye, Edit3, Star, FileText, ChevronDown, ExternalLink, X, ChevronRight, ChevronLeft, Plus, ImagePlus, StickyNote, Link2, BookOpen } from 'lucide-react'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'
import type { KnowledgePage, KnowledgeCategory, KnowledgeTag, KnowledgeBacklinkItem } from '../../../types'
import { getKnowledgePageById, updateKnowledgePage, getKnowledgeBacklinkContext, getKnowledgeManualLinks, addKnowledgeManualLink, removeKnowledgeManualLink, createKnowledgePage, updateKnowledgeLinks, toggleKnowledgeStar, getSetting, setSetting, getAttachmentsPath, openExternal, getKnowledgeTags, createKnowledgeTag, getAttachmentPath, readAttachmentBase64, readAttachmentBase64ByFileName } from '../../../lib/ipc'
import { useSettings } from '../../../lib/SettingsContext'
import { showToast } from '../../../lib/toast'
import { uploadImageFile, insertImageAtCursor, isImageFile, IMAGE_OWNER } from '../../../lib/editorImage'
import { FILE_LANG_OPTIONS, getFileTypeInfo } from '../../../lib/fileTypes'
import { isEditingInput } from '../../../lib/shortcuts'
import { getGlobalActiveTab } from '../../../lib/activeTab'
import { ConfirmDialog } from '../../../components/shared'
import { ResizablePanel } from '../../../components/shared/ResizablePanel'
import { PdfViewer } from './PdfViewer'
import Editor, { type OnMount } from '@monaco-editor/react'
import { monacoThemeFor } from '../../../lib/monaco-setup'
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
  onTagsChange?: () => void
  onMarkDirty?: () => void
  onClearDirty?: () => void
  /** 请求进入沉浸阅读模式（由父级切换布局） */
  onRequestReading?: () => void
}

export function PageEditor({ pageId, categories, allPages, zoom = 1, onBack, onDeleted, onNavigate, onUpdate, onTitleChange, onFileTypeChange, onContentChange, onTagsChange, onMarkDirty, onClearDirty, onRequestReading }: Props) {
  const { s } = useSettings()
  const [page, setPage] = useState<KnowledgePage | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [fileType, setFileTypeState] = useState('')
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [preview, setPreview] = useState(false)
  const [backlinks, setBacklinks] = useState<KnowledgeBacklinkItem[]>([])
  // 手动关联（双向）
  const [manualLinks, setManualLinks] = useState<KnowledgePage[]>([])
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  // 注解层（全类型通用）
  const [annotation, setAnnotation] = useState('')
  const [showAnnotation, setShowAnnotation] = useState(false)
  const savedAnnotationRef = useRef('')
  const annoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false)
  const [unsavedAction, setUnsavedAction] = useState<(() => void) | null>(null)
  // Tags
  const [allTags, setAllTags] = useState<KnowledgeTag[]>([])
  const [entryTags, setEntryTags] = useState<KnowledgeTag[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  // Wiki link disambiguation: when multiple pages share the same title
  const [wikiPicker, setWikiPicker] = useState<{ title: string; candidates: KnowledgePage[] } | null>(null)
  const [showBacklinks, setShowBacklinks] = useState(true)
  // Toolbar portals: render the editor toolbar into the tab bar row (merged layer 1 + 2)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setToolbarSlot(document.getElementById('editor-toolbar-slot'))
  }, [])
  const MAX_TAGS = 5
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const contentRef = useRef(content)
  const titleRef = useRef(title)
  const pageRef = useRef(page)
  const fileTypeRef = useRef(fileType)
  const tagsRef = useRef<KnowledgeTag[]>([])
  const isDirtyRef = useRef(false)
  const savedContentRef = useRef('')
  const savedTitleRef = useRef('')
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const pageIdRef = useRef(pageId)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const showDeleteConfirmRef = useRef(showDeleteConfirm)
  const showLangMenuRef = useRef(showLangMenu)
  const isCodeFileRef = useRef(false)
  const isPdfFileRef = useRef(false)

  const isCodeFile = fileType !== '' && fileType !== 'md' && fileType !== 'txt' && fileType !== 'pdf' && fileType !== 'xmind'
  const isPdfFile = fileType === 'pdf' || fileType === 'xmind'
  const isXmindFile = fileType === 'xmind'

  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => { pageIdRef.current = pageId }, [pageId])
  useEffect(() => { titleRef.current = title }, [title])
  useEffect(() => { pageRef.current = page }, [page])
  useEffect(() => { fileTypeRef.current = fileType }, [fileType])
  useEffect(() => { tagsRef.current = entryTags }, [entryTags])
  useEffect(() => { showDeleteConfirmRef.current = showDeleteConfirm }, [showDeleteConfirm])
  useEffect(() => { showLangMenuRef.current = showLangMenu }, [showLangMenu])
  useEffect(() => { isCodeFileRef.current = isCodeFile }, [isCodeFile])
  useEffect(() => { isPdfFileRef.current = isPdfFile }, [isPdfFile])

  const [attachmentsPath, setAttachmentsPath] = useState('')
  const [pdfBase64, setPdfBase64] = useState('')
  // PDF 阅读方式: builtin=内置阅读器, external=本地工具打开
  const [pdfReaderMode, setPdfReaderMode] = useState<'builtin' | 'external'>('builtin')
  const pdfReaderModeRef = useRef<'builtin' | 'external'>('builtin')

  useEffect(() => {
    getAttachmentsPath().then(setAttachmentsPath).catch(() => {})
    getSetting('pdfReaderMode').then(v => {
      const mode = v === 'external' ? 'external' : 'builtin'
      setPdfReaderMode(mode)
      pdfReaderModeRef.current = mode
    })
  }, [])

  // 用本地工具打开 PDF
  const openPdfExternal = useCallback(async () => {
    let filePath: string | null = null
    if (page?.attachmentId) {
      filePath = await getAttachmentPath(page.attachmentId)
    }
    if (!filePath && page) filePath = `${attachmentsPath}\\${page.contentMd}`
    if (filePath) openExternal(filePath)
  }, [page, attachmentsPath])

  const switchPdfReaderMode = useCallback((mode: 'builtin' | 'external') => {
    setPdfReaderMode(mode)
    pdfReaderModeRef.current = mode
    setSetting('pdfReaderMode', mode)
  }, [])

  // PDF 页面：读取附件内容供内置阅读器渲染
  useEffect(() => {
    setPdfBase64('')
    if (!page || page.fileType !== 'pdf') return
    let cancelled = false
    const load = async () => {
      let data: string | null = null
      if (page.attachmentId) {
        data = await readAttachmentBase64(page.attachmentId)
      }
      if (!data) {
        // 旧版附件（无 attachment_id，contentMd 存的是文件名）
        data = await readAttachmentBase64ByFileName(page.contentMd)
      }
      if (!cancelled && data) setPdfBase64(data)
    }
    load().catch(e => console.error('[PageEditor] load pdf base64 failed:', e))
    return () => { cancelled = true }
  }, [page?.id, page?.attachmentId, page?.fileType, page?.contentMd])

  useEffect(() => {
    Promise.all([
      getKnowledgePageById(pageId).then(p => {
        if (p) {
          setPage(p); setTitle(p.title); setContent(p.contentMd); setFileTypeState(p.fileType || ''); setEntryTags(p.tags || [])
          savedContentRef.current = p.contentMd || ''; savedTitleRef.current = p.title; isDirtyRef.current = false
          const anno = p.annotationMd || ''
          setAnnotation(anno); savedAnnotationRef.current = anno
          window.dispatchEvent(new CustomEvent('status-filetype', { detail: getFileTypeInfo(p.fileType || '').label }))
          onTitleChange?.(p.title)
          // 内容含附件示意图或内嵌动画的页面(如知识包导入)默认进入阅读预览
          if (p.fileType === 'md' && /(attachment:\/\/|language-anim@)/.test(p.contentMd || '')) setPreview(true)
        }
      }),
      getKnowledgeBacklinkContext(pageId).then(setBacklinks),
      getKnowledgeManualLinks(pageId).then(setManualLinks),
      getKnowledgeTags().then(setAllTags)
    ])
    setShowBacklinks(true)  // reset when switching pages
  }, [pageId])

  useEffect(() => {
    getSetting('skipDeleteConfirm_knowledge').then(v => {
      if (v === true) setSkipDeleteConfirm(true)
    })
  }, [])

  const doSave = useCallback(async (t: string, c: string) => {
    if (!pageRef.current) return
    try {
      // 双链解析范围：正文 + 注解层
      const links = parseWikiLinks(c + '\n' + savedAnnotationRef.current)
      await updateKnowledgePage(pageRef.current.id, { title: t, contentMd: c, contentHtml: '', fileType: fileTypeRef.current, tags: tagsRef.current.map(tag => tag.id) })
      await updateKnowledgeLinks(pageRef.current.id, links)
      isDirtyRef.current = false
      savedContentRef.current = c
      savedTitleRef.current = t
      setSaving(false)
      onClearDirty?.()
    } catch (e) { console.error(e) }
  }, [])

  // 注解独立防抖保存（不触碰 content 的脏状态机）
  const saveAnnotation = useCallback(async (id: string, value: string) => {
    try {
      await updateKnowledgePage(id, { annotationMd: value })
      savedAnnotationRef.current = value
      // 注解里的双链也要入图
      await updateKnowledgeLinks(id, parseWikiLinks(savedContentRef.current + '\n' + value))
      void getKnowledgeBacklinkContext(id).then(setBacklinks)
    } catch (e) { console.error('[PageEditor] save annotation failed:', e) }
  }, [])

  const handleAnnotationChange = useCallback((v: string) => {
    setAnnotation(v)
    if (!pageRef.current) return
    if (annoTimerRef.current) clearTimeout(annoTimerRef.current)
    annoTimerRef.current = setTimeout(() => {
      void saveAnnotation(pageRef.current!.id, v)
    }, 500)
  }, [saveAnnotation])

  // ---- 手动关联 ----
  const handleAddManualLink = useCallback(async (targetId: string) => {
    if (!pageRef.current) return
    const res = await addKnowledgeManualLink(pageRef.current.id, targetId)
    if (res.ok) {
      setManualLinks(await getKnowledgeManualLinks(pageRef.current.id))
      showToast({ type: 'info', message: '已建立关联' })
    }
    setLinkPickerOpen(false); setLinkQuery('')
  }, [])

  const handleRemoveManualLink = useCallback(async (targetId: string) => {
    if (!pageRef.current) return
    await removeKnowledgeManualLink(pageRef.current.id, targetId)
    setManualLinks(await getKnowledgeManualLinks(pageRef.current.id))
  }, [])

  /**
   * 关联选择器候选：按相关性打分排序，并给出可解释的推荐理由。
   * 评分 = 共享标签 ×3 + 同章节 ×2 + 最近编辑(14天内) ×1；无命中时按更新时间兜底。
   */
  const linkCandidates = useMemo(() => {
    const q = linkQuery.trim().toLowerCase()
    const linkedIds = new Set(manualLinks.map(m => m.id))
    const curCat = page?.categoryId ?? null
    const curTagIds = new Set(entryTags.map(t => t.id))
    const now = Date.now()

    return allPages
      .filter(p => p.id !== pageId && !linkedIds.has(p.id))
      .map(p => {
        const reasons: string[] = []
        let score = 0
        if (curCat && p.categoryId === curCat) {
          score += 2
          reasons.push('同章节')
        }
        const shared = (p.tags || []).filter(t => curTagIds.has(t.id))
        if (shared.length > 0) {
          score += shared.length * 3
          reasons.push(`共享标签 ${shared.map(t => t.name).join('、')}`)
        }
        const upd = new Date(p.updatedAt).getTime()
        if (!isNaN(upd) && now - upd < 14 * 86400_000) {
          score += 1
          reasons.push('最近编辑')
        }
        return { page: p, score, reasons }
      })
      .filter(({ page: p }) => {
        if (!q) return true
        return p.title.toLowerCase().includes(q) ||
          (p.tags || []).some(t => t.name.toLowerCase().includes(q))
      })
      .sort((a, b) => b.score - a.score ||
        new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime())
      .slice(0, 8)
  }, [allPages, manualLinks, pageId, linkQuery, page?.categoryId, entryTags])

  /** 已知页面标题集合（供预览区分空链接） */
  const knownWikiTitles = useMemo(() => new Set(allPages.map(p => p.title)), [allPages])

  useEffect(() => {
    if (!page) return
    // Mark dirty when content/title diverges from saved version
    if (content !== savedContentRef.current || title !== savedTitleRef.current) {
      isDirtyRef.current = true
      setSaving(true)
      onMarkDirty?.()
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => doSave(title, content), s.autoSaveDebounceMs)
    }
    return () => clearTimeout(saveTimer.current)
  }, [title, content, page, doSave])

  // Keyboard shortcuts: Ctrl+S, Ctrl+/, Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getGlobalActiveTab() !== 'knowledge') return
      // Ctrl+S — save immediately (always fire, even in Monaco)
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault()
        clearTimeout(saveTimer.current)
        doSave(titleRef.current, contentRef.current).then(() => { setSaving(false); onClearDirty?.() })
        return
      }

      if (isEditingInput(e)) return

      // Ctrl+/ — toggle preview (md/txt only)
      if (e.ctrlKey && e.key === '/') {
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
        if (checkUnsaved()) { setUnsavedAction(() => onBack); return }
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

  // ===== Inline image insertion (paste / drag / toolbar) — md/txt only =====
  const insertImageFiles = useCallback(async (files: File[]) => {
    if (isCodeFileRef.current || isPdfFileRef.current) return
    const editor = editorRef.current
    if (!editor) return
    for (const f of files) {
      if (!isImageFile(f)) continue
      try {
        const meta = await uploadImageFile(f, IMAGE_OWNER.knowledge, pageIdRef.current)
        insertImageAtCursor(editor, meta)
      } catch {
        showToast({ type: 'error', message: `图片「${f.name}」插入失败` })
      }
    }
  }, [])

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

    // Image paste / drag-drop (md/txt only; gated inside handlers)
    const dom = editor.getDomNode()
    if (dom) {
      const onPaste = (ev: ClipboardEvent) => {
        if (isCodeFileRef.current || isPdfFileRef.current) return
        const items = ev.clipboardData?.items
        if (!items) return
        const files: File[] = []
        for (const it of Array.from(items)) {
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile()
            if (f) files.push(f)
          }
        }
        if (files.length === 0) return
        ev.preventDefault()
        ev.stopPropagation()
        void insertImageFiles(files)
      }
      const onDragOver = (ev: DragEvent) => {
        if (isCodeFileRef.current || isPdfFileRef.current) return
        if (ev.dataTransfer && Array.from(ev.dataTransfer.types).includes('Files')) ev.preventDefault()
      }
      const onDrop = (ev: DragEvent) => {
        if (isCodeFileRef.current || isPdfFileRef.current) return
        const files = ev.dataTransfer?.files
        if (!files || files.length === 0) return
        const imageFiles = Array.from(files).filter(f => isImageFile(f))
        if (imageFiles.length === 0) return
        ev.preventDefault()
        ev.stopPropagation()
        const target = editor.getTargetAtClientPoint(ev.clientX, ev.clientY)
        if (target?.position) editor.setPosition(target.position)
        editor.focus()
        void insertImageFiles(imageFiles)
      }
      dom.addEventListener('paste', onPaste, true)
      dom.addEventListener('dragover', onDragOver, true)
      dom.addEventListener('drop', onDrop, true)
    }
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

  const handleAddTag = async () => {
    const name = newTagName.trim()
    if (!name) { setShowTagInput(false); return }
    if (entryTags.length >= MAX_TAGS) { setShowTagInput(false); setNewTagName(''); return }
    let tag = allTags.find(t => t.name === name)
    if (!tag) {
      try {
        tag = await createKnowledgeTag(name)
        setAllTags(prev => [...prev, tag!])
      } catch (e) { console.error(e); return }
    }
    if (!entryTags.find(t => t.id === tag!.id)) {
      setEntryTags(prev => [...prev, tag!])
    }
    setNewTagName(''); setShowTagInput(false)
    onTagsChange?.()
  }

  const handleRemoveTag = (tagId: string) => {
    setEntryTags(prev => prev.filter(t => t.id !== tagId))
    onTagsChange?.()
  }

  // Check for unsaved changes — returns true if blocked
  const checkUnsaved = useCallback(() => {
    if (isDirtyRef.current) {
      setShowUnsavedConfirm(true)
      return true
    }
    return false
  }, [])

  if (!page) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="border-2 border-[var(--border-color)] border-t-[#007acc] rounded-full w-5 h-5 animate-spin" />
    </div>
  )

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

  // Resolve a title to knowledge base pages. If >1 match, show picker.
  // If 0 → offer to create the page (P1 空链接建页闭环).
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
    if (!window.confirm(`知识库中还没有「${title}」这个页面，是否现在创建？`)) return false
    void (async () => {
      try {
        const created = await createKnowledgePage({
          title,
          categoryId: page?.categoryId ?? null,
          fileType: 'md',
          contentMd: `# ${title}\n\n`,
        })
        showToast({ type: 'info', message: `页面「${title}」已创建` })
        onUpdate()
        onNavigate(created.id)
      } catch (e) {
        console.error('[PageEditor] create page from wiki link failed:', e)
        showToast({ type: 'error', message: '创建失败，请重试' })
      }
    })()
    return true
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Toolbar — portaled into the tab bar row (merged layer 1 + 2) */}
      {toolbarSlot && createPortal(
        <>
          <button
            onClick={handleToggleStar}
            className={`p-1.5 rounded ${page.isStarred ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'} hover:text-[var(--warning)] transition-colors`}
            title="收藏"
          >
            <Star size={15} fill={page.isStarred ? '#c5a332' : 'none'} />
          </button>
          {/* 添加关联：始终可见的入口（右栏折叠时也能用） */}
          <button
            onClick={() => { setShowBacklinks(true); setLinkPickerOpen(true) }}
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors"
            title="添加关联（连接到其他页面）"
          >
            <Link2 size={15} />
          </button>
          {/* 沉浸阅读入口：仅 md/txt */}
          {(fileType === 'md' || fileType === 'txt') && (
            <button
              onClick={() => onRequestReading?.()}
              className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors"
              title="沉浸阅读 (Ctrl+Shift+R)"
            >
              <BookOpen size={15} />
            </button>
          )}
          {!isPdfFile && (
            <div className="relative">
              <button onClick={() => setShowLangMenu(v => !v)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-colors"
                title="切换文件格式">
                {getFileTypeInfo(fileType).label}
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
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${saving ? 'bg-[var(--warning)] animate-pulse' : 'bg-green-500'}`}
            title={saving ? '保存中…' : '已保存'}
          />
          {!isCodeFile && !isPdfFile && (
            <>
              {!preview && (
                <button onClick={() => imageInputRef.current?.click()} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" title="插入图片">
                  <ImagePlus size={15} />
                </button>
              )}
              <button onClick={() => setPreview(v => !v)} className={`p-1.5 rounded text-xs ${preview ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`} title="Ctrl+/">
                {preview ? <Edit3 size={15} /> : <Eye size={15} />}
              </button>
            </>
          )}
          <button onClick={handleDelete} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--danger)] transition-colors" title="删除">
            <Trash2 size={15} />
          </button>
        </>,
        toolbarSlot
      )}

      {/* Main editing area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 注解层：非 md/txt 页面的通用备注条（支持 [[双链]]，自动入图） */}
        {fileType !== 'md' && fileType !== 'txt' && (
          <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <button onClick={() => setShowAnnotation(o => !o)}
              className="w-full flex items-center gap-1.5 px-4 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="展开/收起注解">
              <StickyNote size={12} className={annotation ? 'text-[var(--warning)]' : ''} />
              <span>注解{annotation ? ' · 已填写' : ''}</span>
              <span className="flex-1" />
              {showAnnotation ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {showAnnotation && (
              <textarea
                value={annotation}
                onChange={e => handleAnnotationChange(e.target.value)}
                rows={3}
                placeholder="给这份文件写点备注，可用 [[双链]] 关联其他页面…"
                className="w-full px-4 pb-2 bg-transparent text-[12px] text-[var(--text-primary)] outline-none resize-none placeholder-[var(--text-disabled)]"
              />
            )}
          </div>
        )}

        {/* Content */}
        {isXmindFile ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--text-secondary)]">
              <FileText size={64} className="opacity-20" />
              <p className="text-sm">XMind 思维导图 — 使用 XMind 软件打开编辑</p>
              <button
                onClick={async () => {
                  let filePath: string | null = null
                  if (page.attachmentId) {
                    filePath = await getAttachmentPath(page.attachmentId)
                  }
                  if (!filePath) filePath = `${attachmentsPath}\\${page.contentMd}`
                  if (filePath) openExternal(filePath)
                }}
                className="flex items-center gap-2 px-4 py-2 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors"
              >
                <ExternalLink size={15} />
                使用 XMind 打开
              </button>
            </div>
          </div>
        ) : isPdfFile ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-2 border-b border-[var(--border-color)] shrink-0">
              <span className="flex-1 truncate text-[15px] font-semibold text-[var(--text-primary)] min-w-0">{title || 'PDF 文档'}</span>
              {/* 阅读方式切换 */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => switchPdfReaderMode('builtin')}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${pdfReaderMode === 'builtin' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                  title="使用内置阅读器（在应用内阅读）"
                >
                  内置阅读
                </button>
                <button
                  onClick={() => switchPdfReaderMode('external')}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${pdfReaderMode === 'external' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                  title="使用本地工具打开"
                >
                  本地打开
                </button>
              </div>
            </div>

            {pdfReaderMode === 'builtin' ? (
              pdfBase64 ? (
                <PdfViewer base64={pdfBase64} title={title || 'PDF 文档'} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--text-secondary)]">
                  <FileText size={64} className="opacity-20" />
                  <p className="text-sm">正在加载 PDF…</p>
                  <button onClick={openPdfExternal}
                    className="flex items-center gap-2 px-4 py-2 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors">
                    <ExternalLink size={15} />
                    使用本地工具打开
                  </button>
                </div>
              )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--text-secondary)]">
                <FileText size={64} className="opacity-20" />
                <p className="text-sm">PDF 文档将使用本地工具打开</p>
                <button onClick={openPdfExternal}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors">
                  <ExternalLink size={15} />
                  使用本地工具打开
                </button>
              </div>
            )}
          </div>
        ) : preview ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <h1 className="text-xl font-bold text-[var(--text-primary)] mb-3">{title}</h1>
            <MarkdownPreview
              content={content}
              knownWikiTitles={knownWikiTitles}
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
            <div className="flex-1 min-h-0">
              <Editor
                language={getFileTypeInfo(fileType).monacoLang}
                value={content}
                onChange={v => { const c = v || ''; setContent(c); onContentChange?.(c) }}
                theme={monacoThemeFor(s.theme)}
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

        {/* Tag bar — bottom metadata strip */}
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-t border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0 overflow-x-auto">
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
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files || [])
          if (files.length > 0) void insertImageFiles(files)
          e.target.value = ''
        }}
      />

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

      {/* Unsaved changes confirm dialog */}
      <ConfirmDialog
        open={showUnsavedConfirm}
        title="未保存的更改"
        message="当前页面有未保存的更改，确定要离开吗？"
        confirmLabel="离开"
        onConfirm={() => {
          setShowUnsavedConfirm(false)
          if (unsavedAction) { const a = unsavedAction; setUnsavedAction(null); a() }
        }}
        onCancel={() => { setShowUnsavedConfirm(false); setUnsavedAction(null) }}
      />

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

      {/* Right: 关联 + 反向链接 — 与左侧栏同款 ResizablePanel（拖拽调宽 / 拖过半程吸边收起 / 从边缘拖出展开） */}
      <ResizablePanel
        storageKey="knowledgeRailWidth"
        defaultWidth={224}
        minWidth={160}
        maxWidth={400}
        visible={showBacklinks}
        side="right"
        collapsedWidth={12}
        onSnapClose={() => setShowBacklinks(false)}
        onSnapOpen={() => setShowBacklinks(true)}
      >
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] shrink-0">
            <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase">关联网络</span>
            <button
              onClick={() => setShowBacklinks(false)}
              className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="收起（从右缘拖出可再展开）"
            >
              <ChevronRight size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
                {/* 手动关联 */}
                <div className="flex items-center gap-1 px-3 pt-2 pb-1">
                  <Link2 size={11} className="text-[var(--text-muted)]" />
                  <span className="flex-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">手动关联 · {manualLinks.length}</span>
                  <button onClick={() => setLinkPickerOpen(true)}
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors"
                    title="添加关联">
                    <Plus size={12} />
                  </button>
                </div>
                {manualLinks.map(ml => (
                  <div key={ml.id} onClick={() => onNavigate(ml.id)}
                    className="group relative px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] border-b border-[var(--border-color)] border-dashed">
                    <span className="text-[12px] text-[var(--text-primary)] truncate block pr-4">{ml.title || '无标题'}</span>
                    <button
                      onClick={e => { e.stopPropagation(); void handleRemoveManualLink(ml.id) }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:block p-0.5 rounded text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      title="解除关联"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {manualLinks.length === 0 && (
                  <p className="px-3 py-1 text-[10px] text-[var(--text-muted)] leading-relaxed">暂无。点 + 把相关页面连进来。</p>
                )}

                {/* 反向链接（带上下文摘录） */}
                <div className="flex items-center gap-1 px-3 pt-3 pb-1">
                  <StickyNote size={11} className="text-[var(--text-muted)]" />
                  <span className="flex-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">被引用 · {backlinks.length}</span>
                </div>
                {backlinks.map(bl => (
                  <div key={bl.id} onClick={() => onNavigate(bl.id)} className="px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] border-b border-[var(--border-color)]">
                    <span className="text-[12px] text-[var(--text-primary)] truncate block">{bl.title || '无标题'}</span>
                    {bl.excerpt && (
                      <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-muted)] line-clamp-3">{bl.excerpt}</p>
                    )}
                  </div>
                ))}
              </div>
        </div>
      </ResizablePanel>

      {/* 手动关联选择器 */}
      {linkPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-24" onClick={() => setLinkPickerOpen(false)}>
          <div className="w-[380px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center gap-2">
              <Link2 size={14} className="text-[var(--accent)] shrink-0" />
              <input autoFocus value={linkQuery}
                onChange={e => setLinkQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && linkCandidates[0]) void handleAddManualLink(linkCandidates[0].page.id)
                  if (e.key === 'Escape') { setLinkPickerOpen(false); setLinkQuery('') }
                }}
                placeholder="搜索要关联的页面…"
                className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none"
              />
              <button onClick={() => { setLinkPickerOpen(false); setLinkQuery('') }}
                className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {linkCandidates.length === 0 && (
                <p className="px-4 py-6 text-[12px] text-[var(--text-muted)] text-center">没有匹配的页面</p>
              )}
              {linkCandidates.map(({ page: c, reasons }) => (
                <button key={c.id} onClick={() => void handleAddManualLink(c.id)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors">
                  <FileText size={13} className="text-[var(--text-muted)] shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--text-primary)]">{c.title || '无标题'}</span>
                    {reasons.length > 0 && (
                      <span className="block truncate text-[10px] mt-0.5" style={{ color: 'var(--accent)' }}>
                        {reasons.join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">{c.fileType || 'md'}</span>
                </button>
              ))}
            </div>
            <div className="px-4 py-1.5 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)] flex justify-between">
              <span>按 同章节 / 共享标签 / 最近编辑 推荐</span><span>Enter 添加第一个</span>
            </div>
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
