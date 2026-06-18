import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FileText } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../types'
import {
  getKnowledgeCategories, createKnowledgeCategory, updateKnowledgeCategory, deleteKnowledgeCategory,
  getKnowledgePages, createKnowledgePage, deleteKnowledgePage,
  searchKnowledgePages, getKnowledgeBacklinks, getKnowledgeStarredPages, moveKnowledgePage,
  updateKnowledgePage, toggleKnowledgeStar,
  showImportOpenDialog, readImportFiles, importPdf, importPdfFile
} from '../../lib/ipc'
import { NotebookList } from './components/NotebookList'
import { ChapterPanel } from './components/ChapterPanel'
import { PageEditor } from './components/PageEditor'
import { PageTabBar, type PageInfo } from './components/PageTabBar'
import { ImportZone } from '../shared/components/ImportZone'
import { ResizablePanel } from '../../components/shared/ResizablePanel'
import { isEditingInput } from '../../lib/shortcuts'

export function KnowledgeModule({ sidebarOpen = true, zoom = 1, sidebarWidths = {} as Record<string, number> }: { sidebarOpen?: boolean; zoom?: number; sidebarWidths?: Record<string, number> }) {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [allPages, setAllPages] = useState<KnowledgePage[]>([])
  const [chapterPages, setChapterPages] = useState<KnowledgePage[]>([])
  const [starredPages, setStarredPages] = useState<KnowledgePage[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [focusChapterId, setFocusChapterId] = useState<string | null>(null)  // when set, ChapterPanel shows only this chapter
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [openPageIds, setOpenPageIds] = useState<string[]>([])
  const [openPageInfos, setOpenPageInfos] = useState<Record<string, PageInfo>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const [showCategoryPanel, setShowCategoryPanel] = useState(true)
  const [showChapterPanel, setShowChapterPanel] = useState(true)

  const openPageIdsRef = useRef(openPageIds)
  const activePageIdRef = useRef(activePageId)
  const selectedCategoryIdRef = useRef(selectedCategoryId)
  const selectedChapterIdRef = useRef(selectedChapterId)
  useEffect(() => { openPageIdsRef.current = openPageIds }, [openPageIds])
  useEffect(() => { activePageIdRef.current = activePageId }, [activePageId])
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
  const notebooks = categories.filter(c => !c.parentId)
  const chapters = categories.filter(c => c.parentId === selectedCategoryId)
  const selectedCategory = selectedCategoryId ? categories.find(c => c.id === selectedCategoryId) : null
  const allLoosePages = useMemo(() => allPages.filter(p => p.categoryId === null), [allPages])

  // --- data loading ---
  const refreshCategories = useCallback(async () => {
    try { setCategories(await getKnowledgeCategories()) } catch (e) { console.error(e) }
  }, [])

  const refreshAllPages = useCallback(async () => {
    try {
      const result = await getKnowledgePages()
      for (const p of result) { p.backlinks = await getKnowledgeBacklinks(p.id) }
      setAllPages(result)
    } catch (e) { console.error(e) }
  }, [])

  const refreshChapterPages = useCallback(async () => {
    if (!selectedChapterId) { setChapterPages([]); return }
    try {
      const result = await getKnowledgePages(selectedChapterId)
      for (const p of result) { p.backlinks = await getKnowledgeBacklinks(p.id) }
      setChapterPages(result)
    } catch (e) { console.error(e) }
  }, [selectedChapterId])

  const refreshStarred = useCallback(async () => {
    try { setStarredPages(await getKnowledgeStarredPages()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([refreshCategories(), refreshAllPages(), refreshStarred()])
      .finally(() => setLoading(false))
  }, [])

  // 监听数据导入事件 — 导入完成后刷新所有数据
  useEffect(() => {
    const handler = () => { refreshCategories(); refreshAllPages(); refreshAllPages(); refreshStarred() }
    window.addEventListener('data-imported', handler)
    return () => window.removeEventListener('data-imported', handler)
  }, [refreshCategories, refreshAllPages, refreshStarred])

  useEffect(() => { refreshChapterPages() }, [refreshChapterPages])

  // --- notebook CRUD ---
  const handleCreateNotebook = async (name: string, categoryType: 'folder' | 'notebook', parentId: string | null) => {
    await createKnowledgeCategory({ name, parentId, categoryType })
    refreshCategories()
  }
  const handleRenameNotebook = async (id: string, name: string) => {
    await updateKnowledgeCategory(id, { name })
    refreshCategories()
  }
  const handleDeleteNotebook = async (id: string) => {
    await deleteKnowledgeCategory(id)
    if (selectedCategoryId === id) { setSelectedCategoryId(null); setSelectedChapterId(null) }
    refreshCategories(); refreshAllPages()
  }

  // --- chapter CRUD ---
  const handleCreateChapter = async (name: string) => {
    if (!selectedCategoryId) return
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
  const handleCreateLoosePage = async () => {
    try {
      const p = await createKnowledgePage({ categoryId: null })
      handleOpenPage(p.id); refreshAllPages()
    } catch (e) { console.error(e) }
  }

  const handleCreateChapterUnderNotebook = async (notebookId: string) => {
    await createKnowledgeCategory({ name: '新章节', parentId: notebookId, categoryType: 'folder' })
    refreshCategories()
    // Auto-select notebook so user sees the new chapter in sidebar
    setSelectedCategoryId(notebookId)
    setSelectedChapterId(null)
    setFocusChapterId(null)
    setShowChapterPanel(true)
  }

  const handleCreatePageUnderCategory = async (categoryId: string) => {
    try {
      const p = await createKnowledgePage({ categoryId })
      handleOpenPage(p.id)
      refreshAllPages()
      if (selectedChapterId === categoryId) refreshChapterPages()
      else refreshAllPages()
    } catch (e) { console.error(e) }
  }

  const handleCreateChapterPage = async () => {
    if (!selectedChapterId) return
    try {
      const p = await createKnowledgePage({ categoryId: selectedChapterId })
      handleOpenPage(p.id); refreshChapterPages()
    } catch (e) { console.error(e) }
  }

  const handleDialogImport = async () => {
    try {
      const paths: string[] = await showImportOpenDialog()
      if (!paths || paths.length === 0) return

      // Separate PDF files from text files
      const pdfPaths = paths.filter(p => p.toLowerCase().endsWith('.pdf'))
      const textPaths = paths.filter(p => !p.toLowerCase().endsWith('.pdf'))

      // Import text files
      if (textPaths.length > 0) {
        const results = await readImportFiles(textPaths)
        for (const r of results) {
          if (r.error) continue
          const catId = selectedChapterId || null
          await createKnowledgePage({ title: r.baseName || '导入页面', contentMd: r.content, categoryId: catId, fileType: r.fileType || '' })
        }
      }

      // Import PDF files
      for (const pdfPath of pdfPaths) {
        const result = await importPdfFile(pdfPath)
        if (result.error) {
          console.error('PDF import failed:', result.error)
        }
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

  const handleDropImportPdf = async (files: Array<{ title: string; base64: string; fileName: string }>) => {
    try {
      for (const f of files) {
        await importPdf(f.base64, f.fileName)
      }
      refreshAllPages()
    } catch (e) { console.error(e) }
  }

  // --- tab management ---
  const handleOpenPage = useCallback((pageId: string) => {
    const existing = [...allLoosePages, ...chapterPages, ...starredPages].find(p => p.id === pageId)
    if (existing) {
      setOpenPageInfos(prev => ({ ...prev, [pageId]: { title: existing.title, fileType: existing.fileType || '' } }))
    }
    setOpenPageIds(prev => prev.includes(pageId) ? prev : [...prev, pageId])
    setActivePageId(pageId)
  }, [allLoosePages, chapterPages, starredPages])

  const handleCloseTab = useCallback((pageId: string) => {
    const currentIds = openPageIdsRef.current
    const idx = currentIds.indexOf(pageId)
    if (idx === -1) return
    const nextIds = currentIds.filter(id => id !== pageId)
    setOpenPageIds(nextIds)
    setOpenPageInfos(prev => { const next = { ...prev }; delete next[pageId]; return next })
    if (activePageIdRef.current === pageId) {
      if (nextIds.length === 0) setActivePageId(null)
      else { const newIdx = Math.min(idx, nextIds.length - 1); setActivePageId(nextIds[newIdx]) }
    }
  }, [])

  const handlePageDeleted = useCallback(async (id: string) => {
    await deleteKnowledgePage(id)
    handleCloseTab(id)
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
  }, [handleCloseTab])

  const handleReorderTabs = useCallback((newOrder: string[]) => { setOpenPageIds(newOrder) }, [])

  const handleBackToList = useCallback(() => {
    if (activePageIdRef.current) handleCloseTab(activePageIdRef.current)
    refreshAllPages(); refreshChapterPages(); refreshStarred()
  }, [handleCloseTab])

  const handleRefresh = () => { refreshAllPages(); refreshChapterPages(); refreshStarred() }

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

  // --- drag & drop move ---
  const handleDropOnNotebook = async (pageId: string, notebookId: string) => {
    // Find the first chapter in the notebook, create a default one if none
    const notebookChapters = categories.filter(c => c.parentId === notebookId)
    let targetChapterId: string | null = null
    if (notebookChapters.length > 0) {
      targetChapterId = notebookChapters[0].id
    } else {
      // Auto-create a default chapter
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
    // Same as notebook: find/create a child chapter to hold the page
    const childCats = categories.filter(c => c.parentId === categoryId)
    let targetChapterId: string | null = null
    if (childCats.length > 0) {
      targetChapterId = childCats[0].id
    } else {
      await createKnowledgeCategory({ name: '默认章节', parentId: categoryId, categoryType: 'folder' })
      await refreshCategories()
      targetChapterId = (await getKnowledgeCategories()).find(c => c.name === '默认章节' && c.parentId === categoryId)?.id || null
    }
    if (targetChapterId) {
      await updateKnowledgePage(pageId, { categoryId: targetChapterId })
    }
    refreshAllPages(); refreshChapterPages()
  }

  const handleDropOnChapter = async (pageId: string, chapterId: string) => {
    await updateKnowledgePage(pageId, { categoryId: chapterId })
    refreshAllPages(); refreshChapterPages()
  }

  // --- category move (drag & drop) ---
  const handleMoveCategory = async (categoryId: string, newParentId: string | null) => {
    await updateKnowledgeCategory(categoryId, { parentId: newParentId })
    refreshCategories()
  }

  // --- notebook / chapter selection ---
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
      if (isEditingInput(e)) return

      // Ctrl+N — create new loose page
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        handleCreateLoosePage()
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
  }, [handleCreateLoosePage, handleCloseTab, handleDeleteChapter, handleDeleteNotebook, handlePageDeleted])

  const panelsVisible = sidebarOpen

  return (
    <ImportZone onImport={handleDropImport} onImportPdf={handleDropImportPdf} className="h-full">
      <div className="flex h-full bg-[var(--bg-primary)]">
        {/* L1: NotebookList */}
        <ResizablePanel storageKey="sidebarWidth_knowledgeCat" defaultWidth={240} minWidth={180} maxWidth={400} visible={panelsVisible && showCategoryPanel} initialWidth={sidebarWidths.sidebarWidth_knowledgeCat}>
          <NotebookList
            categories={categories}
            allPages={allPages}
            loosePages={allLoosePages}
            starredPages={starredPages}
            selectedCategoryId={selectedCategoryId}
            focusChapterId={focusChapterId}
            activePageId={activePageId}
            onSelectCategory={handleSelectCategory}
            onSelectCategoryChapter={handleSelectCategoryChapter}
            onCreateNotebook={handleCreateNotebook}
            onRenameNotebook={handleRenameNotebook}
            onDeleteNotebook={handleDeleteNotebook}
            onOpenPage={handleOpenPage}
            onCreateLoosePage={handleCreateLoosePage}
            onCreatePageUnder={handleCreatePageUnderCategory}
            onCreateChapterUnderNotebook={handleCreateChapterUnderNotebook}
            onImport={handleDialogImport}
            onDropOnNotebook={handleDropOnNotebook}
            onDropOnCategory={handleDropOnCategory}
            onDropOnLooseArea={handleDropOnLooseArea}
            onMoveCategory={handleMoveCategory}
          />
        </ResizablePanel>

        {/* L2: ChapterPanel — always mounted for slide animation */}
        <ResizablePanel storageKey="sidebarWidth_knowledgeChapters" defaultWidth={240} minWidth={180} maxWidth={400} visible={panelsVisible && showChapterPanel && !!selectedCategoryId} initialWidth={sidebarWidths.sidebarWidth_knowledgeChapters}>
          {selectedCategory && (
            <ChapterPanel
              notebookName={selectedCategory.name}
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
              onCreatePage={handleCreateChapterPage}
              onImport={handleDialogImport}
              onDropOnChapter={handleDropOnChapter}
              onCollapse={() => { setSelectedCategoryId(null); setSelectedChapterId(null); setFocusChapterId(null); setShowChapterPanel(false) }}
              onToggleStar={handleToggleStar}
            />
          )}
        </ResizablePanel>

        {/* 右侧链接提示（选中章节且无L2面板时显示） */}
        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <PageTabBar
            openPageIds={openPageIds}
            activePageId={activePageId}
            openPageInfos={openPageInfos}
            onSelectTab={handleOpenPage}
            onCloseTab={handleCloseTab}
            onReorder={handleReorderTabs}
          />
          {activePageId ? (
            <PageEditor
              pageId={activePageId}
              categories={categories}
              allPages={[...allLoosePages, ...chapterPages]}
              zoom={zoom}
              onBack={handleBackToList}
              onDeleted={() => handlePageDeleted(activePageId)}
              onNavigate={handleOpenPage}
              onUpdate={handleRefresh}
              onTitleChange={handleTitleChange}
              onFileTypeChange={handleFileTypeChange}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]">
              <FileText size={48} className="mb-4 opacity-25" />
              <p className="text-sm">选择或创建一个页面开始</p>
              <p className="text-xs mt-2 text-[var(--text-disabled)]">笔记本是一本「书」，章节是它的「目录」，页面是「内容」</p>
              <p className="text-xs mt-1 text-[var(--text-disabled)]">零散文件是不属于任何笔记本的独立页面</p>
            </div>
          )}
        </div>
      </div>
    </ImportZone>
  )
}
