import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Search, X, Star, ChevronUp, ChevronDown, AlertCircle, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../types'
import {
  getKnowledgeCategories, createKnowledgeCategory, updateKnowledgeCategory, deleteKnowledgeCategory,
  getKnowledgePages, createKnowledgePage, deleteKnowledgePage,
  searchKnowledgePages, getKnowledgeBacklinks, getKnowledgeStarredPages, moveKnowledgePage
} from '../../lib/ipc'
import { CategoryTree } from './components/CategoryTree'
import { PageEditor } from './components/PageEditor'

export function KnowledgeModule({ sidebarOpen = true }: { sidebarOpen?: boolean }) {
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
    <div className="flex h-full bg-[#1e1e1e]">
      {/* Left: Category Tree — slides to w-0 when collapsed, no residual strip */}
      <div
        className={[
          'shrink-0 bg-[#252526] border-r border-[#3c3c3c] flex flex-col',
          'transition-all duration-200 ease-out overflow-hidden',
          panelsVisible && showCategoryPanel ? 'w-64' : 'w-0 border-r-0'
        ].join(' ')}
      >
        {panelsVisible && showCategoryPanel && (
          <>
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#3c3c3c]">
              <span className="text-[11px] font-semibold text-[#969696] uppercase tracking-wide whitespace-nowrap">知识主题</span>
              <button
                onClick={() => setShowCategoryPanel(false)}
                className="p-1 rounded hover:bg-[#3c3c3c] text-[#969696] hover:text-[#cccccc] transition-colors"
                title="折叠分类面板"
              >
                <PanelLeftClose size={16} />
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
              <div className="border-t border-[#3c3c3c] flex-shrink-0">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[#c5a332] uppercase flex items-center gap-1">
                  <Star size={11} fill="#c5a332" /> 收藏
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {starredPages.map(p => (
                    <div
                      key={p.id}
                      onClick={() => handleSelectPage(p.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[14px] hover:bg-[#2a2d2e] ${
                        selectedPageId === p.id ? 'bg-[#094771] text-white' : 'text-[#cccccc]'
                      }`}
                    >
                      <Star size={11} className="text-[#c5a332] shrink-0" fill="#c5a332" />
                      <span className="truncate">{p.title || '无标题'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Middle: Page List — slides to w-0; header hosts category expand button when category collapsed */}
      <div
        className={[
          'shrink-0 bg-[#252526] border-r border-[#3c3c3c] flex flex-col',
          'transition-all duration-200 ease-out overflow-hidden',
          panelsVisible && showPageListPanel ? 'w-64' : 'w-0 border-r-0'
        ].join(' ')}
      >
        {panelsVisible && showPageListPanel && (
          <>
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#3c3c3c]">
              <div className="flex items-center gap-1.5 min-w-0">
                {!showCategoryPanel && (
                  <button
                    onClick={() => setShowCategoryPanel(true)}
                    className="p-0.5 rounded hover:bg-[#3c3c3c] text-[#969696] hover:text-[#cccccc] transition-colors"
                    title="展开分类面板"
                  >
                    <PanelLeftOpen size={16} />
                  </button>
                )}
                <FileText size={13} className="text-[#969696] shrink-0" />
                <span className="text-[11px] text-[#969696] font-medium truncate uppercase">页面</span>
              </div>
              <button
                onClick={() => setShowPageListPanel(false)}
                className="p-1 rounded hover:bg-[#3c3c3c] text-[#969696] hover:text-[#cccccc] transition-colors"
                title="折叠页面面板"
              >
                <PanelRightClose size={16} />
              </button>
            </div>

            {/* Search + page count */}
            <div className="p-2 border-b border-[#3c3c3c] space-y-2">
              <div className="flex items-center gap-1.5 bg-[#3c3c3c] rounded px-2 py-1">
                <Search size={13} className="text-[#6a6a6a] shrink-0" />
                <input
                  className="flex-1 bg-transparent text-[12px] text-[#cccccc] outline-none placeholder:text-[#6a6a6a]"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索标题或内容..."
                />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="text-[#6a6a6a]"><X size={12} /></button>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[#cccccc] font-medium truncate">{getCategoryPath(selectedCatId)}</span>
                <span className="text-[10px] text-[#6a6a6a] shrink-0">{pages.length}</span>
              </div>
            </div>

            {/* New page button */}
            <div className="px-2 py-1.5 border-b border-[#3c3c3c]">
              <button onClick={handleCreatePage} className="flex items-center justify-center gap-1 w-full py-1.5 text-xs bg-[#007acc] text-white rounded hover:bg-[#1a8ad4]">
                <Plus size={14} /> 新建页面
              </button>
            </div>

            {/* Hint */}
            {hasSubCategories && !searchQuery && (
              <div className="flex items-start gap-1.5 px-3 py-1.5 text-[11px] text-[#c5a332] bg-[#2a2a1e] border-b border-[#3c3c3c]">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>此分类下还有子分类，页面直接属于本分类</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="border-2 border-[#3c3c3c] border-t-[#007acc] rounded-full w-5 h-5 animate-spin" />
                </div>
              ) : pages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#6a6a6a] px-4">
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
                      className={`px-3 py-2 cursor-pointer border-b border-[#2d2d2d] hover:bg-[#2a2d2e] group ${
                        selectedPageId === p.id ? 'bg-[#094771]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {p.isStarred && <Star size={9} className="text-[#c5a332] fill-[#c5a332] shrink-0" />}
                        <span className="text-[13px] text-[#cccccc] truncate flex-1">{p.title || '无标题'}</span>
                        {p.backlinks && p.backlinks.length > 0 && (
                          <span className="text-[10px] text-[#007acc] shrink-0">{p.backlinks.length}</span>
                        )}
                        {!searchQuery && (
                          <div className="hidden group-hover:flex items-center gap-0 shrink-0">
                            <button
                              onClick={e => { e.stopPropagation(); handleMovePage(p.id, 'up') }}
                              disabled={idx === 0}
                              className="p-0.5 text-[#6a6a6a] hover:text-[#cccccc] disabled:opacity-30 disabled:cursor-default"
                              title="上移"
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleMovePage(p.id, 'down') }}
                              disabled={idx === pages.length - 1}
                              className="p-0.5 text-[#6a6a6a] hover:text-[#cccccc] disabled:opacity-30 disabled:cursor-default"
                              title="下移"
                            >
                              <ChevronDown size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-[#6a6a6a] mt-0.5">
                        {p.updatedAt.slice(0, 10)} · {p.contentMd.length} 字
                      </div>
                    </div>
                  ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Editor-edge expand strip — only shown when page list is collapsed */}
      {panelsVisible && !showPageListPanel && (
        <div className="shrink-0 w-9 bg-[#252526] border-r border-[#3c3c3c] flex flex-col items-center py-2 gap-3">
          {!showCategoryPanel && (
            <button
              onClick={() => setShowCategoryPanel(true)}
              className="p-1.5 rounded hover:bg-[#3c3c3c] text-[#969696] hover:text-[#cccccc] transition-colors"
              title="展开分类面板"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
          <button
            onClick={() => setShowPageListPanel(true)}
            className="p-1.5 rounded hover:bg-[#3c3c3c] text-[#969696] hover:text-[#cccccc] transition-colors"
            title="展开页面列表面板"
          >
            <PanelRightOpen size={16} />
          </button>
        </div>
      )}

      {/* Right: Editor */}
      <div className="flex-1 flex overflow-hidden">
        {selectedPageId ? (
          <PageEditor
            pageId={selectedPageId}
            categories={categories}
            allPages={pages}
            onBack={handleBackToList}
            onDeleted={() => handleDeletePage(selectedPageId)}
            onNavigate={handleSelectPage}
            onUpdate={handleRefresh}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#6a6a6a]">
            <FileText size={48} className="mb-4 opacity-25" />
            <p className="text-sm">选择或创建一个页面开始</p>
            <p className="text-xs mt-2 text-[#555]">使用 [[页面名]] 创建双向链接 · 点击 ⭐ 收藏</p>
            <button onClick={handleCreatePage} className="mt-5 px-4 py-1.5 text-xs bg-[#007acc] text-white rounded hover:bg-[#1a8ad4]">
              创建第一个页面
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
