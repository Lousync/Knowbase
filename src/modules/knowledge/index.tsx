import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FileText, Folder, ListTree, X } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage, KnowledgeTag } from '../../types'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'
import {
  getKnowledgeCategories, createKnowledgeCategory, updateKnowledgeCategory, deleteKnowledgeCategory,
  getKnowledgePages, getKnowledgePageById, createKnowledgePage, deleteKnowledgePage,
  searchKnowledgePages, getKnowledgeStarredPages,
  moveKnowledgePage, moveKnowledgeCategory,
  updateKnowledgePage, toggleKnowledgeStar,
  showImportOpenDialog, readImportFiles, importPdf, importPdfFile, importBinaryFile,
  showFolderDialog, importFolder,
  duplicateKnowledgePage, duplicateKnowledgeCategory,
  showExportSaveDialog, writeExportTextFile,
  getKnowledgeTags
} from '../../lib/ipc'
import { showToast } from '../../lib/toast'
import { NotebookList } from './components/NotebookList'
import { ChapterPanel } from './components/ChapterPanel'
import { SpacePanel } from './components/SpacePanel'
import { PageEditor } from './components/PageEditor'
import { PageTabBar, type PageInfo } from './components/PageTabBar'
import { QuickSearch } from './components/QuickSearch'
import { ConfirmDialog } from '../../components/shared'
import { OutlinePanel, parseHeadings } from '../../components/shared/OutlinePanel'
import { ImportZone } from '../shared/components/ImportZone'
import { ResizablePanel } from '../../components/shared/ResizablePanel'
import { isEditingInput } from '../../lib/shortcuts'
import { getGlobalActiveTab } from '../../lib/activeTab'

// ---- 剪贴板类型 ----
interface ClipItem { type: 'category' | 'page'; id: string }
interface ClipboardData { action: 'copy' | 'cut'; items: ClipItem[] }

