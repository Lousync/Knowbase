import { useState, useEffect, useRef } from 'react'
import { Folder, Plus, Pencil, Trash2, Star, Download, ChevronDown, ChevronUp, ChevronRight, ArrowLeft, FolderSearch, FolderInput, Link2Off, Copy, Scissors, FileOutput } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../../types'
import { FileIcon } from '../../../components/shared/FileIcon'
import { getFileTypeInfo } from '../../../lib/fileTypes'
import { ConfirmDialog } from '../../../components/shared'
import { getSetting, setSetting, reorderKnowledgePage } from '../../../lib/ipc'
import { isEditingInput } from '../../../lib/shortcuts'
import { getGlobalActiveTab } from '../../../lib/activeTab'
import { CategoryMovePicker } from './CategoryMovePicker'
import { useContextMenuPosition } from '../../../lib/useContextMenuPosition'

interface Props {
  notebookName: string
  notebookId: string
  chapters: KnowledgeCategory[]
  selectedChapterId: string | null
  focusChapterId: string | null  // when set, hide chapter list & show only this chapter
  onSelectChapter: (id: string | null) => void
  onCreateChapter: (name: string) => void
  onRenameChapter: (id: string, name: string) => void
  onDeleteChapter: (id: string) => void
  pages: KnowledgePage[]
  activePageId: string | null
  onOpenPage: (id: string) => void
  onCreatePageNamed: (categoryId: string, title: string) => void
  onImport: () => void
  onDropOnChapter: (pageId: string, chapterId: string) => void
  onCollapse: () => void
  onToggleStar: (id: string) => void
  onSortChapter: (id: string, direction: 'up' | 'down') => void
  onSortPage: (id: string, direction: 'up' | 'down') => void
  onRefreshPages: () => void
  onLocateInExplorer?: (pageId: string) => void
  // Category drag-drop: move a category under a specific parent
  onMoveCategory: (categoryId: string, newParentId: string | null) => void
  // Move callbacks (for context menu)
  allCategories: KnowledgeCategory[]
  onMovePageToLoose: (pageId: string) => void
  onMovePageToNotebook: (pageId: string, notebookId: string) => void
  onMovePageToCategory: (pageId: string, categoryId: string) => void
  onCopy?: (items: { type: 'category' | 'page'; id: string }[]) => void
  onCut?: (items: { type: 'category' | 'page'; id: string }[]) => void
  onExportPage?: (pageId: string) => void
  onDeletePage?: (pageId: string) => void
  onRenamePage?: (pageId: string, name: string) => void
  clipboard?: { action: 'copy' | 'cut'; items: { type: 'category' | 'page'; id: string }[] } | null
  cutItemIds?: Set<string>
}

