import { useState, useEffect, useRef } from 'react'
import { FileText, Folder, FolderOpen, BookOpen, ChevronRight, ChevronDown, ChevronUp, FolderPlus, FilePlus, Pencil, Trash2, Star, Download, ArrowUpDown, CornerLeftUp, FolderInput, Link2Off } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../../types'
import { ConfirmDialog } from '../../../components/shared'
import { getSetting, setSetting } from '../../../lib/ipc'
import { getFileTypeInfo } from '../../../lib/fileTypes'
import { isEditingInput } from '../../../lib/shortcuts'
import { CategoryMovePicker } from './CategoryMovePicker'

interface Props {
  categories: KnowledgeCategory[]
  allPages: KnowledgePage[]
  loosePages: KnowledgePage[]
  starredPages: KnowledgePage[]
  selectedCategoryId: string | null
  focusChapterId: string | null
  activePageId: string | null
  onSelectCategory: (id: string | null) => void
  onSelectCategoryChapter: (notebookId: string, chapterId: string) => void
  onCreateNotebook: (name: string, categoryType: 'folder' | 'notebook', parentId: string | null) => void
  onRenameNotebook: (id: string, name: string) => void
  onDeleteNotebook: (id: string) => void
  onOpenPage: (id: string) => void
  onCreateLoosePage: () => void
  onCreatePageUnder: (categoryId: string) => void
  onImport: () => void
  onDropOnNotebook: (pageId: string, notebookId: string) => void
  onDropOnCategory: (pageId: string, categoryId: string) => void
  onDropOnLooseArea: (pageId: string) => void
  onMoveCategory: (categoryId: string, newParentId: string | null) => void
  onSortCategory?: (id: string, direction: 'up' | 'down') => void
  onSortPage?: (id: string, direction: 'up' | 'down') => void
  onCreateChapterUnderNotebook?: (notebookId: string) => void
  locatePageId?: string | null
}