export function KnowledgeModule({ sidebarOpen = true, zoom = 1, sidebarWidths = {} as Record<string, number>, onSnapCloseSidebar, onSnapOpenSidebar, isActive = true }: { sidebarOpen?: boolean; zoom?: number; sidebarWidths?: Record<string, number>; onSnapCloseSidebar?: () => void; onSnapOpenSidebar?: () => void; isActive?: boolean }) {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [allPages, setAllPages] = useState<KnowledgePage[]>([])
  const [chapterPages, setChapterPages] = useState<KnowledgePage[]>([])
  const [starredPages, setStarredPages] = useState<KnowledgePage[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [focusChapterId, setFocusChapterId] = useState<string | null>(null)  // when set, ChapterPanel shows only this chapter
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [openPageIds, setOpenPageIds] = useState<string[]>([])
  const [openPageInfos, setOpenPageInfos] = useState<Record<string, PageInfo>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const [showCategoryPanel, setShowCategoryPanel] = useState(true)
  const [showChapterPanel, setShowChapterPanel] = useState(true)
  const [showOutline, setShowOutline] = useState(false)
  const [liveContent, setLiveContent] = useState('')
  const [locatePageId, setLocatePageId] = useState<string | null>(null)
  const [locateCategoryId, setLocateCategoryId] = useState<string | null>(null)
  const [allKnowledgeTags, setAllKnowledgeTags] = useState<KnowledgeTag[]>([])

  // ---- 剪贴板 ----
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)

  // ---- 预览标签页（VS Code 风格） ----
  const [dirtyPageIds, setDirtyPageIds] = useState<Set<string>>(new Set())
  const dirtyPageIdsRef = useRef(dirtyPageIds)
  useEffect(() => { dirtyPageIdsRef.current = dirtyPageIds }, [dirtyPageIds])

  // ---- 未保存关闭确认 ----
  const [unsavedClosePageId, setUnsavedClosePageId] = useState<string | null>(null)

  const openPageIdsRef = useRef(openPageIds)
  const activePageIdRef = useRef(activePageId)
  const selectedCategoryIdRef = useRef(selectedCategoryId)
  const selectedChapterIdRef = useRef(selectedChapterId)
  useEffect(() => { openPageIdsRef.current = openPageIds }, [openPageIds])
  useEffect(() => { activePageIdRef.current = activePageId }, [activePageId])
  useEffect(() => {
    setLiveContent('')  // reset live outline when switching pages
    if (!activePageId) {
      // No active page → close outline, keep sidebar state unchanged
      setShowOutline(false)
    }
  }, [activePageId])
  useEffect(() => { selectedCategoryIdRef.current = selectedCategoryId }, [selectedCategoryId])
  useEffect(() => { selectedChapterIdRef.current = selectedChapterId }, [selectedChapterId])

  useEffect(() => {
    if (sidebarOpen) {
      setShowCategoryPanel(true)
      // Only restore chapter panel for notebooks, not folders
      const cat = selectedCategoryId ? categories.find(c => c.id === selectedCategoryId) : null
      setShowChapterPanel(cat?.categoryType === 'notebook')
    }
  }, [sidebarOpen])

  // --- derived ---
  const chapters = categories.filter(c => c.parentId === selectedCategoryId)
  const selectedCategory = selectedCategoryId ? categories.find(c => c.id === selectedCategoryId) : null
  const selectedSpace = selectedSpaceId ? categories.find(c => c.id === selectedSpaceId) ?? null : null
  const allLoosePages = useMemo(() => allPages.filter(p => p.categoryId === null), [allPages])

  // --- data loading ---
  const refreshCategories = useCallback(async () => {
    try { setCategories(await getKnowledgeCategories()) } catch (e) { console.error(e) }
  }, [])

  const refreshAllPages = useCallback(async () => {
    try { setAllPages(await getKnowledgePages()) } catch (e) { console.error(e) }
  }, [])

  const refreshChapterPages = useCallback(async () => {
    if (!selectedChapterId) { setChapterPages([]); return }
    try {
      // 列表项为瘦身载荷,反链在编辑器内按需查询
      setChapterPages(await getKnowledgePages(selectedChapterId))
    } catch (e) { console.error(e) }
  }, [selectedChapterId])

  const refreshStarred = useCallback(async () => {
    try { setStarredPages(await getKnowledgeStarredPages()) } catch (e) { console.error(e) }
  }, [])

  const refreshTags = useCallback(async () => {
    try { setAllKnowledgeTags(await getKnowledgeTags()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([refreshCategories(), refreshAllPages(), refreshStarred(), refreshTags()])
      .finally(() => setLoading(false))
    console.log('[Knowledge] module mounted · net-v2（手动关联/注解/沉浸阅读已启用）')
  }, [])

  // 监听数据导入事件 — 导入完成后刷新所有数据
  useEffect(() => {
    const handler = () => { refreshCategories(); refreshAllPages(); refreshStarred(); refreshTags() }
    window.addEventListener('data-imported', handler)
    return () => window.removeEventListener('data-imported', handler)
  }, [refreshCategories, refreshAllPages, refreshStarred])

  // 监听回收站恢复事件 — 恢复页面/目录/空间后立即刷新，恢复的位置立即可见
  useEffect(() => {
    const handler = (e: Event) => {
      const module = (e as CustomEvent).detail?.module
      if (module === 'knowledge' || module === 'knowledge_category') {
        refreshCategories(); refreshAllPages(); refreshChapterPages(); refreshStarred()
      }
    }
    window.addEventListener('recycle-restored', handler)
    return () => window.removeEventListener('recycle-restored', handler)
  }, [refreshCategories, refreshAllPages, refreshChapterPages, refreshStarred])

  useEffect(() => { refreshChapterPages() }, [refreshChapterPages])

  // --- notebook CRUD ---
  const handleCreateNotebook = async (name: string, categoryType: 'folder' | 'notebook' | 'space', parentId: string | null) => {
    await createKnowledgeCategory({ name, parentId, categoryType })
    refreshCategories()
  }
  const handleRenameNotebook = async (id: string, name: string) => {
    await updateKnowledgeCategory(id, { name })
    refreshCategories()
  }
  const handleRenamePage = async (id: string, name: string) => {
    await updateKnowledgePage(id, { title: name })
    setAllPages(prev => prev.map(p => p.id === id ? { ...p, title: name } : p))
    setChapterPages(prev => prev.map(p => p.id === id ? { ...p, title: name } : p))
    setStarredPages(prev => prev.map(p => p.id === id ? { ...p, title: name } : p))
    setOpenPageInfos(prev => {
      const existing = prev[id]
      return existing ? { ...prev, [id]: { ...existing, title: name } } : prev
    })
    refreshAllPages(); refreshChapterPages()
  }
  const handleDeleteNotebook = async (id: string) => {
    await deleteKnowledgeCategory(id)
    if (selectedCategoryId === id) { setSelectedCategoryId(null); setSelectedChapterId(null) }
    if (selectedSpaceId === id) { setSelectedSpaceId(null); setSelectedChapterId(null); setFocusChapterId(null); setShowChapterPanel(false) }
    refreshCategories(); refreshAllPages()
  }

  // --- chapter CRUD ---
  const handleCreateChapter = async (name: string) => {
    if (!selectedCategoryId) return
    const selected = categories.find(c => c.id === selectedCategoryId)
    if (selected?.categoryType !== 'notebook') return
    await createKnowledgeCategory({ name, parentId: selectedCategoryId, categoryType: 'folder' })
    refreshCategories()
  }
  const handleRenameChapter = async (id: string, name: string) => {
    await updateKnowledgeCategory(id, { name })
    refreshCategories()
  }
  const handleDeleteChapter = async (id: string) => {
    await deleteKnowledgeCategory(id)
    if (selectedChapterId === id) setSelectedChapterId(null)
    refreshCategories(); refreshChapterPages()
  }

  // --- page CRUD ---
  const handleCreatePageNamed = async (categoryId: string | null, title: string) => {
    try {
      const p = await createKnowledgePage({ title, categoryId })
      handleOpenPage(p.id)
      await refreshAllPages()
      if (selectedChapterId === categoryId) refreshChapterPages()
    } catch (e) { console.error(e) }
  }

  const handleCreateChapterUnderNotebook = async (notebookId: string) => {
    const newChapter = await createKnowledgeCategory({ name: '新章节', parentId: notebookId, categoryType: 'folder' })
    await refreshCategories()
    // Auto-select notebook + new chapter so user sees it highlighted in ChapterPanel
    setSelectedCategoryId(notebookId)
    setSelectedChapterId(newChapter.id)
    setFocusChapterId(null)
    setShowChapterPanel(true)
  }

  const handleImportFolder = async () => {
    try {
      const paths: string[] = await showFolderDialog()
      if (!paths || paths.length === 0) return
      const catId = selectedChapterId || null
      for (const folderPath of paths) {
        const result = await importFolder(folderPath, catId)
        if (result && 'error' in result) {
          console.error('Folder import failed:', result.error)
          showToast({ type: 'error', message: `导入文件夹失败: ${result.error}` })
        } else if (result) {
          showToast({ type: 'info', message: `已导入「${result.name}」(${result.fileCount} 文件, ${result.folderCount} 子目录)` })
        }
      }
      refreshCategories(); refreshAllPages()
    } catch (e) { console.error(e); showToast({ type: 'error', message: '导入文件夹失败' }) }
  }

  const handleDialogImport = async () => {
    try {
      const paths: string[] = await showImportOpenDialog()
      if (!paths || paths.length === 0) return

      // Separate binary (PDF/XMind) from text files
      const binaryPaths = paths.filter(p => p.toLowerCase().endsWith('.pdf') || p.toLowerCase().endsWith('.xmind'))
      const textPaths = paths.filter(p => !binaryPaths.includes(p))

      // Import text files
      if (textPaths.length > 0) {
        const results = await readImportFiles(textPaths)
        for (const r of results) {
          if (r.error) continue
          const catId = selectedChapterId || null
          await createKnowledgePage({ title: r.baseName || '导入页面', contentMd: r.content, categoryId: catId, fileType: r.fileType || '' })
        }
      }

      // Import binary files
      for (const bp of binaryPaths) {
        const ext = bp.toLowerCase().split('.').pop() || ''
        const result = ext === 'pdf' ? await importPdfFile(bp) : await importBinaryFile(bp, ext)
        if (result.error) console.error(`${ext} import failed:`, result.error)
      }

      if (selectedChapterId) refreshChapterPages()
      else refreshAllPages()
    } catch (e) { console.error(e) }
  }

  const handleDropImport = async (files: Array<{ title: string; content: string; fileType: string }>) => {
    try {
      const catId = selectedChapterId || null
      for (const f of files) {
        await createKnowledgePage({ title: f.title, contentMd: f.content, categoryId: catId, fileType: f.fileType || '' })
      }
      if (selectedChapterId) refreshChapterPages()
      else refreshAllPages()
    } catch (e) { console.error(e) }
  }

  const handleDropImportBinary = async (files: Array<{ title: string; base64: string; fileName: string }>) => {
    try {
      for (const f of files) {
        const ext = f.fileName.toLowerCase().split('.').pop() || ''
        if (ext === 'pdf') await importPdf(f.base64, f.fileName)
        else await importBinary(f.base64, f.fileName, ext)
      }
      refreshAllPages()
    } catch (e) { console.error(e) }
  }

  // --- 沉浸阅读模式 ---
  const [readingMode, setReadingMode] = useState(false)
  const [readingPage, setReadingPage] = useState<KnowledgePage | null>(null)

  const enterReading = useCallback(async () => {
    const id = activePageIdRef.current
    if (!id) { showToast({ type: 'warning', message: '请先打开一个页面' }); return }
    try {
      const p = await getKnowledgePageById(id)
      if (!p) return
      const ft = (p.fileType || 'md').toLowerCase()
      if (ft !== 'md' && ft !== 'txt') {
        showToast({ type: 'warning', message: '沉浸阅读仅支持 md / txt 页面' })
        return
      }
      setReadingPage(p)
      setReadingMode(true)
    } catch (e) { console.error(e) }
  }, [])

  const exitReading = useCallback(() => {
    setReadingMode(false)
    setReadingPage(null)
  }, [])

  const openInReading = useCallback(async (pageId: string) => {
    try {
      const p = await getKnowledgePageById(pageId)
      if (p) setReadingPage(p)
    } catch (e) { console.error(e) }
  }, [])

  // --- tab management (VS Code preview mode) ---
  const handleOpenPage = useCallback(async (pageId: string) => {
    let info = [...allLoosePages, ...chapterPages, ...starredPages].find(p => p.id === pageId)
    if (!info || !info.fileType) {
      try { info = await getKnowledgePageById(pageId) ?? undefined } catch {}
    }
    if (info) {
      setOpenPageInfos(prev => ({ ...prev, [pageId]: { title: info!.title, fileType: info!.fileType || '' } }))
    }

    const currentIds = openPageIdsRef.current
    const activeId = activePageIdRef.current

    // If already open, just switch to it
    if (currentIds.includes(pageId)) {
      setActivePageId(pageId)
      return
    }

    // VS Code-style preview: if current tab is not dirty, replace it (single preview slot)
    const dirty = dirtyPageIdsRef.current
    const replaceCurrent = activeId && !dirty.has(activeId)

    if (replaceCurrent) {
      // Replace the non-dirty preview tab
      setOpenPageIds([pageId])
      setOpenPageInfos(prev => {
        const next = { ...prev }
        delete next[activeId]
        next[pageId] = { title: info?.title ?? '', fileType: info?.fileType ?? '' }
        return next
      })
    } else {
      // Append as a new tab (dirty tab stays, or explicitly opened)
      setOpenPageIds(prev => [...prev, pageId])
    }

    setActivePageId(pageId)
  }, [allLoosePages, chapterPages, starredPages])

  const handleCloseTab = useCallback((pageId: string) => {
    // Check unsaved changes
    const dirty = dirtyPageIdsRef.current
    if (dirty.has(pageId)) {
      setUnsavedClosePageId(pageId)
      return
    }
    forceCloseTab(pageId)
  }, [])

  const forceCloseTab = useCallback((pageId: string) => {
    const currentIds = openPageIdsRef.current
    const idx = currentIds.indexOf(pageId)
    if (idx === -1) return
    const nextIds = currentIds.filter(id => id !== pageId)
    setOpenPageIds(nextIds)
    setOpenPageInfos(prev => { const next = { ...prev }; delete next[pageId]; return next })
    setDirtyPageIds(prev => { const next = new Set(prev); next.delete(pageId); return next })
    if (activePageIdRef.current === pageId) {
      if (nextIds.length === 0) {
        setActivePageId(null)
        // All tabs closed — just close outline, keep sidebar state unchanged
        setShowOutline(false)
      }
      else { const newIdx = Math.min(idx, nextIds.length - 1); setActivePageId(nextIds[newIdx]) }
    }
  }, [])

  const handlePageDeleted = useCallback(async (id: string) => {
    await deleteKnowledgePage(id)
    // 页面已删除，清除脏标记后直接关闭标签页（无需确认未保存）
    setDirtyPageIds(prev => { const n = new Set(prev); n.delete(id); return n })
    forceCloseTab(id)
    await refreshAllPages()
    await refreshChapterPages()
    refreshStarred()
    // After delete, if no page is active but the chapter still has pages, auto-open first one
    const nextActiveId = activePageIdRef.current
    const chId = selectedChapterIdRef.current
    if (!nextActiveId && chId) {
      const pages = await getKnowledgePages(chId)
      if (pages.length > 0) handleOpenPage(pages[0].id)
    }
  }, [forceCloseTab])

  const handleReorderTabs = useCallback((newOrder: string[]) => { setOpenPageIds(newOrder) }, [])

  const handleBackToList = useCallback(() => {
    if (activePageIdRef.current) handleCloseTab(activePageIdRef.current)
    refreshAllPages(); refreshChapterPages(); refreshStarred()
  }, [handleCloseTab])

  const handleRefresh = () => { refreshAllPages(); refreshChapterPages(); refreshStarred(); refreshTags() }
  const handleSearchRefresh = useCallback(() => { refreshAllPages(); refreshTags() }, [refreshAllPages, refreshTags])

  const handleClearDirty = useCallback((pageId?: string) => {
    const pid = pageId || activePageIdRef.current
    if (!pid) return
    setDirtyPageIds(prev => {
      if (!prev.has(pid)) return prev
      const next = new Set(prev)
      next.delete(pid)
      return next
    })
  }, [])

  const handleMarkDirty = useCallback((pageId?: string) => {
    const pid = pageId || activePageIdRef.current
    if (!pid) return
    setDirtyPageIds(prev => {
      if (prev.has(pid)) return prev
      const next = new Set(prev)
      next.add(pid)
      return next
    })
  }, [])

  const handleTitleChange = useCallback((title: string) => {
    if (!activePageIdRef.current) return
    const pageId = activePageIdRef.current
    setAllPages(prev => prev.map(p => p.id === pageId ? { ...p, title } : p))
    setChapterPages(prev => prev.map(p => p.id === pageId ? { ...p, title } : p))
    setOpenPageInfos(prev => {
      const existing = prev[pageId]
      return { ...prev, [pageId]: { title, fileType: existing?.fileType || '' } }
    })
  }, [])

  const handleFileTypeChange = useCallback((fileType: string) => {
    if (!activePageIdRef.current) return
    const pageId = activePageIdRef.current
    setAllPages(prev => prev.map(p => p.id === pageId ? { ...p, fileType } : p))
    setChapterPages(prev => prev.map(p => p.id === pageId ? { ...p, fileType } : p))
    setStarredPages(prev => prev.map(p => p.id === pageId ? { ...p, fileType } : p))
    setOpenPageInfos(prev => {
      const existing = prev[pageId]
      return { ...prev, [pageId]: { ...existing, fileType } }
    })
  }, [])

  const handleToggleStar = async (pageId: string) => {
    await toggleKnowledgeStar(pageId)
    refreshAllPages(); refreshChapterPages(); refreshStarred()
  }

  // ---- 剪贴板操作 ----
  // 剪切项的 ID 集合（供子组件高亮半透明）
  const cutItemIds = useMemo(() => {
    if (!clipboard || clipboard.action !== 'cut') return new Set<string>()
    return new Set(clipboard.items.map(i => i.id))
  }, [clipboard])

  const handleCopy = useCallback((items: ClipItem[]) => {
    setClipboard({ action: 'copy', items })
    const label = items.length === 1 ? (items[0].type === 'category' ? '目录' : '页面') : `${items.length} 个项目`
    showToast({ type: 'info', message: `已复制 ${label}` })
  }, [])

  const handleCut = useCallback((items: ClipItem[]) => {
    setClipboard({ action: 'cut', items })
    const label = items.length === 1 ? (items[0].type === 'category' ? '目录' : '页面') : `${items.length} 个项目`
    showToast({ type: 'info', message: `已剪切 ${label}` })
  }, [])

  const handlePaste = useCallback(async (targetCategoryId: string | null) => {
    if (!clipboard || clipboard.items.length === 0) return
    const { action, items } = clipboard

    try {
      const notebookChapterCache = new Map<string, string | null>()
      for (const item of items) {
        let resolvedTargetCategoryId = targetCategoryId
        const targetCategory = targetCategoryId ? categories.find(c => c.id === targetCategoryId) : null

        if (item.type === 'page' && targetCategory) {
          if (targetCategory.categoryType === 'notebook') {
            let chapterId = notebookChapterCache.has(targetCategory.id)
              ? notebookChapterCache.get(targetCategory.id)
              : categories.find(c => c.parentId === targetCategory.id)?.id ?? null
            if (!chapterId) {
              const chapter = await createKnowledgeCategory({ name: '默认章节', parentId: targetCategory.id, categoryType: 'folder' })
              await refreshCategories()
              const freshCategories = await getKnowledgeCategories()
              chapterId = freshCategories.find(c => c.name === '默认章节' && c.parentId === targetCategory.id)?.id ?? chapter.id
            }
            notebookChapterCache.set(targetCategory.id, chapterId)
            resolvedTargetCategoryId = chapterId
          }
        } else if (item.type === 'category' && targetCategoryId === null) {
          const sourceCategory = categories.find(c => c.id === item.id)
          if (sourceCategory?.categoryType !== 'space') {
            throw new Error('普通分类不能移动到根层级')
          }
        }

        if (action === 'copy') {
          if (item.type === 'page') {
            await duplicateKnowledgePage({ pageId: item.id, targetCategoryId: resolvedTargetCategoryId })
          } else {
            await duplicateKnowledgeCategory({ categoryId: item.id, targetParentId: resolvedTargetCategoryId })
          }
        } else {
          // cut = move
          if (item.type === 'page') {
            await updateKnowledgePage(item.id, { categoryId: resolvedTargetCategoryId })
          } else {
            await updateKnowledgeCategory(item.id, { parentId: resolvedTargetCategoryId })
          }
        }
      }

      const label = items.length === 1 ? (items[0].type === 'category' ? '目录' : '页面') : `${items.length} 个项目`
      showToast({ type: 'info', message: `${action === 'copy' ? '已粘贴（副本）' : '已移动到新位置'} — ${label}` })

      if (action === 'cut') setClipboard(null)  // cut: 粘贴后清空
      // copy: 不清空，可以多次粘贴

      refreshCategories(); refreshAllPages(); refreshChapterPages()
    } catch (e) {
      console.error(e)
      showToast({ type: 'error', message: '粘贴失败' })
    }
  }, [clipboard, categories, refreshCategories])

  const handleExportPage = useCallback(async (pageId: string) => {
    try {
      const page = await getKnowledgePageById(pageId) ?? allPages.find(p => p.id === pageId)
      if (!page) { showToast({ type: 'error', message: '页面不存在' }); return }

      // Determine file extension from fileType
      const ext = page.fileType || 'md'
      const defaultName = `${page.title}.${ext === 'markdown' ? 'md' : ext}`

      const result = await showExportSaveDialog({
        defaultName,
        filters: [{ name: '所有文件', extensions: ['*'] }]
      })
      if (!result || !result.filePath) return

      await writeExportTextFile(result.filePath, page.contentMd || '', 'utf-8')
      showToast({ type: 'info', message: `已导出到 ${result.filePath}` })
    } catch (e) {
      console.error(e)
      showToast({ type: 'error', message: '导出失败' })
    }
  }, [allPages])

  // --- drag & drop move ---
  const handleDropOnNotebook = async (pageId: string, notebookId: string) => {
    const freshCats = await getKnowledgeCategories()
    const notebookChapters = freshCats.filter(c => c.parentId === notebookId)
    let targetChapterId: string | null = null
    if (notebookChapters.length > 0) {
      targetChapterId = notebookChapters[0].id
    } else {
      const ch = await createKnowledgeCategory({ name: '默认章节', parentId: notebookId, categoryType: 'folder' })
      await refreshCategories()
      targetChapterId = (await getKnowledgeCategories()).find(c => c.name === '默认章节' && c.parentId === notebookId)?.id || null
    }
    if (targetChapterId) {
      await updateKnowledgePage(pageId, { categoryId: targetChapterId })
      refreshAllPages(); refreshChapterPages()
    }
  }

  const handleDropOnLooseArea = async (pageId: string) => {
    await updateKnowledgePage(pageId, { categoryId: null })
    refreshAllPages(); refreshChapterPages()
  }

  const handleDropOnCategory = async (pageId: string, categoryId: string) => {
    await updateKnowledgePage(pageId, { categoryId })
    refreshAllPages(); refreshChapterPages()
  }

  const handleDropOnChapter = async (pageId: string, chapterId: string) => {
    await updateKnowledgePage(pageId, { categoryId: chapterId })
    refreshAllPages(); refreshChapterPages()
  }

  // --- category move (drag & drop) ---
  const handleMoveCategory = async (categoryId: string, newParentId: string | null) => {
    const catName = categories.find(c => c.id === categoryId)?.name ?? categoryId
    const targetName = newParentId ? categories.find(c => c.id === newParentId)?.name ?? newParentId : 'root'
    console.log(`[handleMoveCategory] moving "${catName}" (${categoryId}) → parent="${targetName}" (${newParentId})`)
    try {
      const result = await updateKnowledgeCategory(categoryId, { parentId: newParentId })
      console.log(`[handleMoveCategory] DB updated OK:`, result)
      refreshCategories()
    } catch (e) { console.error('handleMoveCategory failed:', e) }
  }

  // --- sort (up/down reorder) ---
  const handleSortCategory = async (id: string, direction: 'up' | 'down') => {
    await moveKnowledgeCategory(id, direction)
    refreshCategories()
  }
  const handleSortPage = async (id: string, direction: 'up' | 'down') => {
    await moveKnowledgePage(id, direction)
    refreshAllPages()
    refreshChapterPages()
  }

  // --- notebook / chapter selection ---
  const handleSelectSpace = (id: string) => {
    if (id === selectedSpaceId) {
      setSelectedSpaceId(null)
      setSelectedCategoryId(null)
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(false)
      return
    }
    setSelectedSpaceId(id)
    setSelectedCategoryId(null)
    setSelectedChapterId(null)
    setFocusChapterId(null)
    setShowChapterPanel(false)
  }

  const handleCollapseSpace = () => {
    setSelectedSpaceId(null)
    setSelectedCategoryId(null)
    setSelectedChapterId(null)
    setFocusChapterId(null)
    setShowChapterPanel(false)
  }

  const handleSelectCategory = (id: string | null) => {
    if (id === selectedCategoryId) {
      // Toggle: collapse
      setSelectedCategoryId(null)
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(false)
    } else {
      setSelectedCategoryId(id)
      setSelectedChapterId(null)
      setFocusChapterId(null)  // show all chapters when clicking notebook label
      // Only notebooks open the chapter panel; folders just expand/collapse in the tree
      const cat = categories.find(c => c.id === id)
      setShowChapterPanel(cat?.categoryType === 'notebook')
    }
  }

  // Select a chapter directly from the tree (under a notebook); toggle if same chapter
  const handleSelectCategoryChapter = (notebookId: string, chapterId: string) => {
    if (focusChapterId === chapterId) {
      setSelectedCategoryId(null)
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(false)
    } else {
      setSelectedCategoryId(notebookId)
      setSelectedChapterId(chapterId)
      setFocusChapterId(chapterId)
      setShowChapterPanel(true)
    }
  }

  // Keyboard shortcuts — module level
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getGlobalActiveTab() !== 'knowledge') return
      // 沉浸阅读：Ctrl+Shift+R 进出；Esc 退出（阅读态下无输入框，无需输入守卫）
      if (readingMode) {
        if (e.key === 'Escape') { e.preventDefault(); exitReading() }
        return
      }
      if (isEditingInput(e)) return

      if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        e.preventDefault()
        void enterReading()
        return
      }

      // Ctrl+N — create new loose page（通知列表组件打开内联命名输入框）
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('knowledge:start-create-page'))
        return
      }

      // Ctrl+W — close current tab
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        const activeId = activePageIdRef.current
        if (activeId) handleCloseTab(activeId)
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        const ids = openPageIdsRef.current
        if (ids.length === 0) return
        const activeId = activePageIdRef.current
        const idx = ids.indexOf(activeId ?? '')
        if (e.shiftKey) {
          const newIdx = idx <= 0 ? ids.length - 1 : idx - 1
          setActivePageId(ids[newIdx])
        } else {
          const newIdx = (idx === -1 || idx >= ids.length - 1) ? 0 : idx + 1
          setActivePageId(ids[newIdx])
        }
        return
      }

      // Ctrl+C — copy selected item to internal clipboard
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault()
        const activeId = activePageIdRef.current
        const catId = selectedCategoryIdRef.current
        if (activeId) {
          handleCopy([{ type: 'page', id: activeId }])
        } else if (catId) {
          handleCopy([{ type: 'category', id: catId }])
        }
        return
      }

      // Ctrl+X — cut selected item
      if (e.ctrlKey && e.key === 'x') {
        e.preventDefault()
        const activeId = activePageIdRef.current
        const catId = selectedCategoryIdRef.current
        if (activeId) {
          handleCut([{ type: 'page', id: activeId }])
        } else if (catId) {
          handleCut([{ type: 'category', id: catId }])
        }
        return
      }

      // Ctrl+V — paste internal clipboard
      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault()
        const target = selectedChapterIdRef.current ?? selectedCategoryIdRef.current
        handlePaste(target)
        return
      }

      // Delete — context-aware (page > chapter > notebook)
      if (e.key === 'Delete') {
        const activeId = activePageIdRef.current
        const chapterId = selectedChapterIdRef.current
        const notebookId = selectedCategoryIdRef.current
        if (activeId) {
          e.preventDefault()
          handlePageDeleted(activeId)
          return
        }
        if (chapterId) {
          e.preventDefault()
          handleDeleteChapter(chapterId)
          return
        }
        if (notebookId) {
          e.preventDefault()
          handleDeleteNotebook(notebookId)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleCloseTab, handleDeleteChapter, handleDeleteNotebook, handlePageDeleted, handleCopy, handleCut, handlePaste, readingMode, enterReading, exitReading])

  // --- outline ---
  const activePageForOutline = useMemo(() => {
    if (!activePageId) return null
    return [...allLoosePages, ...chapterPages, ...starredPages].find(p => p.id === activePageId) ?? null
  }, [activePageId, allLoosePages, chapterPages, starredPages])
  const outlineHeadings = useMemo(() => {
    const md = liveContent || activePageForOutline?.contentMd || ''
    return parseHeadings(md)
  }, [liveContent, activePageForOutline?.contentMd])

  // 搜索定位到分类/笔记本（展开树并滚动到目标）
  const handleLocateCategory = useCallback((categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) return

    // 若目标在某个空间内，先打开该空间的沉浸视图
    const findSpaceAncestor = (id: string | null): string | null => {
      let curId: string | null = id
      const seen = new Set<string>()
      while (curId) {
        if (seen.has(curId)) break; seen.add(curId)
        const cur = categories.find(c => c.id === curId)
        if (!cur) return null
        if (cur.categoryType === 'space') return cur.id
        curId = cur.parentId
      }
      return null
    }

    if (cat.categoryType === 'space') {
      // 直接定位空间本身 → 打开该空间
      setSelectedSpaceId(cat.id)
      setSelectedCategoryId(null)
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(false)
      setLocateCategoryId(null)
      requestAnimationFrame(() => setLocateCategoryId(categoryId))
      return
    }

    const spaceAncestorId = findSpaceAncestor(cat.parentId)
    if (spaceAncestorId) {
      setSelectedSpaceId(spaceAncestorId)
    }

    // 展开所有祖先
    const ancestors: string[] = []
    let currentId: string | null = cat.parentId
    const seen = new Set<string>()
    while (currentId) {
      if (seen.has(currentId)) break; seen.add(currentId)
      ancestors.push(currentId)
      const parent = categories.find(c => c.id === currentId)
      currentId = parent?.parentId ?? null
    }

    if (cat.categoryType === 'notebook') {
      setSelectedCategoryId(categoryId)
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(true)
    } else if (cat.parentId) {
      // Folder/chapter under a notebook
      const parent = categories.find(c => c.id === cat.parentId)
      if (parent?.categoryType === 'notebook') {
        setSelectedCategoryId(cat.parentId)
        setSelectedChapterId(categoryId)
        setFocusChapterId(null)
        setShowChapterPanel(true)
      } else {
        setSelectedCategoryId(categoryId)
        setSelectedChapterId(null)
        setFocusChapterId(null)
        setShowChapterPanel(false)
      }
    } else {
      setSelectedCategoryId(categoryId)
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(false)
    }

    // Trigger auto-expand + scroll in NotebookList
    setLocateCategoryId(null)
    requestAnimationFrame(() => setLocateCategoryId(categoryId))
  }, [categories])

  const handleLocateInExplorer = useCallback((pageId: string) => {
    const page = allPages.find(p => p.id === pageId)
    if (!page) return

    // Find the category chain: page.categoryId → parent → ... → notebook
    let catId = page.categoryId
    if (!catId) {
      // Loose page — just select null category and highlight
      setSelectedSpaceId(null)
      setSelectedCategoryId(null)
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(false)
      setLocatePageId(pageId)
      return
    }

    // Walk up to find the nearest notebook ancestor.
    let notebookId: string | null = null
    let spaceId: string | null = null
    const chain: string[] = [catId]
    let current = categories.find(c => c.id === catId)
    while (current?.parentId) {
      chain.push(current!.parentId)
      if (current?.categoryType === 'notebook') notebookId = current.id
      if (current?.categoryType === 'space') spaceId = current.id
      current = categories.find(c => c.id === current!.parentId)
    }
    if (current?.categoryType === 'notebook') notebookId = current.id
    if (current?.categoryType === 'space') spaceId = current.id

    // Open the containing space (if any) in immersive view
    if (spaceId) setSelectedSpaceId(spaceId)

    // Select the notebook when available; otherwise select the direct category.
    setSelectedCategoryId(notebookId ?? catId)
    // If under a notebook, select the chapter too
    if (notebookId) {
      setSelectedChapterId(notebookId === catId ? null : catId)
      setFocusChapterId(null)
      setShowChapterPanel(true)
    } else {
      setSelectedChapterId(null)
      setFocusChapterId(null)
      setShowChapterPanel(false)
    }

    // Trigger auto-expand + scroll in NotebookList
    setLocatePageId(null)
    requestAnimationFrame(() => setLocatePageId(pageId))
  }, [allPages, categories])

  const panelsVisible = sidebarOpen

  /** 已知页面标题集合：阅读模式区分空链接 */
  const knownWikiTitles = useMemo(() => new Set(allPages.map(p => p.title)), [allPages])

  return (
    <ImportZone onImport={handleDropImport} onImportPdf={handleDropImportBinary} className="h-full">
      <div className="flex h-full bg-[var(--bg-primary)]">
        {readingMode ? (
          /* ===== 沉浸阅读：只保留正文 ===== */
          <div className="flex-1 min-w-0 relative">
            {/* 顶部悬停退出区（平时隐形） */}
            <div
              className="absolute top-0 inset-x-0 h-9 z-40 group/rtop cursor-pointer"
              onClick={exitReading}
              title="退出沉浸阅读 (Esc)"
            >
              <div className="h-full opacity-0 group-hover/rtop:opacity-100 transition-opacity duration-200 flex items-center gap-2 px-4 bg-gradient-to-b from-black/45 to-transparent">
                <X size={15} className="text-white/90" />
                <span className="text-[12px] text-white/90">退出阅读</span>
                <span className="flex-1 text-center text-[12px] text-white/70 truncate px-10">{readingPage?.title}</span>
                <span className="w-16" />
              </div>
            </div>

            <div className="h-full overflow-y-auto">
              <div className="max-w-[720px] mx-auto px-10 py-14" style={{ fontSize: '15px', lineHeight: 1.9 }}>
                <h1 className="text-[26px] font-bold leading-snug mb-6">{readingPage?.title || '无标题'}</h1>
                {readingPage && (
                  <MarkdownPreview
                    content={readingPage.contentMd}
                    knownWikiTitles={knownWikiTitles}
                    onWikiLink={t => {
                      const hit = allPages.find(p => p.title === t)
                      if (hit) void openInReading(hit.id)
                      else showToast({ type: 'warning', message: `未找到「${t}」— 退出阅读后可点击虚线创建` })
                    }}
                  />
                )}
              </div>
            </div>
            <div className="absolute bottom-4 right-5 text-[10px] text-[var(--text-disabled)] select-none pointer-events-none">
              沉浸阅读 · Esc 退出
            </div>
          </div>
        ) : (
        <>
        {/* L1: File / Outline tabs — file tab drills into ChapterPanel when a notebook is selected */}
        <ResizablePanel storageKey="sidebarWidth_knowledgeCat" defaultWidth={240} minWidth={180} maxWidth={400} visible={panelsVisible && showCategoryPanel} initialWidth={sidebarWidths.sidebarWidth_knowledgeCat} onSnapClose={() => setShowCategoryPanel(false)} onSnapOpen={() => { setShowCategoryPanel(true); onSnapOpenSidebar?.() }}>
          <div className="flex flex-col h-full">
            {/* 空间沉浸视图顶部：返回栏（仅空间内显示） */}
            {selectedSpaceId && selectedSpace && (
              <SpacePanel space={selectedSpace} onCollapse={handleCollapseSpace} onRename={handleRenameNotebook} />
            )}

            {/* 文件/大纲切换 — 仅在空间内显示，位于返回栏下方 */}
            {selectedSpaceId && selectedSpace && (
              <div className="flex items-center gap-1 px-2 pt-1.5 pb-1 border-b border-[var(--border-color)] shrink-0">
                <button
                  onClick={() => setShowOutline(false)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[12px] transition-colors ${!showOutline ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
                >
                  <Folder size={13} />文件
                </button>
                <button
                  onClick={() => setShowOutline(true)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[12px] transition-colors ${showOutline ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
                >
                  <ListTree size={13} />大纲
                </button>
              </div>
            )}

            {/* 空间列表层：顶部居中「工作区」标题 */}
            {!selectedSpaceId && (
              <div className="flex items-center justify-center px-2 py-1.5 border-b border-[var(--border-color)] shrink-0">
                <span className="text-[12px] font-medium text-[var(--text-secondary)] text-center">工作区</span>
              </div>
            )}

            {/* 空间列表层：无大纲入口，直接显示文件树；空间内可切换大纲 */}
            {selectedSpaceId && showOutline ? (
              <div className="flex-1 min-h-0">
                <OutlinePanel
                  pageTitle={activePageForOutline?.title ?? ''}
                  headings={outlineHeadings}
                  onBackToFile={() => setShowOutline(false)}
                  embedded
                />
              </div>
            ) : (
              <>
                {/* File tab: tree stays mounted so its expand/collapse state survives drill-in navigation */}
                <div className={`flex flex-col flex-1 min-h-0 ${showChapterPanel && selectedCategory?.categoryType === 'notebook' ? 'hidden' : ''}`}>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <NotebookList
                      categories={categories}
                      allPages={allPages}
                      loosePages={allLoosePages}
                      starredPages={starredPages}
                      selectedCategoryId={selectedCategoryId}
                      focusChapterId={focusChapterId}
                      activePageId={activePageId}
                      spaceId={selectedSpaceId}
                      onSelectSpace={handleSelectSpace}
                      onSelectCategory={handleSelectCategory}
                      onSelectCategoryChapter={handleSelectCategoryChapter}
                      onCreateNotebook={handleCreateNotebook}
                      onRenameNotebook={handleRenameNotebook}
                      onDeleteNotebook={handleDeleteNotebook}
                      onOpenPage={handleOpenPage}
  onCreatePageNamed={handleCreatePageNamed}
                      onCreateChapterUnderNotebook={handleCreateChapterUnderNotebook}
                      onImport={handleDialogImport}
                      onImportFolder={handleImportFolder}
                      onDropOnNotebook={handleDropOnNotebook}
                      onDropOnCategory={handleDropOnCategory}
                      onDropOnLooseArea={handleDropOnLooseArea}
                      onMoveCategory={handleMoveCategory}
                      onSortCategory={handleSortCategory}
                      onSortPage={handleSortPage}
                      locatePageId={locatePageId}
                      locateCategoryId={locateCategoryId}
                      onCopy={handleCopy}
                      onCut={handleCut}
                      onPaste={handlePaste}
                      onExportPage={handleExportPage}
                      onDeletePage={handlePageDeleted}
                      onRenamePage={handleRenamePage}
                      clipboard={clipboard}
                      cutItemIds={cutItemIds}
                    />
                  </div>
                </div>
                {showChapterPanel && selectedCategory && selectedCategory.categoryType === 'notebook' && (
                  <div className="flex-1 min-h-0">
                    <ChapterPanel
                      notebookName={selectedCategory.name}
                      notebookId={selectedCategory.id}
                      chapters={chapters}
                      selectedChapterId={selectedChapterId}
                      focusChapterId={focusChapterId}
                      onSelectChapter={(id) => { setSelectedChapterId(id === selectedChapterId ? null : id); setFocusChapterId(null) }}
                      onCreateChapter={handleCreateChapter}
                      onRenameChapter={handleRenameChapter}
                      onDeleteChapter={handleDeleteChapter}
                      pages={chapterPages}
                      activePageId={activePageId}
                      onOpenPage={handleOpenPage}
                      onCreatePageNamed={handleCreatePageNamed}
                      onImport={handleDialogImport}
                      onDropOnChapter={handleDropOnChapter}
                      onCollapse={() => { setSelectedCategoryId(null); setSelectedChapterId(null); setFocusChapterId(null); setShowChapterPanel(false) }}
                      onToggleStar={handleToggleStar}
                      onSortChapter={handleSortCategory}
                      onLocateInExplorer={handleLocateInExplorer}
                      onSortPage={handleSortPage}
                      onRefreshPages={() => { refreshAllPages(); refreshChapterPages() }}
                      onMoveCategory={handleMoveCategory}
                      allCategories={categories}
                      onMovePageToLoose={handleDropOnLooseArea}
                      onMovePageToNotebook={handleDropOnNotebook}
                      onMovePageToCategory={handleDropOnCategory}
                      onCopy={handleCopy}
                      onCut={handleCut}
                      onExportPage={handleExportPage}
                      onDeletePage={handlePageDeleted}
                      onRenamePage={handleRenamePage}
                      clipboard={clipboard}
                      cutItemIds={cutItemIds}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </ResizablePanel>

        {/* 右侧链接提示（选中章节且无L2面板时显示） */}
        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <PageTabBar
            openPageIds={openPageIds}
            activePageId={activePageId}
            openPageInfos={openPageInfos}
            dirtyPageIds={dirtyPageIds}
            onSelectTab={handleOpenPage}
            onCloseTab={handleCloseTab}
            onReorder={handleReorderTabs}
            rightActions={<div id="editor-toolbar-slot" className="flex items-center gap-0.5" />}
          />
          {activePageId ? (
            <PageEditor
              pageId={activePageId}
              categories={categories}
              allPages={allPages}
              zoom={zoom}
              onBack={handleBackToList}
              onDeleted={() => handlePageDeleted(activePageId)}
              onNavigate={handleOpenPage}
              onUpdate={handleRefresh}
              onTitleChange={handleTitleChange}
              onFileTypeChange={handleFileTypeChange}
              onContentChange={setLiveContent}
              onTagsChange={handleSearchRefresh}
              onMarkDirty={handleMarkDirty}
              onClearDirty={handleClearDirty}
              onRequestReading={enterReading}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]">
              <FileText size={48} className="mb-4 opacity-25" />
              <p className="text-sm">选择或创建一个页面开始</p>
            </div>
          )}
        </div>
        </>
        )}
      </div>
      {isActive && (
        <QuickSearch
          pages={allPages}
          categories={categories}
          tags={allKnowledgeTags}
          onOpenPage={handleOpenPage}
          onLocateCategory={handleLocateCategory}
          onRequestRefresh={handleSearchRefresh}
        />
      )}

      {/* Unsaved changes confirm dialog */}
      <ConfirmDialog
        open={unsavedClosePageId !== null}
        title="未保存的更改"
        message="当前页面有未保存的更改，确定要关闭吗？"
        confirmLabel="关闭"
        onConfirm={() => {
          const id = unsavedClosePageId
          setUnsavedClosePageId(null)
          if (id) { setDirtyPageIds(prev => { const n = new Set(prev); n.delete(id); return n }); forceCloseTab(id) }
        }}
        onCancel={() => setUnsavedClosePageId(null)}
      />
    </ImportZone>
  )
}
