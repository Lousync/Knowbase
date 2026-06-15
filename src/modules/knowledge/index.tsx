import { useState, useEffect, useCallback, useRef } from 'react'
import { FileText } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../types'
import {
  getKnowledgeCategories, createKnowledgeCategory, updateKnowledgeCategory, deleteKnowledgeCategory,
  getKnowledgePages, createKnowledgePage, deleteKnowledgePage,
  searchKnowledgePages, getKnowledgeBacklinks, getKnowledgeStarredPages, moveKnowledgePage,
  updateKnowledgePage, toggleKnowledgeStar,
  showImportOpenDialog, readImportFiles
} from '../../lib/ipc'
import { NotebookList } from './components/NotebookList'
import { ChapterPanel } from './components/ChapterPanel'
import { PageEditor } from './components/PageEditor'
import { PageTabBar } from './components/PageTabBar'
import { RecycleBinPanel } from '../shared/components/RecycleBinPanel'
import { ImportZone } from '../shared/components/ImportZone'
import { ResizablePanel } from '../../components/shared/ResizablePanel'

export function KnowledgeModule({ sidebarOpen = true, zoom = 1, sidebarWidths = {} as Record<string, number> }: { sidebarOpen?: boolean; zoom?: number; sidebarWidths?: Record<string, number> }) {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [loosePages, setLoosePages] = useState<KnowledgePage[]>([])
  const [chapterPages, setChapterPages] = useState<KnowledgePage[]>([])
  const [starredPages, setStarredPages] = useState<KnowledgePage[]>([])
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [openPageIds, setOpenPageIds] = useState<string[]>([])
  const [openPageTitles, setOpenPageTitles] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const [showCategoryPanel, setShowCategoryPanel] = useState(true)
  const [showChapterPanel, setShowChapterPanel] = useState(true)
  const [showRecycleBin, setShowRecycleBin] = useState(false)

  const openPageIdsRef = useRef(openPageIds)
  const activePageIdRef = useRef(activePageId)
  useEffect(() => { openPageIdsRef.current = openPageIds }, [openPageIds])
  useEffect(() => { activePageIdRef.current = activePageId }, [activePageId])

  useEffect(() => {
    if (sidebarOpen) { setShowCategoryPanel(true); setShowChapterPanel(!!selectedNotebookId) }
  }, [sidebarOpen])

  // --- derived ---
  const notebooks = categories.filter(c => !c.parentId)
  const chapters = categories.filter(c => c.parentId === selectedNotebookId)
  const selectedNotebook = selectedNotebookId ? categories.find(c => c.id === selectedNotebookId) : null
  const allLoosePages = loosePages  // always all loose pages

  // --- data loading ---
  const refreshCategories = useCallback(async () => {
    try { setCategories(await getKnowledgeCategories()) } catch (e) { console.error(e) }
  }, [])

  const refreshLoosePages = useCallback(async () => {
    try {
      const result = await getKnowledgePages(null)
      for (const p of result) { p.backlinks = await getKnowledgeBacklinks(p.id) }
      setLoosePages(result)
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
    Promise.all([refreshCategories(), refreshLoosePages(), refreshStarred()])
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refreshChapterPages() }, [refreshChapterPages])

  // --- notebook CRUD ---
  const handleCreateNotebook = async (name: string) => {
    await createKnowledgeCategory({ name, parentId: null })
    refreshCategories()
  }
  const handleRenameNotebook = async (id: string, name: string) => {
    await updateKnowledgeCategory(id, { name })
    refreshCategories()
  }
  const handleDeleteNotebook = async (id: string) => {
    await deleteKnowledgeCategory(id)
    if (selectedNotebookId === id) { setSelectedNotebookId(null); setSelectedChapterId(null) }
    refreshCategories(); refreshLoosePages()
  }

  // --- chapter CRUD ---
  const handleCreateChapter = async (name: string) => {
    if (!selectedNotebookId) return
    await createKnowledgeCategory({ name, parentId: selectedNotebookId })
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
      handleOpenPage(p.id); refreshLoosePages()
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
      const results = await readImportFiles(paths)
      for (const r of results) {
        if (r.error) continue
        const h1 = r.content.match(/^#\s+(.+)/m)
        const title = h1 ? h1[1].trim() : (r.baseName || '导入页面')
        // Import to current context: chapter or loose
        const catId = selectedChapterId || null
        await createKnowledgePage({ title, contentMd: r.content, categoryId: catId })
      }
      if (selectedChapterId) refreshChapterPages()
      else refreshLoosePages()
    } catch (e) { console.error(e) }
  }

  const handleDropImport = async (files: Array<{ title: string; content: string }>) => {
    try {
      const catId = selectedChapterId || null
      for (const f of files) {
        await createKnowledgePage({ title: f.title, contentMd: f.content, categoryId: catId })
      }
      if (selectedChapterId) refreshChapterPages()
      else refreshLoosePages()
    } catch (e) { console.error(e) }
  }

  // --- tab management ---
  const handleOpenPage = useCallback((pageId: string) => {
    const existing = [...loosePages, ...chapterPages, ...starredPages].find(p => p.id === pageId)
    if (existing) {
      setOpenPageTitles(prev => ({ ...prev, [pageId]: existing.title }))
    }
    setOpenPageIds(prev => prev.includes(pageId) ? prev : [...prev, pageId])
    setActivePageId(pageId)
  }, [loosePages, chapterPages, starredPages])

  const handleCloseTab = useCallback((pageId: string) => {
    const currentIds = openPageIdsRef.current
    const idx = currentIds.indexOf(pageId)
    if (idx === -1) return
    const nextIds = currentIds.filter(id => id !== pageId)
    setOpenPageIds(nextIds)
    setOpenPageTitles(prev => { const next = { ...prev }; delete next[pageId]; return next })
    if (activePageIdRef.current === pageId) {
      if (nextIds.length === 0) setActivePageId(null)
      else { const newIdx = Math.min(idx, nextIds.length - 1); setActivePageId(nextIds[newIdx]) }
    }
  }, [])

  const handlePageDeleted = useCallback(async (id: string) => {
    await deleteKnowledgePage(id)
    handleCloseTab(id)
    refreshLoosePages(); refreshChapterPages(); refreshStarred()
  }, [handleCloseTab])

  const handleReorderTabs = useCallback((newOrder: string[]) => { setOpenPageIds(newOrder) }, [])

  const handleBackToList = useCallback(() => {
    if (activePageIdRef.current) handleCloseTab(activePageIdRef.current)
    refreshLoosePages(); refreshChapterPages(); refreshStarred()
  }, [handleCloseTab])

  const handleRefresh = () => { refreshLoosePages(); refreshChapterPages(); refreshStarred() }

  const handleTitleChange = useCallback((title: string) => {
    if (!activePageIdRef.current) return
    const pageId = activePageIdRef.current
    setLoosePages(prev => prev.map(p => p.id === pageId ? { ...p, title } : p))
    setChapterPages(prev => prev.map(p => p.id === pageId ? { ...p, title } : p))
    setOpenPageTitles(prev => ({ ...prev, [pageId]: title }))
  }, [])

  const handleToggleStar = async (pageId: string) => {
    await toggleKnowledgeStar(pageId)
    refreshLoosePages(); refreshChapterPages(); refreshStarred()
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
      const ch = await createKnowledgeCategory({ name: '默认章节', parentId: notebookId })
      await refreshCategories()
      targetChapterId = (await getKnowledgeCategories()).find(c => c.name === '默认章节' && c.parentId === notebookId)?.id || null
    }
    if (targetChapterId) {
      await updateKnowledgePage(pageId, { categoryId: targetChapterId })
      refreshLoosePages(); refreshChapterPages()
    }
  }

  const handleDropOnLooseArea = async (pageId: string) => {
    await updateKnowledgePage(pageId, { categoryId: null })
    refreshLoosePages(); refreshChapterPages()
  }

  const handleDropOnChapter = async (pageId: string, chapterId: string) => {
    await updateKnowledgePage(pageId, { categoryId: chapterId })
    refreshLoosePages(); refreshChapterPages()
  }

  // --- notebook / chapter selection ---
  const handleSelectNotebook = (id: string | null) => {
    if (id === selectedNotebookId) {
      // Toggle: collapse
      setSelectedNotebookId(null)
      setSelectedChapterId(null)
      setShowChapterPanel(false)
    } else {
      setSelectedNotebookId(id)
      setSelectedChapterId(null)
      setShowChapterPanel(true)
    }
  }

  const panelsVisible = sidebarOpen

  return (
    <ImportZone onImport={handleDropImport} className="h-full">
      <div className="flex h-full bg-[var(--bg-primary)]">
        {/* L1: NotebookList */}
        <ResizablePanel storageKey="sidebarWidth_knowledgeCat" defaultWidth={240} minWidth={180} maxWidth={400} visible={panelsVisible && showCategoryPanel} initialWidth={sidebarWidths.sidebarWidth_knowledgeCat}>
          <NotebookList
            categories={categories}
            loosePages={allLoosePages}
            starredPages={starredPages}
            selectedNotebookId={selectedNotebookId}
            activePageId={activePageId}
            onSelectNotebook={handleSelectNotebook}
            onCreateNotebook={handleCreateNotebook}
            onRenameNotebook={handleRenameNotebook}
            onDeleteNotebook={handleDeleteNotebook}
            onOpenPage={handleOpenPage}
            onCreateLoosePage={handleCreateLoosePage}
            onImport={handleDialogImport}
            onOpenRecycleBin={() => setShowRecycleBin(true)}
            onDropOnNotebook={handleDropOnNotebook}
            onDropOnLooseArea={handleDropOnLooseArea}
          />
        </ResizablePanel>

        {/* L2: ChapterPanel (conditional) */}
        {selectedNotebookId && selectedNotebook && (
          <ResizablePanel storageKey="sidebarWidth_knowledgeChapters" defaultWidth={240} minWidth={180} maxWidth={400} visible={panelsVisible && showChapterPanel} initialWidth={sidebarWidths.sidebarWidth_knowledgeChapters}>
            <ChapterPanel
              notebookName={selectedNotebook.name}
              chapters={chapters}
              selectedChapterId={selectedChapterId}
              onSelectChapter={(id) => {
                setSelectedChapterId(id === selectedChapterId ? null : id)
                if (id !== selectedChapterId) setSelectedChapterId(id)
              }}
              onCreateChapter={handleCreateChapter}
              onRenameChapter={handleRenameChapter}
              onDeleteChapter={handleDeleteChapter}
              pages={chapterPages}
              activePageId={activePageId}
              onOpenPage={handleOpenPage}
              onCreatePage={handleCreateChapterPage}
              onImport={handleDialogImport}
              onDropOnChapter={handleDropOnChapter}
              onCollapse={() => { setSelectedNotebookId(null); setSelectedChapterId(null); setShowChapterPanel(false) }}
              onToggleStar={handleToggleStar}
            />
          </ResizablePanel>
        )}

        {/* 右侧链接提示（选中章节且无L2面板时显示） */}
        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <PageTabBar
            openPageIds={openPageIds}
            activePageId={activePageId}
            openPageTitles={openPageTitles}
            onSelectTab={handleOpenPage}
            onCloseTab={handleCloseTab}
            onReorder={handleReorderTabs}
          />
          {activePageId ? (
            <PageEditor
              pageId={activePageId}
              categories={categories}
              allPages={[...loosePages, ...chapterPages]}
              zoom={zoom}
              onBack={handleBackToList}
              onDeleted={() => handlePageDeleted(activePageId)}
              onNavigate={handleOpenPage}
              onUpdate={handleRefresh}
              onTitleChange={handleTitleChange}
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

        {showRecycleBin && (
          <RecycleBinPanel
            module="knowledge"
            onClose={() => setShowRecycleBin(false)}
            onRestored={() => { refreshLoosePages(); refreshChapterPages(); refreshStarred() }}
          />
        )}
      </div>
    </ImportZone>
  )
}