export function NotebookList({
  categories, allPages, loosePages, starredPages,
  selectedCategoryId, focusChapterId, activePageId,
  onSelectCategory, onSelectCategoryChapter, onCreateNotebook, onRenameNotebook, onDeleteNotebook,
  onOpenPage, onCreateLoosePage, onCreatePageUnder, onImport,
  onDropOnNotebook, onDropOnCategory, onDropOnLooseArea, onMoveCategory,
  onSortCategory, onSortPage, onCreateChapterUnderNotebook, locatePageId,
}: Props) {
  // -- sort --
  const sortModes: Array<{ id: string; label: string }> = [
    { id: 'custom', label: '自定义' }, { id: 'type', label: '类型' }, { id: 'name', label: '名称' },
    { id: 'created', label: '创建时间' }, { id: 'updated', label: '更新时间' },
  ]
  const [sortMode, setSortMode] = useState<string>('custom')
  const [sortOpen, setSortOpen] = useState(false)
  const TYPE_ORDER: Record<string, number> = { notebook: 0, folder: 1 }
  function sortCats(list: KnowledgeCategory[]): KnowledgeCategory[] {
    return [...list].sort((a, b) => {
      if (sortMode === 'type') { const ta = TYPE_ORDER[a.categoryType] ?? 2; const tb = TYPE_ORDER[b.categoryType] ?? 2; if (ta !== tb) return ta - tb; return a.sortOrder - b.sortOrder }
      if (sortMode === 'name') return a.name.localeCompare(b.name)
      if (sortMode === 'created') return b.createdAt.localeCompare(a.createdAt)
      if (sortMode === 'updated') return b.updatedAt.localeCompare(a.updatedAt)
      return a.sortOrder - b.sortOrder
    })
  }
  const rootCats = sortCats(categories.filter(c => !c.parentId))
  const [newName, setNewName] = useState('')
  const [createMode, setCreateMode] = useState<'folder' | 'notebook' | null>(null)
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [starredOpen, setStarredOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ type: 'category' | 'page'; id: string; x: number; y: number } | null>(null)
  const [movePickerOpen, setMovePickerOpen] = useState(false)
  const [movePickerData, setMovePickerData] = useState<{ type: 'category' | 'page'; id: string } | null>(null)

  // Barrier ref: set on mousedown of create-mode buttons so that the ensuing
  // blur of the current input (which fires before click) aborts without creating.
  const switchingModeRef = useRef(false)

  // When createMode changes, clear any previously-typed name to prevent
  // onBlur of the old input from creating a category with the wrong type.
  useEffect(() => { setNewName('') }, [createMode])

  // Load skip-delete setting
  useEffect(() => {
    getSetting('skipDeleteConfirm_knowledgeCategory').then(v => {
      if (v === true) setSkipDeleteConfirm(true)
    })
  }, [])

  // Sort dropdown dismiss
  const sortBtnRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sortOpen) return
    const onMouseDown = (e: MouseEvent) => { if (sortBtnRef.current && !sortBtnRef.current.contains(e.target as Node)) setSortOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [sortOpen])

  // Context menu dismiss (Escape only — backdrop onClick handles outside clicks)
  useEffect(() => {
    if (!contextMenu) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('keydown', onEsc) }
  }, [contextMenu])

  // Auto-expand ancestors and scroll when locatePageId changes
  useEffect(() => {
    if (!locatePageId) return
    const page = allPages.find(p => p.id === locatePageId)
    if (!page?.categoryId) return
    const ancestors: string[] = []
    let currentId: string | null = page.categoryId
    const seen = new Set<string>()
    while (currentId) {
      if (seen.has(currentId)) break; seen.add(currentId)
      ancestors.push(currentId)
      const cat = categories.find(c => c.id === currentId)
      currentId = cat?.parentId ?? null
    }
    if (ancestors.length === 0) return
    setExpanded(prev => { const next = new Set(prev); ancestors.forEach(id => next.add(id)); return next })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-page-id="${locatePageId}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    })
  }, [locatePageId])

  // F2 — keyboard rename selected notebook / folder
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditingInput(e)) return
      if (e.key === 'F2' && selectedCategoryId) {
        e.preventDefault()
        const cat = categories.find(c => c.id === selectedCategoryId)
        if (cat) handleStartRename(cat.id, cat.name)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedCategoryId, categories])

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function handleCreate() {
    if (switchingModeRef.current) { setNewName(''); return }
    if (!newName.trim()) { setNewName(''); setCreateMode(null); setCreateParentId(null); return }
    onCreateNotebook(newName.trim(), createMode === 'notebook' ? 'notebook' : 'folder', createParentId)
    if (createParentId) {
      setExpanded(prev => new Set(prev).add(createParentId))
    }
    setNewName(''); setCreateMode(null); setCreateParentId(null)
  }

  function handleStartRename(id: string, name: string) { setEditingId(id); setEditName(name) }
  function handleRename(id: string) {
    if (!editName.trim()) { setEditingId(null); return }
    onRenameNotebook(id, editName.trim()); setEditingId(null)
  }

  // ---- cycle prevention for category moves ----
  function isDescendant(ancestorId: string, nodeId: string): boolean {
    const visited = new Set<string>()
    let currentId: string | null = nodeId
    while (currentId) {
      if (visited.has(currentId)) break
      visited.add(currentId)
      if (currentId === ancestorId) return true
      const cat = categories.find(c => c.id === currentId)
      currentId = cat?.parentId ?? null
    }
    return false
  }

  // ---- whether a category can accept dropped categories ----
  // Folders accept any category. Notebooks accept folders/chapters but not other notebooks.
  function canAcceptCategory(targetId: string, draggedId: string): boolean {
    const target = categories.find(c => c.id === targetId)
    const dragged = categories.find(c => c.id === draggedId)
    if (!target || !dragged) return false
    if (target.categoryType === 'folder') return true
    if (target.categoryType === 'notebook') {
      if (dragged.categoryType !== 'folder') return false
      return !categories.some(c => c.parentId === draggedId)
    }
    return false
  }

  // ---- parse drop data (same format as ActivityBar) ----
  function parseDrop(e: React.DragEvent): { type: 'category' | 'page'; id: string } | null {
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return null
    try { const v = JSON.parse(raw); if ((v.type === 'category' || v.type === 'page') && typeof v.id === 'string') return v } catch {}
    return null
  }

  // ---- render a tree node (recursive) ----
  function renderCategory(cat: KnowledgeCategory, depth: number, notebookAncestorId: string | null = null) {
    const isExpanded = expanded.has(cat.id)
    const isSelected = selectedCategoryId === cat.id || focusChapterId === cat.id
    const children = sortCats(categories.filter(c => c.parentId === cat.id))
    const hasChildren = children.length > 0
    const categoryPages = allPages.filter(p => p.categoryId === cat.id)
    const hasPages = categoryPages.length > 0
    const isNotebook = cat.categoryType === 'notebook'
    // Show expand arrow for folders that have sub-categories OR pages directly
    // Chapters under notebooks never expand — they toggle the sidebar instead
    const canExpand = notebookAncestorId ? false : (isNotebook ? hasChildren : (hasChildren || hasPages))
    // Pass notebook ancestor to children
    const nbId = isNotebook ? cat.id : notebookAncestorId

    // Row click: select node (toggle if already selected), notebook opens sidebar, chapters open focus view
    const handleRowClick = () => {
      if (isNotebook) {
        onSelectCategory(cat.id)
      } else if (notebookAncestorId) {
        onSelectCategoryChapter(notebookAncestorId, cat.id)
      } else {
        // Standalone folder — select it (toggle highlight)
        onSelectCategory(cat.id)
      }
    }

    // Chevron click: always toggle expand (never select)
    const handleChevronClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (canExpand) toggleExpand(cat.id)
    }

    return (
      <div key={cat.id} data-cat-id={cat.id}>
        <div
          data-cat-id={cat.id}
          draggable
          onDragStart={e => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'category', id: cat.id }))
            ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
          }}
          onDragEnd={e => {
            ;(e.currentTarget as HTMLElement).style.opacity = '1'
          }}
          onDragOver={e => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={e => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).style.opacity = '1'
            const d = parseDrop(e)
            if (!d) return
            if (d.type === 'category' && d.id !== cat.id && !isDescendant(cat.id, d.id) && canAcceptCategory(cat.id, d.id)) {
              onMoveCategory(d.id, cat.id)
            } else if (d.type === 'page') {
              const c = categories.find(x => x.id === cat.id)
              if (c?.categoryType === 'notebook') onDropOnNotebook(d.id, cat.id)
              else onDropOnCategory(d.id, cat.id)
            }
          }}
          onContextMenu={e => {
            e.preventDefault()
            setContextMenu({ type: 'category', id: cat.id, x: e.clientX, y: e.clientY })
          }}
        >
          {editingId === cat.id ? (
            <input
              className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[13px] outline-none text-[var(--text-primary)]"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={() => handleRename(cat.id)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(cat.id); if (e.key === 'Escape') setEditingId(null) }}
              autoFocus
            />
          ) : (
            <div
              onClick={handleRowClick}
              className={`flex items-center gap-1.5 py-0.5 cursor-pointer group rounded transition-colors ${
                isSelected ? 'bg-[var(--bg-selected)] text-white'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: '4px' }}
            >
              <span
                className={`shrink-0 w-3.5 flex items-center justify-center ${canExpand ? 'cursor-pointer hover:text-[var(--text-primary)]' : ''}`}
                onClick={handleChevronClick}
              >
                {canExpand ? (
                  isExpanded ? <ChevronDown size={14} className="text-[var(--text-muted)]" /> : <ChevronRight size={14} className="text-[var(--text-muted)]" />
                ) : (
                  <span className="w-3.5" />
                )}
              </span>
              {isNotebook ? (
                <BookOpen size={15} className={`shrink-0 ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
              ) : canExpand ? (
                isExpanded ? <FolderOpen size={15} className="shrink-0 text-[var(--warning)]" /> : <Folder size={15} className="shrink-0 text-[var(--warning)]" />
              ) : (
                <Folder size={15} className="shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="flex-1 truncate text-[13px]">{cat.name}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                {onSortCategory && (<><button onClick={e => { e.stopPropagation(); onSortCategory(cat.id, 'up') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="上移"><ChevronUp size={13} /></button><button onClick={e => { e.stopPropagation(); onSortCategory(cat.id, 'down') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="下移"><ChevronDown size={13} /></button></>)}
                {isNotebook ? (
                  onCreateChapterUnderNotebook && <button onClick={e => { e.stopPropagation(); onCreateChapterUnderNotebook(cat.id) }} className="p-0.5 hover:text-[var(--warning)] text-[var(--text-secondary)]" title="新建章节"><FolderPlus size={13} /></button>
                ) : (
                  <>
                    <button onClick={e => { e.stopPropagation(); onCreatePageUnder(cat.id) }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-secondary)]" title="在此目录下新建页面"><FilePlus size={13} /></button>
                    <button onClick={e => { e.stopPropagation(); setCreateParentId(cat.id); setCreateMode('folder'); setNewName('') }} className="p-0.5 hover:text-[var(--warning)] text-[var(--text-secondary)]" title="新建子目录"><FolderPlus size={13} /></button>
                  </>
                )}
                <button onClick={e => { e.stopPropagation(); handleStartRename(cat.id, cat.name) }} className="p-0.5 hover:text-white text-[var(--text-secondary)]" title="重命名"><Pencil size={13} /></button>
                <button onClick={e => { e.stopPropagation(); if (skipDeleteConfirm) onDeleteNotebook(cat.id); else setDeleteTarget({ id: cat.id, name: cat.name }) }} className="p-0.5 hover:text-[var(--danger)] text-[var(--text-secondary)]" title="删除"><Trash2 size={13} /></button>
              </div>
            </div>
          )}
        </div>
        {/* Per-node inline input for sub-folder creation */}
        {createParentId === cat.id && (
          <div style={{ paddingLeft: `${(depth + 1) * 16 + 8}px`, paddingRight: '4px' }}>
            <input
              className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[12px] outline-none text-[var(--text-primary)] mt-0.5"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={handleCreate}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setCreateMode(null); setCreateParentId(null); setNewName('') }
              }}
              placeholder={`${cat.name} > 子目录名称`}
              autoFocus
            />
          </div>
        )}
        {isExpanded && canExpand && (
          <div>
            {/* Pages directly under this category */}
            {categoryPages.map(p => (
              <div key={p.id}
                data-page-id={p.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                  ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                }}
                onDragEnd={e => {
                  ;(e.currentTarget as HTMLElement).style.opacity = '1'
                }}
                onClick={() => onOpenPage(p.id)}
                onContextMenu={e => {
                  e.preventDefault()
                  setContextMenu({ type: 'page', id: p.id, x: e.clientX, y: e.clientY })
                }}
                className={`flex items-center gap-1.5 py-0.5 cursor-pointer group rounded transition-colors border-l-[3px] ${
                  activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                }`}
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px`, paddingRight: '4px' }}
              >
                <span className="w-3.5 shrink-0" />
                <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
                <span className="flex-1 truncate text-[13px]">{p.title || '无标题'}</span>
                {onSortPage && <div className="hidden group-hover:flex items-center gap-0.5 shrink-0"><button onClick={e => { e.stopPropagation(); onSortPage(p.id, 'up') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="上移"><ChevronUp size={11} /></button><button onClick={e => { e.stopPropagation(); onSortPage(p.id, 'down') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="下移"><ChevronDown size={11} /></button></div>}
                {(() => { const fi = getFileTypeInfo(p.fileType || ''); return <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-1" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
                {p.isStarred && <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />}
              </div>
            ))}
            {/* Sub-categories */}
            {children.map(ch => renderCategory(ch, depth + 1, nbId))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto select-none">
      {/* ===== Top action bar ===== */}
      <div className="px-2 py-1.5 border-b border-[var(--border-color)] space-y-0.5">
        <div className="flex items-center justify-between px-0.5 mb-0.5">
          <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">资源管理器</span>
          <div className="relative" ref={sortBtnRef}>
            <button onClick={() => setSortOpen(v => !v)} className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="排序方式"><ArrowUpDown size={11} />{sortModes.find(m => m.id === sortMode)?.label}</button>
            {sortOpen && (<div className="absolute right-0 top-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-lg z-40 py-0.5 min-w-[100px]" onMouseDown={e => e.stopPropagation()}>{sortModes.map(m => (<button key={m.id} onClick={() => { setSortMode(m.id); setSortOpen(false) }} className={`w-full text-left px-2 py-1 text-[11px] transition-colors ${sortMode === m.id ? 'text-[var(--accent)] bg-[var(--bg-hover)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>{m.label}</button>))}</div>)}
          </div>
        </div>

        {/* Three create buttons */}
        <div className="flex gap-0.5">
          <button
            onMouseDown={() => { switchingModeRef.current = true }}
            onClick={() => { setCreateParentId(null); setCreateMode('folder'); setNewName(''); switchingModeRef.current = false }}
            className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border-color)]">
            <Folder size={12} />目录
          </button>
          <button
            onMouseDown={() => { switchingModeRef.current = true }}
            onClick={() => { setCreateParentId(null); setCreateMode('notebook'); setNewName(''); switchingModeRef.current = false }}
            className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border-color)]">
            <BookOpen size={12} />笔记本
          </button>
          <button onClick={onCreateLoosePage}
            className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border-color)]">
            <FileText size={11} />页面
          </button>
        </div>

        {/* Inline create input (root-level only) */}
        {createParentId === null && createMode && (
          <input
            className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[12px] outline-none text-[var(--text-primary)] mt-0.5"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={handleCreate}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreateMode(null); setNewName('') } }}
            placeholder={createMode === 'folder' ? '目录名称' : '笔记本名称'}
            autoFocus
          />
        )}

        {/* Import button */}
        <button onClick={onImport}
          className="w-full flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border-color)]">
          <Download size={12} />导入文件
        </button>
      </div>

      {/* ===== Tree ===== */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={e => {
          // Dropped on empty space → move category to root / page to loose
          const d = parseDrop(e)
          if (!d) return
          const onCat = (e.target as HTMLElement).closest('[data-cat-id]')
          const onPage = (e.target as HTMLElement).closest('[data-page-id]')
          if (onCat || onPage) return  // handled by row-level onDrop
          if (d.type === 'category') onMoveCategory(d.id, null)
          else if (d.type === 'page') onDropOnLooseArea(d.id)
        }}
      >
        {rootCats.map(cat => renderCategory(cat, 0))}

        {/* Root-level loose pages */}
        {loosePages.length > 0 && (
          <div
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={e => {
              e.preventDefault()
              const d = parseDrop(e)
              if (d?.type === 'page') onDropOnLooseArea(d.id)
            }}
          >
            {loosePages.map(p => (
              <div key={p.id}
                data-page-id={p.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                  ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                }}
                onDragEnd={e => { ;(e.currentTarget as HTMLElement).style.opacity = '1' }}
                onClick={() => onOpenPage(p.id)}
                onContextMenu={e => {
                  e.preventDefault()
                  setContextMenu({ type: 'page', id: p.id, x: e.clientX, y: e.clientY })
                }}
                className={`flex items-center gap-1.5 py-0.5 cursor-pointer group rounded transition-colors border-l-[3px] ${
                  activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                }`}
                style={{ paddingLeft: '5px', paddingRight: '4px' }}
              >
                <span className="w-3.5 shrink-0" />
                <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
                <span className="flex-1 truncate text-[13px]">{p.title || '无标题'}</span>
                {(() => { const fi = getFileTypeInfo(p.fileType || ''); return <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-1" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
                {p.isStarred && <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />}
              </div>
            ))}
          </div>
        )}

        {rootCats.length === 0 && loosePages.length === 0 && (
          <div className="flex flex-col items-center py-8 px-4 text-center">
            <Folder size={28} className="text-[var(--text-disabled)] mb-2" />
            <p className="text-[11px] text-[var(--text-muted)]">暂无内容</p>
            <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">使用上方按钮创建目录、笔记本或页面</p>
          </div>
        )}
      </div>

      {/* ===== Starred ===== */}
      {starredPages.length > 0 && (
        <div className="border-t border-[var(--border-color)] pt-0.5 pb-0.5 px-2">
          <button onClick={() => setStarredOpen(v => !v)}
            className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded transition-colors text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            <span className="shrink-0 w-3.5 flex items-center justify-center">
              {starredOpen ? <ChevronDown size={13} className="text-[var(--text-muted)]" /> : <ChevronRight size={13} className="text-[var(--text-muted)]" />}
            </span>
            <Star size={13} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />
            <span className="flex-1 text-left">收藏</span>
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">{starredPages.length}</span>
          </button>
          {starredOpen && (
            <div className="ml-5 border-l border-[var(--border-color)]">
              {starredPages.map(p => (
                <div key={p.id} onClick={() => onOpenPage(p.id)}
                  className={`flex items-center gap-1.5 px-1 ml-2 py-0.5 cursor-pointer rounded text-[12px] border-l-[3px] ${activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'}`}>
                  <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />
                  <span className="truncate flex-1">{p.title || '无标题'}</span>
                  {(() => { const fi = getFileTypeInfo(p.fileType || ''); return <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-1" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[60]" onClick={() => setContextMenu(null)}>
          <div
            className="absolute bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-xl py-0.5 min-w-[160px]"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 170),
              top: Math.min(contextMenu.y, window.innerHeight - 120)
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.type === 'category' && (
              <>
                <button
                  onClick={() => {
                    onMoveCategory(contextMenu.id, null)
                    setContextMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
                >
                  <CornerLeftUp size={14} className="text-[var(--text-muted)]" />
                  移到根层级
                </button>
                <button
                  onClick={() => {
                    setMovePickerData({ type: 'category', id: contextMenu.id })
                    setMovePickerOpen(true)
                    setContextMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
                >
                  <FolderInput size={14} className="text-[var(--text-muted)]" />
                  移到目录...
                </button>
              </>
            )}
            {contextMenu.type === 'page' && (
              <>
                <button
                  onClick={() => {
                    onDropOnLooseArea(contextMenu.id)
                    setContextMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
                >
                  <Link2Off size={14} className="text-[var(--text-muted)]" />
                  取消归属
                </button>
                <button
                  onClick={() => {
                    setMovePickerData({ type: 'page', id: contextMenu.id })
                    setMovePickerOpen(true)
                    setContextMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
                >
                  <FolderInput size={14} className="text-[var(--text-muted)]" />
                  移到目录...
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Category move picker modal */}
      {movePickerData && (
        <CategoryMovePicker
          open={movePickerOpen}
          moveType={movePickerData.type}
          moveId={movePickerData.id}
          categories={categories}
          sortCats={sortCats}
          isDescendant={isDescendant}
          canAcceptCategory={canAcceptCategory}
          onMoveCategory={onMoveCategory}
          onMovePageToNotebook={onDropOnNotebook}
          onMovePageToCategory={onDropOnCategory}
          onMovePageToLoose={onDropOnLooseArea}
          onClose={() => { setMovePickerOpen(false); setMovePickerData(null) }}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除"
        message={`确定要删除「${deleteTarget?.name ?? ''}」吗？其下所有子目录和页面将一并移入回收站。`}
        confirmLabel="删除"
        onConfirm={(skipNext) => {
          if (skipNext) { setSkipDeleteConfirm(true); setSetting('skipDeleteConfirm_knowledgeCategory', true) }
          if (deleteTarget) { onDeleteNotebook(deleteTarget.id); setDeleteTarget(null) }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
