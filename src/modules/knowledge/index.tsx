import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Search, X, Star, ChevronUp, ChevronDown, AlertCircle, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Trash2, Download } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../types'
import {
  getKnowledgeCategories, createKnowledgeCategory, updateKnowledgeCategory, deleteKnowledgeCategory,
  getKnowledgePages, createKnowledgePage, deleteKnowledgePage,
  searchKnowledgePages, getKnowledgeBacklinks, getKnowledgeStarredPages, moveKnowledgePage,
  showImportOpenDialog, readImportFiles
} from '../../lib/ipc'
import { CategoryTree } from './components/CategoryTree'
import { PageEditor } from './components/PageEditor'
import { RecycleBinPanel } from '../shared/components/RecycleBinPanel'
import { ImportZone } from '../shared/components/ImportZone'
import { ResizablePanel } from '../../components/shared/ResizablePanel'

export function KnowledgeModule({ sidebarOpen = true, zoom = 1, sidebarWidths = {} as Record<string, number> }: { sidebarOpen?: boolean; zoom?: number; sidebarWidths?: Record<string, number> }) {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [pages, setPages] = useState<KnowledgePage[]>([])
  const [starredPages, setStarredPages] = useState<KnowledgePage[]>([])
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  // 面板折叠状态（仅当全局 sidebarOpen 为 true 时有意义）
  const [showCategoryPanel, setShowCategoryPanel] = useState(true)
  const [showPageListPanel, setShowPageListPanel] = useState(true)
  const [showRecycleBin, setShowRecycleBin] = useState(false)

  // 全局侧栏重新展开时，重置面板折叠状态
  useEffect(() => {
    if (sidebarOpen) {
      setShowCategoryPanel(true)
      setShowPageListPanel(true)
    }
  }, [sidebarOpen])

  const refreshCategories = useCallback(async () => {
    try { setCategories(await getKnowledgeCategories()) } catch (e) { console.error(e) }
  }, [])

  const refreshPages = useCallback(async () => {
    try {
      let result: KnowledgePage[]
      if (searchQuery) {
        result = await searchKnowledgePages(searchQuery)
      } else {
        result = await getKnowledgePages(selectedCatId)
      }
      for (const p of result) {
        p.backlinks = await getKnowledgeBacklinks(p.id)
      }
      setPages(result)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [selectedCatId, searchQuery])

  const refreshStarred = useCallback(async () => {
    try { setStarredPages(await getKnowledgeStarredPages()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    Promise.all([refreshCategories(), refreshPages(), refreshStarred()])
  }, [])

  useEffect(() => { refreshPages() }, [refreshPages])

  const handleCreateCategory = async (name: string, parentId: string | null) => {
    await createKnowledgeCategory({ name, parentId })
    refreshCategories()
  }
  const handleRenameCategory = async (id: string, name: string) => {
    await updateKnowledgeCategory(id, { name })
    refreshCategories()
  }
  const handleDeleteCategory = async (id: string) => {
    await deleteKnowledgeCategory(id)
    if (selectedCatId === id) setSelectedCatId(null)
    refreshCategories(); refreshPages()
  }

  const handleCreatePage = async () => {
    try {
      const p = await createKnowledgePage({ categoryId: selectedCatId })
      setSelectedPageId(p.id)
      refreshPages()
    } catch (e) { console.error(e) }
  }

  // 对话框导入文件
  const handleDialogImport = async () => {
    try {
      const paths: string[] = await showImportOpenDialog()
      if (!paths || paths.length === 0) return
      const results = await readImportFiles(paths)
      for (const r of results) {
        if (r.error) continue
        const h1 = r.content.match(/^#\s+(.+)/m)
        const title = h1 ? h1[1].trim() : (r.baseName || '导入页面')
        await createKnowledgePage({ title, contentMd: r.content, categoryId: selectedCatId })
      }
      refreshPages()
    } catch (e) { console.error(e) }
  }

  // 拖拽导入文件
  const handleDropImport = async (files: Array<{ title: string; content: string }>) => {
    try {
      for (const f of files) {
        await createKnowledgePage({ title: f.title, contentMd: f.content, categoryId: selectedCatId })
      }
      refreshPages()
    } catch (e) { console.error(e) }
  }

  const handleSelectPage = (id: string) => setSelectedPageId(id)

  const handleDeletePage = async (id: string) => {
    await deleteKnowledgePage(id)
    setSelectedPageId(null)
    refreshPages(); refreshStarred()
  }

  const handleMovePage = async (id: string, direction: 'up' | 'down') => {
    await moveKnowledgePage(id, direction)
    refreshPages()
  }

  const handleBackToList = () => {
    setSelectedPageId(null)
    refreshPages(); refreshStarred()
  }

  const handleRefresh = () => {
    refreshPages(); refreshStarred()
  }

  // 实时更新侧边栏页面列表中的标题（无需等待保存）
  const handleTitleChange = useCallback((title: string) => {
    setPages(prev => prev.map(p => p.id === selectedPageId ? { ...p, title } : p))
  }, [selectedPageId])

  const getCategoryPath = (catId: string | null): string => {
    if (!catId) return '全部页面'
    const parts: string[] = []
    let current = categories.find(c => c.id === catId)
    while (current) { parts.unshift(current.name); current = categories.find(c => c.id === current!.parentId) }
    return parts.join(' > ')
  }

  const selectedCat = selectedCatId ? categories.find(c => c.id === selectedCatId) : null
  const hasSubCategories = selectedCatId ? categories.some(c => c.parentId === selectedCatId) : false
  const showStarred = selectedCatId === null && !searchQuery && starredPages.length > 0

  // 全局 ActivityBar 折叠 → 隐藏所有侧栏
  const panelsVisible = sidebarOpen

  return (
    <ImportZone onImport={handleDropImport} className="h-full">
      <div className="flex h-full bg-[var(--bg-primary)]">
        {/* Left: Category Tree */}
        <ResizablePanel storageKey="sidebarWidth_knowledgeCat" defaultWidth={256} minWidth={180} maxWidth={450} visible={panelsVisible && showCategoryPanel} initialWidth={sidebarWidths.sidebarWidth_knowledgeCat}>
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-color)]">
              <button
                onClick={() => setShowCategoryPanel(false)}
                className="p-1 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title="折叠分类面板"
              >
                <PanelLeftClose size={24} />
              </button>
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide whitespace-nowrap">知识主题</span>
              <button
                onClick={() => setShowPageListPanel(v => !v)}
                className="p-1 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title={showPageListPanel ? "折叠页面面板" : "展开页面面板"}
              >
                {showPageListPanel ? <PanelRightClose size={24} /> : <PanelRightOpen size={24} />}
              </button>
            </div>
            <CategoryTree
              categories={categories}
              selectedId={selectedCatId}
              onSelect={(id) => { setSelectedCatId(id); setSelectedPageId(null); setSearchQuery('') }}
              onCreate={handleCreateCategory}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
            />
            {showStarred && (
              <div className="border-t border-[var(--border-color)] flex-shrink-0">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--warning)] uppercase flex items-center gap-1">
                  <Star size={17} fill="#c5a332" /> 收藏
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {starredPages.map(p => (
                    <div
                      key={p.id}
                      onClick={() => handleSelectPage(p.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[14px] hover:bg-[var(--bg-hover)] ${
                        selectedPageId === p.id ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      <Star size={17} className="text-[var(--warning)] shrink-0" fill="#c5a332" />
                      <span className="truncate">{p.title || '无标题'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="border-t border-[var(--border-color)] flex-shrink-0 mt-auto">
              <button
                onClick={() => setShowRecycleBin(true)}
                className="w-full flex items-center gap-2 px-4 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Trash2 size={21} /> 回收站
              </button>
            </div>
          </div>
        </ResizablePanel>

      {/* Middle: Page List */}
      <ResizablePanel storageKey="sidebarWidth_knowledgePages" defaultWidth={256} minWidth={180} maxWidth={450} visible={panelsVisible && showPageListPanel} initialWidth={sidebarWidths.sidebarWidth_knowledgePages}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-1.5 min-w-0">
              {!showCategoryPanel && (
                <button
                  onClick={() => setShowCategoryPanel(true)}
                  className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  title="展开分类面板"
                >
                  <PanelLeftOpen size={24} />
                </button>
              )}
              <FileText size={20} className="text-[var(--text-secondary)] shrink-0" />
              <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate uppercase">页面</span>
            </div>
          </div>

          {/* Search + page count */}
          <div className="p-2 border-b border-[var(--border-color)] space-y-2">
            <div className="flex items-center gap-1.5 bg-[var(--input-bg)] rounded px-2 py-1">
              <Search size={20} className="text-[var(--text-muted)] shrink-0" />
              <input
                className="flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索标题或内容..."
              />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="text-[var(--text-muted)]"><X size={18} /></button>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[var(--text-primary)] font-medium truncate">{getCategoryPath(selectedCatId)}</span>
              <span className="text-[10px] text-[var(--text-muted)] shrink-0">{pages.length}</span>
            </div>
          </div>

          {/* New page + Import buttons */}
          <div className="px-2 py-1.5 border-b border-[var(--border-color)] space-y-1">
            <button onClick={handleCreatePage} className="flex items-center justify-center gap-1 w-full py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]">
              <Plus size={21} /> 新建页面
            </button>
            <button onClick={handleDialogImport} className="flex items-center justify-center gap-1 w-full py-1.5 text-xs border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)] hover:border-[#555] transition-colors">
              <Download size={18} /> 导入文件
            </button>
          </div>

          {/* Hint */}
          {hasSubCategories && !searchQuery && (
            <div className="flex items-start gap-1.5 px-3 py-1.5 text-[11px] text-[var(--warning)] bg-[#2a2a1e] border-b border-[var(--border-color)]">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>此分类下还有子分类，页面直接属于本分类</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <div className="border-2 border-[var(--border-color)] border-t-[#007acc] rounded-full w-5 h-5 animate-spin" />
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)] px-4">
                <FileText size={36} className="mb-3 opacity-40" />
                <p className="text-xs text-center">{searchQuery ? '无匹配结果' : '此分类下暂无页面'}</p>
              </div>
            ) : (
              pages
                .filter(p => !showStarred || !p.isStarred)
                .map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => handleSelectPage(p.id)}
                    className={`px-3 py-2 cursor-pointer border-b border-[#2d2d2d] hover:bg-[var(--bg-hover)] group ${
                      selectedPageId === p.id ? 'bg-[var(--bg-selected)]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {p.isStarred && <Star size={14} className="text-[var(--warning)] fill-[#c5a332] shrink-0" />}
                      <span className="text-[13px] text-[var(--text-primary)] truncate flex-1">{p.title || '无标题'}</span>
                      {p.backlinks && p.backlinks.length > 0 && (
                        <span className="text-[10px] text-[var(--accent)] shrink-0">{p.backlinks.length}</span>
                      )}
                      {!searchQuery && (
                        <div className="hidden group-hover:flex items-center gap-0 shrink-0">
                          <button
                            onClick={e => { e.stopPropagation(); handleMovePage(p.id, 'up') }}
                            disabled={idx === 0}
                            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default"
                            title="上移"
                          >
                            <ChevronUp size={20} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleMovePage(p.id, 'down') }}
                            disabled={idx === pages.length - 1}
                            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default"
                            title="下移"
                          >
                            <ChevronDown size={20} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      {p.updatedAt.slice(0, 10)} · {p.contentMd.length} 字
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </ResizablePanel>

      {/* Right: Editor */}
      <div className="flex-1 flex overflow-hidden">
        {selectedPageId ? (
          <PageEditor
            pageId={selectedPageId}
            categories={categories}
            allPages={pages}
            zoom={zoom}
            onBack={handleBackToList}
            onDeleted={() => handleDeletePage(selectedPageId)}
            onNavigate={handleSelectPage}
            onUpdate={handleRefresh}
            onTitleChange={handleTitleChange}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]">
            <FileText size={48} className="mb-4 opacity-25" />
            <p className="text-sm">选择或创建一个页面开始</p>
            <p className="text-xs mt-2 text-[var(--text-disabled)]">使用 [[页面名]] 创建双向链接 · 点击 ⭐ 收藏</p>
            <button onClick={handleCreatePage} className="mt-5 px-4 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]">
              创建第一个页面
            </button>
          </div>
        )}
      </div>

      {showRecycleBin && (
        <RecycleBinPanel
          module="knowledge"
          onClose={() => setShowRecycleBin(false)}
          onRestored={() => { refreshPages(); refreshStarred(); setSelectedPageId(null) }}
        />
      )}
    </div>
    </ImportZone>
  )
}