export function ChapterPanel({
  notebookName, notebookId, chapters, selectedChapterId, focusChapterId, onSelectChapter,
  onCreateChapter, onRenameChapter, onDeleteChapter,
  pages, activePageId, onOpenPage, onCreatePageNamed, onImport,
  onDropOnChapter, onCollapse, onToggleStar, onSortChapter, onSortPage, onRefreshPages,
  onLocateInExplorer, onMoveCategory,
  allCategories, onMovePageToLoose, onMovePageToNotebook, onMovePageToCategory,
  onCopy, onCut, onExportPage, onDeletePage, onRenamePage, clipboard, cutItemIds,
}: Props) {
  const [showNewChapter, setShowNewChapter] = useState(false)
  const [newName, setNewName] = useState('')
  // 新建页面：先命名再创建
  const [showNewPage, setShowNewPage] = useState(false)
  const [newPageName, setNewPageName] = useState('')
  // 章节/页面列表可折叠(章节过多时收起,页面区不被挤压)
  const [chaptersOpen, setChaptersOpen] = useState(true)
  const [pgOpen, setPgOpen] = useState(true)

  const commitNewPage = () => {
    const name = newPageName.trim()
    setShowNewPage(false); setNewPageName('')
    if (name) onCreatePageNamed((selectedChapterId || focusChapterId) as string, name)
  }
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [editPageName, setEditPageName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ pageId: string; x: number; y: number } | null>(null)
  const { menuRef: contextMenuRef, style: contextMenuStyle } = useContextMenuPosition(contextMenu)
  const [movePickerOpen, setMovePickerOpen] = useState(false)
  const [movePickerPageId, setMovePickerPageId] = useState<string | null>(null)
  const [dragOverChId, setDragOverChId] = useState<string | null>(null)
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null)
  const [dragOverPageSide, setDragOverPageSide] = useState<'left' | 'right'>('left')
  const [dragOverNotebookArea, setDragOverNotebookArea] = useState(false)

  // Drag ref: avoid getData() in dragOver (Chromium may block it)
  const dragRef = useRef<{ type: 'category' | 'page'; id: string } | null>(null)

  const focusChapter = focusChapterId ? chapters.find(c => c.id === focusChapterId) : null

  useEffect(() => {
    getSetting('skipDeleteConfirm_chapter').then(v => { if (v === true) setSkipDeleteConfirm(true) })
  }, [])

  // Dismiss context menu on Escape (backdrop onClick handles outside clicks)
  useEffect(() => {
    if (!contextMenu) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('keydown', onEsc) }
  }, [contextMenu])

  // F2 — keyboard rename active page / selected / focused chapter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getGlobalActiveTab() !== 'knowledge') return
      if (isEditingInput(e)) return
      if (e.key === 'F2') {
        // Priority: active page → focused chapter → selected chapter
        if (activePageId) {
          const pg = pages.find(p => p.id === activePageId)
          e.preventDefault()
          handleStartRenamePage(activePageId, pg?.title || '')
          return
        }
        const targetId = focusChapter?.id ?? selectedChapterId
        if (!targetId) return
        e.preventDefault()
        const ch = chapters.find(c => c.id === targetId)
        if (ch) handleStartRename(ch.id, ch.name)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedChapterId, focusChapter, chapters, activePageId, pages])

  function handleCreateChapter() {
    if (!newName.trim()) { setShowNewChapter(false); setNewName(''); return }
    onCreateChapter(newName.trim()); setNewName(''); setShowNewChapter(false)
  }

  function handleStartRename(id: string, name: string) { setEditingId(id); setEditName(name) }
  function handleRename(id: string) {
    if (!editName.trim()) { setEditingId(null); return }
    onRenameChapter(id, editName.trim()); setEditingId(null)
  }

  function handleStartRenamePage(id: string, name: string) { setEditingPageId(id); setEditPageName(name) }
  function handleRenamePage(id: string) {
    if (!editPageName.trim()) { setEditingPageId(null); return }
    onRenamePage?.(id, editPageName.trim()); setEditingPageId(null)
  }

  // ---- cycle detection for category moves ----
  function isDescendantOf(ancestorId: string, nodeId: string): boolean {
    const visited = new Set<string>()
    let currentId: string | null = nodeId
    while (currentId) {
      if (visited.has(currentId)) break
      visited.add(currentId)
      if (currentId === ancestorId) return true
      const cat = allCategories.find(c => c.id === currentId)
      currentId = cat?.parentId ?? null
    }
    return false
  }

  // ---- parse drag data (category or page) ----
  function parseDrag(e: React.DragEvent): { type: 'category' | 'page'; id: string } | null {
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return null
    try {
      const v = JSON.parse(raw)
      if ((v.type === 'category' || v.type === 'page') && typeof v.id === 'string') return v
    } catch {}
    return null
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button onClick={onCollapse}
            className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="返回">
            <ArrowLeft size={18} />
          </button>
          {focusChapter && editingId === focusChapter.id ? (
            <input
              className="flex-1 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-[12px] outline-none text-[var(--text-primary)] min-w-0"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={() => handleRename(focusChapter.id)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(focusChapter.id); if (e.key === 'Escape') setEditingId(null) }}
              placeholder="章节名称"
              autoFocus
            />
          ) : (
            <span className="text-[12px] font-medium text-[var(--text-secondary)] truncate">
              {focusChapter ? `${notebookName} / ${focusChapter.name}` : notebookName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {focusChapter && editingId !== focusChapter.id && (
            <button
              onClick={() => handleStartRename(focusChapter.id, focusChapter.name)}
              className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="重命名章节 (F2)">
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Chapters — hidden when focusing a single chapter */}
      {!focusChapter && (
      <div
        className="px-2 py-1 border-b border-[var(--border-color)] shrink-0"
        onDragOver={e => {
          const d = dragRef.current
          if (!d) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'

          const targetChapter = (e.target as HTMLElement).closest('[data-chapter-id]') as HTMLElement | null
          if (targetChapter && d.type === 'page') {
            setDragOverChId(targetChapter.dataset.chapterId!)
          } else {
            setDragOverChId(null)
          }
        }}
        onDrop={e => {
          e.preventDefault()
          const dragged = dragRef.current
          dragRef.current = null
          setDragOverChId(null)
          const d = dragged || parseDrag(e)
          if (!d) return

          const targetChapter = (e.target as HTMLElement).closest('[data-chapter-id]') as HTMLElement | null
          if (targetChapter && d.type === 'page') {
            onDropOnChapter(d.id, targetChapter.dataset.chapterId!)
          }
        }}
      >
        <button
          onClick={() => setChaptersOpen(o => !o)}
          className="w-full flex items-center justify-between px-1 mb-1 group/toggle"
          title={chaptersOpen ? '收起章节列表' : '展开章节列表'}
        >
          <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            {chaptersOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            章节
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">{chapters.length}</span>
        </button>
        {chaptersOpen && (
        <>
        <div className="max-h-[38vh] overflow-y-auto">
        {chapters.map(ch => (
          <div key={ch.id} data-chapter-id={ch.id}>
            {editingId === ch.id ? (
              <input
                className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[13px] outline-none text-[var(--text-primary)]"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => handleRename(ch.id)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(ch.id); if (e.key === 'Escape') setEditingId(null) }}
                autoFocus
              />
            ) : (
              <div
                data-chapter-id={ch.id}
                onClick={() => onSelectChapter(ch.id)}
                className={`flex items-center gap-1.5 px-1 py-1 cursor-pointer group rounded transition-colors text-[13px] ${
                  selectedChapterId === ch.id ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                  : dragOverChId === ch.id ? 'bg-[var(--accent)]/10 outline outline-2 outline-[var(--accent)] outline-offset-[-2px]'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Folder size={16} className={`shrink-0 ${selectedChapterId === ch.id ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`} />
                <span className="flex-1 truncate">{ch.name}</span>
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button onClick={e => { e.stopPropagation(); onSortChapter(ch.id, 'up') }}
                    className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="上移">
                    <ChevronUp size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); onSortChapter(ch.id, 'down') }}
                    className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="下移">
                    <ChevronDown size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleStartRename(ch.id, ch.name) }}
                    className="p-0.5 hover:text-white text-[var(--text-secondary)]" title="重命名">
                    <Pencil size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); if (skipDeleteConfirm) onDeleteChapter(ch.id); else setDeleteTarget({ id: ch.id, name: ch.name }) }}
                    className="p-0.5 hover:text-[var(--danger)] text-[var(--text-secondary)]" title="删除">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {showNewChapter ? (
          <input
            className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[13px] outline-none text-[var(--text-primary)] mt-0.5"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={handleCreateChapter}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateChapter(); if (e.key === 'Escape') { setShowNewChapter(false); setNewName('') } }}
            placeholder="章节名称"
            autoFocus
          />
        ) : (
          <button onClick={() => setShowNewChapter(true)}
            className="w-full flex items-center gap-1.5 px-1 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors mt-0.5">
            <Plus size={13} />新建章节
          </button>
        )}
        </div>
        </>
        )}
      </div>
      )}

      {/* Pages in selected chapter */}
      <div
        className={`${pgOpen ? 'flex-1 overflow-y-auto' : 'shrink-0'} px-2 py-1 transition-colors ${dragOverNotebookArea ? 'bg-[var(--accent)]/10 outline outline-2 outline-dashed outline-[var(--accent)] outline-offset-[-2px]' : ''}`}
        onDragOver={e => {
          const d = dragRef.current
          if (!d) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'

          const targetChapter = (e.target as HTMLElement).closest('[data-chapter-id]') as HTMLElement | null
          const targetPage = (e.target as HTMLElement).closest('[data-page-id]') as HTMLElement | null

          if (targetChapter) {
            const chId = targetChapter.dataset.chapterId!
            // Only pages can be highlighted on chapter rows; categories go to notebook area
            if (d.type === 'page') {
              setDragOverChId(chId)
            }
            setDragOverNotebookArea(false)
            setDragOverPageId(null)
          } else if (targetPage && d.type === 'page' && d.id !== targetPage.dataset.pageId!) {
            setDragOverPageId(targetPage.dataset.pageId!)
            const rect = targetPage.getBoundingClientRect()
            setDragOverPageSide(e.clientY < rect.top + rect.height / 2 ? 'left' : 'right')
            setDragOverChId(null)
            setDragOverNotebookArea(false)
          } else if (d.type === 'category' && d.id !== notebookId && !chapters.some(ch => ch.id === d.id)) {
            setDragOverNotebookArea(true)
            setDragOverChId(null)
            setDragOverPageId(null)
          } else {
            setDragOverChId(null)
            setDragOverPageId(null)
            setDragOverNotebookArea(false)
          }
        }}
        onDragLeave={e => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setDragOverChId(null)
            setDragOverPageId(null)
            setDragOverNotebookArea(false)
          }
        }}
        onDrop={e => {
          e.preventDefault()
          const dragged = dragRef.current
          dragRef.current = null
          setDragOverChId(null)
          setDragOverPageId(null)
          setDragOverNotebookArea(false)
          const d = dragged || parseDrag(e)
          if (!d) return

          const targetChapter = (e.target as HTMLElement).closest('[data-chapter-id]') as HTMLElement | null
          const targetPage = (e.target as HTMLElement).closest('[data-page-id]') as HTMLElement | null

          if (targetChapter && d.type === 'page') {
            onDropOnChapter(d.id, targetChapter.dataset.chapterId!)
            return
          }

          if (targetPage && d.type === 'page' && d.id !== targetPage.dataset.pageId!) {
            const srcId = d.id
            const srcIdx = pages.findIndex(pg => pg.id === srcId)
            if (srcIdx !== -1) {
              const targetIdx = pages.findIndex(pg => pg.id === targetPage.dataset.pageId!)
              if (targetIdx !== -1) {
                const rect = targetPage.getBoundingClientRect()
                const side = e.clientY < rect.top + rect.height / 2 ? 'left' : 'right'
                let newIdx = side === 'left' ? targetIdx : targetIdx + 1
                if (srcIdx < newIdx) newIdx--
                if (newIdx !== srcIdx) {
                  reorderKnowledgePage(srcId, newIdx)
                  onRefreshPages()
                }
              }
            }
            return
          }

          // Category drop on notebook area → become chapter
          if (d.type === 'category' && d.id !== notebookId && !chapters.some(ch => ch.id === d.id)) {
            onMoveCategory(d.id, notebookId)
          }
        }}
      >
        <button
          onClick={() => setPgOpen(o => !o)}
          className="w-full flex items-center justify-between px-1 mb-1"
          title={pgOpen ? '收起页面列表' : '展开页面列表'}
        >
          <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            {pgOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            页面
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">{pages.length}</span>
        </button>
        {pgOpen && (
        <>
        {pages.length === 0 ? (
          <p className="px-1 py-4 text-[11px] text-[var(--text-disabled)] italic text-center">
            {focusChapter ? '暂无页面' : '暂未选中章节'}
          </p>
        ) : (
          pages.map((p, idx) => (
                <div key={p.id}
                  data-page-id={p.id}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                    dragRef.current = { type: 'page', id: p.id }
                    ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                  }}
                  onDragEnd={e => {
                    ;(e.currentTarget as HTMLElement).style.opacity = '1'
                    dragRef.current = null
                    setDragOverPageId(null)
                  }}
                  onClick={() => onOpenPage(p.id)}
                  onContextMenu={e => {
                    e.preventDefault(); e.stopPropagation()
                    setContextMenu({ pageId: p.id, x: e.clientX, y: e.clientY })
                  }}
                  className={`flex items-center gap-1.5 px-1 py-1 cursor-pointer group rounded text-[13px] transition-colors border-l-[3px] ${
                    activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                  } ${
                    dragOverPageId === p.id
                      ? dragOverPageSide === 'left'
                        ? 'border-t-2 border-t-[var(--accent)]'
                        : 'border-b-2 border-b-[var(--accent)]'
                      : ''
                  }`}
                  style={{
                    ...(cutItemIds?.has(p.id) ? { opacity: 0.45 } : {})
                  }}
                >
                  <FileIcon ext={p.fileType || ''} size={15} />
                  {editingPageId === p.id ? (
                    <input
                      className="flex-1 min-w-0 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-[13px] outline-none text-[var(--text-primary)]"
                      value={editPageName}
                      onChange={e => setEditPageName(e.target.value)}
                      onBlur={() => handleRenamePage(p.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenamePage(p.id); if (e.key === 'Escape') setEditingPageId(null) }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 truncate">{p.title || '无标题'}</span>
                  )}
                  {(() => { const fi = getFileTypeInfo(p.fileType || ''); return fi.badge ? <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-0.5" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> : null })()}
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e => { e.stopPropagation(); onSortPage(p.id, 'up') }}
                      className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="上移">
                      <ChevronUp size={11} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onSortPage(p.id, 'down') }}
                      className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="下移">
                      <ChevronDown size={11} />
                    </button>
                  </div>
                  <button onClick={e => { e.stopPropagation(); onToggleStar(p.id) }}
                    className="shrink-0 p-0.5 opacity-0 group-hover:opacity-100">
                    <Star size={13} className={p.isStarred ? 'text-[var(--warning)] fill-[#c5a332]' : 'text-[var(--text-muted)]'} />
                  </button>
                </div>
            )
          ))}
        {(selectedChapterId || focusChapterId) && (
          <>
            {showNewPage && (
              <input
                autoFocus
                value={newPageName}
                onChange={e => setNewPageName(e.target.value)}
                onBlur={() => { commitNewPage() }}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitNewPage()
                  if (e.key === 'Escape') { setShowNewPage(false); setNewPageName('') }
                }}
                placeholder="页面名称（Enter 确认）"
                className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-2 py-1 text-[12px] outline-none text-[var(--text-primary)]"
              />
            )}
            <div className="flex gap-1 mt-1">
              <button onClick={() => setShowNewPage(true)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
                <Plus size={12} />新建页面
              </button>
              <button onClick={onImport}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
                <Download size={12} />导入
              </button>
            </div>
          </>
        )}
        </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[60]" onClick={() => setContextMenu(null)}>
          <div
            className="absolute bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-xl py-0.5 min-w-[170px]"
            ref={contextMenuRef}
            style={contextMenuStyle}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            {onCopy && (
              <button onClick={() => { onCopy([{ type: 'page', id: contextMenu.pageId }]); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                <Copy size={14} className="text-[var(--text-muted)]" />复制
              </button>
            )}
            {onCut && (
              <button onClick={() => { onCut([{ type: 'page', id: contextMenu.pageId }]); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                <Scissors size={14} className="text-[var(--text-muted)]" />剪切
              </button>
            )}
            {onExportPage && (
              <>
                <div className="border-t border-[var(--border-color)] my-0.5" />
                <button onClick={() => { onExportPage(contextMenu.pageId); setContextMenu(null) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                  <FileOutput size={14} className="text-[var(--text-muted)]" />导出文件...
                </button>
              </>
            )}
            <div className="border-t border-[var(--border-color)] my-0.5" />
            {onRenamePage && (
              <button onClick={() => { const pg = pages.find(x => x.id === contextMenu.pageId); handleStartRenamePage(contextMenu.pageId, pg?.title || ''); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                <Pencil size={14} className="text-[var(--text-muted)]" />重命名
              </button>
            )}
            {onLocateInExplorer && (
              <button
                onClick={() => { onLocateInExplorer(contextMenu.pageId); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <FolderSearch size={14} className="text-[var(--text-muted)]" />
                在资源管理器中显示
              </button>
            )}
            <button
              onClick={() => {
                onMovePageToLoose(contextMenu.pageId)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
            >
              <Link2Off size={14} className="text-[var(--text-muted)]" />
              取消归属
            </button>
            <button
              onClick={() => {
                setMovePickerPageId(contextMenu.pageId)
                setMovePickerOpen(true)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
            >
              <FolderInput size={14} className="text-[var(--text-muted)]" />
              移到目录...
            </button>
            <div className="border-t border-[var(--border-color)] my-0.5" />
            {onDeletePage && (
              <button onClick={() => { onDeletePage(contextMenu.pageId); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors text-left">
                <Trash2 size={14} />删除
              </button>
            )}
          </div>
        </div>
      )}

      {/* Category move picker */}
      {movePickerOpen && movePickerPageId && (
        <CategoryMovePicker
          open={movePickerOpen}
          moveType="page"
          moveId={movePickerPageId}
          categories={allCategories}
          sortCats={list => [...list].sort((a, b) => a.sortOrder - b.sortOrder)}
          isDescendant={() => false}
          canAcceptCategory={() => true}
          onMoveCategory={() => {}}
          onMovePageToNotebook={onMovePageToNotebook}
          onMovePageToCategory={onMovePageToCategory}
          onMovePageToLoose={onMovePageToLoose}
          onClose={() => { setMovePickerOpen(false); setMovePickerPageId(null) }}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除章节"
        message={`确定要删除章节「${deleteTarget?.name ?? ''}」吗？其下所有页面将被移到零散文件中。`}
        confirmLabel="删除"
        onConfirm={(skipNext) => {
          if (skipNext) { setSkipDeleteConfirm(true); setSetting('skipDeleteConfirm_chapter', true) }
          if (deleteTarget) { onDeleteChapter(deleteTarget.id); setDeleteTarget(null) }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
