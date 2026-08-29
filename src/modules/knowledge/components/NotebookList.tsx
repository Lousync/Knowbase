import { useState, useEffect, useRef } from 'react'
import { Check, FileText, Folder, FolderOpen, BookOpen, BookPlus, Layers, ChevronRight, ChevronDown, ChevronUp, FolderPlus, FilePlus, Pencil, Trash2, Star, Download, FolderInput, Link2Off, Copy, Scissors, ClipboardPaste, FileOutput } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../../types'
import { ConfirmDialog } from '../../../components/shared'
import { DeleteWipe } from '../../../components/shared/DeleteWipe'
import { getSetting, setSetting } from '../../../lib/ipc'
import { FileIcon } from '../../../components/shared/FileIcon'
import { getFileTypeInfo } from '../../../lib/fileTypes'
import { isEditingInput } from '../../../lib/shortcuts'
import { getGlobalActiveTab } from '../../../lib/activeTab'
import { CategoryMovePicker } from './CategoryMovePicker'
import { useContextMenuPosition } from '../../../lib/useContextMenuPosition'

interface Props {
  categories: KnowledgeCategory[]
  allPages: KnowledgePage[]
  loosePages: KnowledgePage[]
  starredPages: KnowledgePage[]
  /** 删除动画状态：'animating' 播放红色吞噬，'done' 不渲染（等待 IPC 完成） */
  deletingMap?: Map<string, 'animating' | 'done'>
  selectedCategoryId: string | null
  focusChapterId: string | null
  activePageId: string | null
  onSelectCategory: (id: string | null) => void
  onSelectCategoryChapter: (notebookId: string, chapterId: string) => void
  /** 传入空间ID时：进入该空间的沉浸视图（只显示空间内内容，不显示其他空间） */
  spaceId?: string | null
  /** 空间列表模式下点击空间时触发（打开空间） */
  onSelectSpace?: (id: string) => void
  onCreateNotebook: (name: string, categoryType: 'folder' | 'notebook' | 'space', parentId: string | null) => void
  onRenameNotebook: (id: string, name: string) => void
  onDeleteNotebook: (id: string) => void
  onOpenPage: (id: string) => void
  onCreatePageNamed: (categoryId: string | null, title: string) => void
  onImport: () => void
  onImportFolder?: () => void
  onDropOnNotebook: (pageId: string, notebookId: string) => void
  onDropOnCategory: (pageId: string, categoryId: string) => void
  onDropOnLooseArea: (pageId: string) => void
  onMoveCategory: (categoryId: string, newParentId: string | null) => void
  onSortCategory?: (id: string, direction: 'up' | 'down') => void
  onSortPage?: (id: string, direction: 'up' | 'down') => void
  onCreateChapterUnderNotebook?: (notebookId: string) => void
  locatePageId?: string | null
  locateCategoryId?: string | null
  onCopy?: (items: { type: 'category' | 'page'; id: string }[]) => void
  onCut?: (items: { type: 'category' | 'page'; id: string }[]) => void
  onPaste?: (targetCategoryId: string | null) => void
  onExportPage?: (pageId: string) => void
  onDeletePage?: (pageId: string) => void
  onRenamePage?: (pageId: string, name: string) => void
  clipboard?: { action: 'copy' | 'cut'; items: { type: 'category' | 'page'; id: string }[] } | null
  cutItemIds?: Set<string>
}

export function NotebookList({
  categories, allPages, loosePages, starredPages,
  selectedCategoryId, focusChapterId, activePageId,
  onSelectCategory, onSelectCategoryChapter, onCreateNotebook, onRenameNotebook, onDeleteNotebook,
  onOpenPage, onCreatePageNamed, onImport, onImportFolder,
  onDropOnNotebook, onDropOnCategory, onDropOnLooseArea, onMoveCategory,
  onSortCategory, onSortPage, onCreateChapterUnderNotebook, locatePageId, locateCategoryId,
  onCopy, onCut, onPaste, onExportPage, onDeletePage, onRenamePage, clipboard, cutItemIds,
  deletingMap,
  spaceId = null, onSelectSpace,
}: Props) {
  const isSpaceView = !!spaceId
  /** 删除动画中（animating 渲染动画 / done 直接隐藏） */
  const deletingState = (id: string) => deletingMap?.get(id)

  // -- sort --
  const sortModes: Array<{ id: string; label: string }> = [
    { id: 'custom', label: '自定义' }, { id: 'type', label: '类型' }, { id: 'name', label: '名称' },
    { id: 'created', label: '创建时间' }, { id: 'updated', label: '更新时间' },
  ]
  const [sortMode, setSortMode] = useState<string>('custom')
  const TYPE_ORDER: Record<string, number> = { space: 0, notebook: 1, folder: 2 }
  function sortCats(list: KnowledgeCategory[]): KnowledgeCategory[] {
    return [...list].sort((a, b) => {
      if (sortMode === 'type') { const ta = TYPE_ORDER[a.categoryType] ?? 2; const tb = TYPE_ORDER[b.categoryType] ?? 2; if (ta !== tb) return ta - tb; return a.sortOrder - b.sortOrder }
      if (sortMode === 'name') return a.name.localeCompare(b.name)
      if (sortMode === 'created') return b.createdAt.localeCompare(a.createdAt)
      if (sortMode === 'updated') return b.updatedAt.localeCompare(a.updatedAt)
      return a.sortOrder - b.sortOrder
    })
  }
  // 空间沉浸视图下 root = 空间内的子项；空间列表视图下 root = 所有空间（done 的删除条目不渲染）
  const rootCats = sortCats(isSpaceView
    ? categories.filter(c => c.parentId === spaceId)
    : categories.filter(c => !c.parentId))
  const [newName, setNewName] = useState('')
  const [createMode, setCreateMode] = useState<'folder' | 'notebook' | 'space' | null>(null)
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  // 新建页面：先命名再创建（null=根级零散，'id'=目录/章节/空间下）
  const [pageCreateParent, setPageCreateParent] = useState<{ id: string | null } | null>(null)
  const [newPageName, setNewPageName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [editPageName, setEditPageName] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [starredOpen, setStarredOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ type: 'category' | 'page' | 'blank'; id: string; x: number; y: number } | null>(null)
  const { menuRef: contextMenuRef, style: contextMenuStyle } = useContextMenuPosition(contextMenu)
  const [movePickerOpen, setMovePickerOpen] = useState(false)
  const [movePickerData, setMovePickerData] = useState<{ type: 'category' | 'page'; id: string } | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)  // visual feedback during drag

  // Barrier ref: set on mousedown of create-mode buttons so that the ensuing
  // blur of the current input (which fires before click) aborts without creating.
  const switchingModeRef = useRef(false)

  // Drag ref: store drag data so dragOver can read it without relying on getData()
  // (Chromium security may block getData() during dragover events)
  const dragRef = useRef<{ type: 'category' | 'page'; id: string } | null>(null)

  // Direct DOM refs to avoid React re-renders during drag (which can kill the operation)
  const treeRef = useRef<HTMLDivElement>(null)
  const dragOverTargetRef = useRef<string | null>(null)  // current drag-over target (id-based)
  const prevHighlightRef = useRef<Element | null>(null)  // previously highlighted element

  // Inject drag highlight CSS (DOM-based, avoids React re-render during drag)
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .drag-over-highlight {
        background-color: rgba(0,122,204,0.15) !important;
        border-radius: 4px !important;
      }
      .drag-over-loose {
        background-color: rgba(0,122,204,0.10) !important;
        outline: 2px dashed var(--accent) !important;
        outline-offset: -2px !important;
        border-radius: 4px !important;
      }
    `
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  // When createMode changes, clear any previously-typed name to prevent
  // onBlur of the old input from creating a category with the wrong type.
  useEffect(() => { setNewName('') }, [createMode])

  const handleCommitNewPage = () => {
    const name = newPageName.trim()
    const parent = pageCreateParent?.id ?? null
    setPageCreateParent(null); setNewPageName('')
    if (name) onCreatePageNamed(parent, name)
  }
  const cancelNewPage = () => { setPageCreateParent(null); setNewPageName('') }

  // Ctrl+N：打开根级/当前空间的新建页面命名输入框
  useEffect(() => {
    const onStart = () => {
      setPageCreateParent({ id: isSpaceView && spaceId ? spaceId : null })
      setNewPageName('')
    }
    window.addEventListener('knowledge:start-create-page', onStart)
    return () => window.removeEventListener('knowledge:start-create-page', onStart)
  }, [isSpaceView, spaceId])

  /** 新建页面内联输入框 */
  const renderNewPageInput = (placeholderLabel: string, indentPx?: number) => (
    <div style={indentPx !== undefined ? { paddingLeft: `${indentPx}px`, paddingRight: '4px' } : { paddingLeft: '4px', paddingRight: '4px' }}>
      <input
        className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[12px] outline-none text-[var(--text-primary)] mt-0.5"
        value={newPageName}
        onChange={e => setNewPageName(e.target.value)}
        onBlur={handleCommitNewPage}
        onKeyDown={e => {
          if (e.key === 'Enter') handleCommitNewPage()
          if (e.key === 'Escape') cancelNewPage()
        }}
        placeholder={`${placeholderLabel} > 页面名称（Enter 确认）`}
        autoFocus
      />
    </div>
  )

  // Load skip-delete setting
  useEffect(() => {
    getSetting('skipDeleteConfirm_knowledgeCategory').then(v => {
      if (v === true) setSkipDeleteConfirm(true)
    })
  }, [])

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

  // Auto-expand ancestors and scroll to locateCategoryId
  useEffect(() => {
    if (!locateCategoryId) return
    const cat = categories.find(c => c.id === locateCategoryId)
    if (!cat) return
    // Collect ancestors
    const ancestors: string[] = []
    let currentId: string | null = cat.parentId
    const seen = new Set<string>()
    while (currentId) {
      if (seen.has(currentId)) break; seen.add(currentId)
      ancestors.push(currentId)
      const parent = categories.find(c => c.id === currentId)
      currentId = parent?.parentId ?? null
    }
    if (ancestors.length === 0) {
      // Root-level category — just scroll to it
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-cat-id="${locateCategoryId}"]`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
      })
      return
    }
    setExpanded(prev => { const next = new Set(prev); ancestors.forEach(id => next.add(id)); return next })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-cat-id="${locateCategoryId}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    })
  }, [locateCategoryId])

  // F2 — keyboard rename selected notebook / folder
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getGlobalActiveTab() !== 'knowledge') return
      if (isEditingInput(e)) return
      if (e.key === 'F2') {
        e.preventDefault()
        if (activePageId) {
          const pg = allPages.find(p => p.id === activePageId)
          handleStartRenamePage(activePageId, pg?.title || '')
        } else if (selectedCategoryId) {
          const cat = categories.find(c => c.id === selectedCategoryId)
          if (cat) handleStartRename(cat.id, cat.name)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedCategoryId, categories, activePageId, allPages])

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function handleCreate() {
    if (switchingModeRef.current) { setNewName(''); return }
    if (!newName.trim()) { setNewName(''); setCreateMode(null); setCreateParentId(null); return }
    onCreateNotebook(
      newName.trim(),
      createMode === 'notebook' ? 'notebook' : createMode === 'space' ? 'space' : 'folder',
      createParentId
    )
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

  function handleStartRenamePage(id: string, name: string) { setEditingPageId(id); setEditPageName(name) }
  function handleRenamePage(id: string) {
    if (!editPageName.trim()) { setEditingPageId(null); return }
    onRenamePage?.(id, editPageName.trim()); setEditingPageId(null)
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
  // Chapters (folders under notebooks) do NOT accept category drops — categories can only
  // drop into notebooks directly, which auto-creates or uses existing chapters.
  function canAcceptCategory(targetId: string, draggedId: string): boolean {
    const target = categories.find(c => c.id === targetId)
    const dragged = categories.find(c => c.id === draggedId)
    if (!target || !dragged) return false
    if (dragged.categoryType === 'space') return false
    if (target.categoryType === 'space') {
      return true  // dragged is guaranteed not a space here
    }
    // Reject: chapters (folders under notebooks) cannot accept category drops
    if (target.categoryType === 'folder') {
      const parent = categories.find(c => c.id === target.parentId)
      if (parent?.categoryType === 'notebook') return false  // this is a chapter
      return true  // standalone folder
    }
    if (target.categoryType === 'notebook') {
      if (dragged.categoryType !== 'folder') return false
      return !categories.some(c => c.parentId === draggedId)
    }
    return false
  }

  function canAcceptPage(targetId: string): boolean {
    const target = categories.find(c => c.id === targetId)
    // Pages can live directly under a space (散页), folder/chapter, or via
    // auto-created default chapter when dropped on a notebook.
    return !!target
  }

  // ---- parse drop data (same format as ActivityBar) ----
  function parseDrop(e: React.DragEvent): { type: 'category' | 'page'; id: string } | null {
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return null
    try { const v = JSON.parse(raw); if ((v.type === 'category' || v.type === 'page') && typeof v.id === 'string') return v } catch {}
    return null
  }

  // ---- DOM-based drag highlight (avoids React re-render during drag) ----
  function clearDragHighlight() {
    if (prevHighlightRef.current) {
      prevHighlightRef.current.classList.remove('drag-over-highlight', 'drag-over-loose')
      prevHighlightRef.current = null
    }
    dragOverTargetRef.current = null
  }

  function applyDragHighlight(el: Element) {
    if (prevHighlightRef.current === el) return  // already highlighted
    clearDragHighlight()
    el.classList.add('drag-over-highlight')
    prevHighlightRef.current = el
    dragOverTargetRef.current = (el as HTMLElement).dataset.catId || (el as HTMLElement).dataset.pageId || null
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
    const isSpace = cat.categoryType === 'space'
    const isChapter = cat.categoryType === 'folder' && categories.find(c => c.id === cat.parentId)?.categoryType === 'notebook'
    // Show expand arrow for folders that have sub-categories OR pages directly
    // Chapters under notebooks never expand — they toggle the sidebar instead
    // Spaces never expand inline — clicking opens the space immersive view
    const canExpand = isSpace ? false : notebookAncestorId ? false : (isNotebook ? hasChildren : (hasChildren || hasPages))
    // Pass notebook ancestor to children
    const nbId = isNotebook ? cat.id : notebookAncestorId

    // Row click: space opens immersive view; notebook opens chapter sidebar,
    // chapter under notebook opens focus view, folder toggles expand
    const handleRowClick = () => {
      if (isSpace) {
        onSelectSpace?.(cat.id)
      } else if (isNotebook) {
        onSelectCategory(cat.id)
      } else if (notebookAncestorId) {
        onSelectCategoryChapter(notebookAncestorId, cat.id)
      } else {
        // Standalone folder — toggle expand/collapse, like clicking the chevron
        if (canExpand) toggleExpand(cat.id)
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
          draggable={!isSpace}
          onDragStart={e => {
            if (isSpace) {
              e.preventDefault()
              return
            }
            console.log('[NB dragStart] category:', cat.name, cat.id)
            e.dataTransfer.effectAllowed = 'move'
            const payload = JSON.stringify({ type: 'category', id: cat.id })
            e.dataTransfer.setData('text/plain', payload)
            dragRef.current = { type: 'category', id: cat.id }
            console.log('[NB dragStart] dragRef set:', dragRef.current)
            ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
          }}
          onDragEnd={e => {
            console.log('[NB dragEnd] category:', cat.name, cat.id)
            ;(e.currentTarget as HTMLElement).style.opacity = '1'
            dragRef.current = null
            clearDragHighlight()
          }}
          onContextMenu={e => {
            e.preventDefault(); e.stopPropagation()
            setContextMenu({ type: 'category', id: cat.id, x: e.clientX, y: e.clientY })
          }}
        >
          {editingId === cat.id ? (
            <input
              className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-[var(--kb-row-py-lg)] text-[var(--kb-row-fs)] outline-none text-[var(--text-primary)]"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={() => handleRename(cat.id)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(cat.id); if (e.key === 'Escape') setEditingId(null) }}
              autoFocus
            />
          ) : (
            <div
              onClick={handleRowClick}
              className={`flex items-center gap-1.5 py-[var(--kb-row-py)] cursor-pointer group rounded transition-colors ${
                deletingState(cat.id) === 'animating' ? 'kb-deleting'
                  : deletingState(cat.id) === 'done' ? 'kb-deleting kb-done'
                : isSelected ? 'bg-[var(--bg-selected)] text-white'
                : dragOverId === cat.id ? 'bg-[var(--accent)]/10 outline outline-2 outline-[var(--accent)] outline-offset-[-2px]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              style={{
                paddingLeft: `${depth * 16 + 8}px`, paddingRight: '4px',
                ...(cutItemIds?.has(cat.id) ? { opacity: 0.45 } : {})
              }}
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
              {isSpace ? (
                <Layers size={15} className={`shrink-0 ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--info)]'}`} />
              ) : isNotebook ? (
                <BookOpen size={15} className={`shrink-0 ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
              ) : canExpand ? (
                isExpanded ? <FolderOpen size={15} className="shrink-0 text-[var(--warning)]" /> : <Folder size={15} className="shrink-0 text-[var(--warning)]" />
              ) : (
                <Folder size={15} className="shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="flex-1 truncate text-[var(--kb-row-fs)]">{cat.name}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                {onSortCategory && (<><button onClick={e => { e.stopPropagation(); onSortCategory(cat.id, 'up') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="上移"><ChevronUp size={13} /></button><button onClick={e => { e.stopPropagation(); onSortCategory(cat.id, 'down') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="下移"><ChevronDown size={13} /></button></>)}
                {isNotebook ? (
                  onCreateChapterUnderNotebook && <button onClick={e => { e.stopPropagation(); onCreateChapterUnderNotebook(cat.id) }} className="p-0.5 hover:text-[var(--warning)] text-[var(--text-secondary)]" title="新建章节"><FolderPlus size={13} /></button>
                ) : isChapter ? (
                  <button onClick={e => { e.stopPropagation(); setPageCreateParent({ id: cat.id }); setNewPageName('') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-secondary)]" title="在此目录下新建页面"><FilePlus size={13} /></button>
                ) : !isSpace ? (
                  <>
                    <button onClick={e => { e.stopPropagation(); setPageCreateParent({ id: cat.id }); setNewPageName('') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-secondary)]" title="在此目录下新建页面"><FilePlus size={13} /></button>
                    <button onClick={e => { e.stopPropagation(); setCreateParentId(cat.id); setCreateMode('folder'); setNewName('') }} className="p-0.5 hover:text-[var(--warning)] text-[var(--text-secondary)]" title="新建子目录"><FolderPlus size={13} /></button>
                    <button onClick={e => { e.stopPropagation(); setCreateParentId(cat.id); setCreateMode('notebook'); setNewName('') }} className="p-0.5 hover:text-[var(--info)] text-[var(--text-secondary)]" title="新建笔记本"><BookPlus size={13} /></button>
                  </>
                ) : null}
                <button onClick={e => { e.stopPropagation(); handleStartRename(cat.id, cat.name) }} className="p-0.5 hover:text-white text-[var(--text-secondary)]" title="重命名"><Pencil size={13} /></button>
                <button onClick={e => { e.stopPropagation(); if (skipDeleteConfirm) onDeleteNotebook(cat.id); else setDeleteTarget({ id: cat.id, name: cat.name }) }} className="p-0.5 hover:text-[var(--danger)] text-[var(--text-secondary)]" title="删除"><Trash2 size={13} /></button>
              </div>
              {deletingState(cat.id) === 'animating' && <DeleteWipe />}
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
              placeholder={`${cat.name} > ${createMode === 'notebook' ? '笔记本名称' : createMode === 'space' ? '空间名称' : '子目录名称'}`}
              autoFocus
            />
          </div>
        )}
        {/* Per-node inline input for new page under this category */}
        {pageCreateParent?.id === cat.id && renderNewPageInput(cat.name, (depth + 1) * 16 + 8)}
        {isExpanded && canExpand && (
          <div>
            {/* Pages directly under this category */}
            {categoryPages.map(p => (
              <div key={p.id}
                data-page-id={p.id}
                draggable
                onDragStart={e => {
                  console.log('[NB page dragStart] page:', p.title, p.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                  dragRef.current = { type: 'page', id: p.id }
                  ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                }}
                onDragEnd={e => {
                  ;(e.currentTarget as HTMLElement).style.opacity = '1'
                  dragRef.current = null
                  clearDragHighlight()
                }}
                onClick={() => onOpenPage(p.id)}
                onContextMenu={e => {
                  e.preventDefault(); e.stopPropagation()
                  setContextMenu({ type: 'page', id: p.id, x: e.clientX, y: e.clientY })
                }}
                className={`flex items-center gap-1.5 py-[var(--kb-row-py)] cursor-pointer group rounded transition-colors border-l-[3px] ${
                  deletingState(p.id) === 'animating' ? 'kb-deleting border-l-transparent'
                  : deletingState(p.id) === 'done' ? 'kb-deleting kb-done'
                  : activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                }`}
                style={{
                  paddingLeft: `${(depth + 1) * 16 + 8}px`, paddingRight: '4px',
                  ...(cutItemIds?.has(p.id) ? { opacity: 0.45 } : {})
                }}
              >
                <span className="w-3.5 shrink-0" />
                <FileIcon ext={p.fileType || ''} size={14} />
                {editingPageId === p.id ? (
                  <input
                    className="flex-1 min-w-0 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-[var(--kb-row-py)] text-[var(--kb-row-fs)] outline-none text-[var(--text-primary)]"
                    value={editPageName}
                    onChange={e => setEditPageName(e.target.value)}
                    onBlur={() => handleRenamePage(p.id)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenamePage(p.id); if (e.key === 'Escape') setEditingPageId(null) }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 truncate text-[var(--kb-row-fs)]">{p.title || '无标题'}</span>
                )}
                {onSortPage && <div className="hidden group-hover:flex items-center gap-0.5 shrink-0"><button onClick={e => { e.stopPropagation(); onSortPage(p.id, 'up') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="上移"><ChevronUp size={11} /></button><button onClick={e => { e.stopPropagation(); onSortPage(p.id, 'down') }} className="p-0.5 hover:text-[var(--accent)] text-[var(--text-muted)]" title="下移"><ChevronDown size={11} /></button></div>}
                {(() => { const fi = getFileTypeInfo(p.fileType || ''); return <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-1" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
                {p.isStarred && <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />}
                {deletingState(p.id) === 'animating' && <DeleteWipe />}
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
      {/* Inline create input (root / space-level) — shown when creating via context menu */}
      {createMode && (isSpaceView ? createParentId === spaceId : createParentId === null) && (
        <div className="px-2 py-1.5 border-b border-[var(--border-color)] shrink-0">
          <input
            className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[12px] outline-none text-[var(--text-primary)]"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={handleCreate}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreateMode(null); setCreateParentId(null); setNewName('') } }}
            placeholder={createMode === 'folder' ? '目录名称' : createMode === 'space' ? '空间名称' : '笔记本名称'}
            autoFocus
          />
        </div>
      )}

      {/* ===== Tree ===== */}
      <div
        ref={treeRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onContextMenu={e => {
          const target = e.target as HTMLElement
          // Rows have their own context menu with stopPropagation — we only get here for blank space
          // Walk up to find the nearest ancestor category for context
          let contextCatId: string | null = null
          const treeEl = treeRef.current
          if (treeEl) {
            let el: HTMLElement | null = target
            while (el && el !== treeEl) {
              const catEl = el.closest('[data-cat-id]') as HTMLElement | null
              if (catEl) { contextCatId = catEl.dataset.catId!; break }
              el = el.parentElement
            }
          }
          e.preventDefault()
          setContextMenu({ type: 'blank', id: contextCatId || '', x: e.clientX, y: e.clientY })
        }}
        onDragOver={e => {
          const d = dragRef.current
          if (!d) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'

          const targetCat = (e.target as HTMLElement).closest('[data-cat-id]') as HTMLElement | null
          const targetPage = (e.target as HTMLElement).closest('[data-page-id]') as HTMLElement | null

          // Use direct DOM manipulation for highlight — NO React state update during drag
          if (targetCat) {
            const catId = targetCat.dataset.catId!
            if (d.type === 'category') {
              const valid = d.id !== catId && !isDescendant(d.id, catId) && canAcceptCategory(catId, d.id)
              if (valid) {
                applyDragHighlight(targetCat)
              } else {
                clearDragHighlight()
              }
            } else {
              if (canAcceptPage(catId)) {
                applyDragHighlight(targetCat)
              } else {
                clearDragHighlight()
              }
            }
          } else if (targetPage && d.type === 'page') {
            applyDragHighlight(targetPage)
          } else if (!targetCat && d.type === 'page') {
            // highlight the loose pages container
            const looseEl = treeRef.current?.querySelector('[data-loose-area]') as HTMLElement | null
            if (looseEl) { clearDragHighlight(); looseEl.classList.add('drag-over-loose'); prevHighlightRef.current = looseEl; dragOverTargetRef.current = '__loose' }
          } else {
            clearDragHighlight()
          }
        }}
        onDragLeave={e => {
          // Only clear when leaving the tree container entirely
          if (!treeRef.current?.contains(e.relatedTarget as Node)) {
            clearDragHighlight()
          }
        }}
        onDrop={e => {
          console.log('[NB drop] FIRED. dragRef=', dragRef.current, 'dragOverTargetRef=', dragOverTargetRef.current)
          e.preventDefault()
          const dragged = dragRef.current
          const targetId = dragOverTargetRef.current
          dragRef.current = null
          clearDragHighlight()

          const d = dragged || parseDrop(e)
          console.log('[NB drop] d=', d, 'targetId=', targetId)
          if (!d) return

          if (targetId && targetId !== '__loose') {
            // Determine if targetId is a category or page
            const targetCat = categories.find(c => c.id === targetId)
            if (targetCat) {
              if (d.type === 'category' && d.id !== targetId && !isDescendant(d.id, targetId) && canAcceptCategory(targetId, d.id)) {
                console.log('[NB drop] → onMoveCategory:', d.id, '→', targetId)
                setExpanded(prev => new Set(prev).add(targetId))
                onMoveCategory(d.id, targetId)
              } else if (d.type === 'page' && canAcceptPage(targetId)) {
                const c = categories.find(x => x.id === targetId)
                setExpanded(prev => new Set(prev).add(targetId))
                if (c?.categoryType === 'notebook') onDropOnNotebook(d.id, targetId)
                else onDropOnCategory(d.id, targetId)
              }
              return
            }
            // If targetId is a page, handle page-to-page reorder (within NotebookList)
            if (d.type === 'page' && targetId !== d.id) {
              // page-to-page — handled below if needed, or just ignore (reorder happens in ChapterPanel)
              return
            }
          }

          // Empty space / loose area
          if (targetId === '__loose' || !targetId) {
            const looseEl = treeRef.current?.querySelector('[data-loose-area]') as HTMLElement | null
            if (looseEl) looseEl.classList.remove('drag-over-loose')
            if (d.type === 'page') {
              // 空间沉浸视图下空白处拖入 = 放入该空间；否则为全局零散
              if (isSpaceView && spaceId) onDropOnCategory(d.id, spaceId)
              else onDropOnLooseArea(d.id)
            }
          } else if (d.type === 'page') {
            onDropOnLooseArea(d.id)
          }
        }}
      >
        {rootCats.map(cat => renderCategory(cat, 0))}

        {/* 根级新建页面输入（零散文件） */}
        {!isSpaceView && pageCreateParent?.id === null && renderNewPageInput('零散页面')}

        {/* Space view: the space's direct pages (loose within the space) */}
        {isSpaceView && spaceId && (() => {
          const spacePages = allPages.filter(p => p.categoryId === spaceId)
          if (spacePages.length === 0 && pageCreateParent?.id !== spaceId) return null
          return (
            <div
              data-loose-area="true"
              className="mx-1 rounded transition-colors"
            >
              {spacePages.map(p => (
                <div key={p.id}
                  data-page-id={p.id}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                    dragRef.current = { type: 'page', id: p.id }
                    ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                  }}
                  onDragEnd={e => { ;(e.currentTarget as HTMLElement).style.opacity = '1'; dragRef.current = null }}
                  onClick={() => onOpenPage(p.id)}
                  onContextMenu={e => {
                    e.preventDefault(); e.stopPropagation()
                    setContextMenu({ type: 'page', id: p.id, x: e.clientX, y: e.clientY })
                  }}
                  className={`flex items-center gap-1.5 py-[var(--kb-row-py)] cursor-pointer group rounded transition-colors border-l-[3px] ${
                    deletingState(p.id) === 'animating' ? 'kb-deleting border-l-transparent'
                  : deletingState(p.id) === 'done' ? 'kb-deleting kb-done'
                    : activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                  }`}
                  style={{
                    paddingLeft: '5px', paddingRight: '4px',
                    ...(cutItemIds?.has(p.id) ? { opacity: 0.45 } : {})
                  }}
                >
                  <span className="w-3.5 shrink-0" />
                  <FileIcon ext={p.fileType || ''} size={14} />
                  {editingPageId === p.id ? (
                    <input
                      className="flex-1 min-w-0 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-[var(--kb-row-py)] text-[var(--kb-row-fs)] outline-none text-[var(--text-primary)]"
                      value={editPageName}
                      onChange={e => setEditPageName(e.target.value)}
                      onBlur={() => handleRenamePage(p.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenamePage(p.id); if (e.key === 'Escape') setEditingPageId(null) }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 truncate text-[var(--kb-row-fs)]">{p.title || '无标题'}</span>
                  )}
                  {(() => { const fi = getFileTypeInfo(p.fileType || ''); return <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-1" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
                  {p.isStarred && <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />}
                  {deletingState(p.id) === 'animating' && <DeleteWipe />}
                </div>
              ))}
              {pageCreateParent?.id === spaceId && renderNewPageInput('空间直属页面', 8)}
            </div>
          )
        })()}

        {/* Root-level loose pages */}
        {!isSpaceView && loosePages.length > 0 && (
          <div
            data-loose-area="true"
            className="mx-1 rounded transition-colors"
          >
            {loosePages.map(p => (
              <div key={p.id}
                data-page-id={p.id}
                draggable
                onDragStart={e => {
                  console.log('[NB page dragStart] page:', p.title, p.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                  dragRef.current = { type: 'page', id: p.id }
                  ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                }}
                onDragEnd={e => { ;(e.currentTarget as HTMLElement).style.opacity = '1'; dragRef.current = null }}
                onClick={() => onOpenPage(p.id)}
                onContextMenu={e => {
                  e.preventDefault(); e.stopPropagation()
                  setContextMenu({ type: 'page', id: p.id, x: e.clientX, y: e.clientY })
                }}
                className={`flex items-center gap-1.5 py-[var(--kb-row-py)] cursor-pointer group rounded transition-colors border-l-[3px] ${
                  deletingState(p.id) === 'animating' ? 'kb-deleting border-l-transparent'
                  : deletingState(p.id) === 'done' ? 'kb-deleting kb-done'
                  : activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                }`}
                style={{
                  paddingLeft: '5px', paddingRight: '4px',
                  ...(cutItemIds?.has(p.id) ? { opacity: 0.45 } : {})
                }}
              >
                <span className="w-3.5 shrink-0" />
                <FileIcon ext={p.fileType || ''} size={14} />
                {editingPageId === p.id ? (
                  <input
                    className="flex-1 min-w-0 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-[var(--kb-row-py)] text-[var(--kb-row-fs)] outline-none text-[var(--text-primary)]"
                    value={editPageName}
                    onChange={e => setEditPageName(e.target.value)}
                    onBlur={() => handleRenamePage(p.id)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenamePage(p.id); if (e.key === 'Escape') setEditingPageId(null) }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 truncate text-[var(--kb-row-fs)]">{p.title || '无标题'}</span>
                )}
                {(() => { const fi = getFileTypeInfo(p.fileType || ''); return <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-1" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
                {p.isStarred && <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />}
                {deletingState(p.id) === 'animating' && <DeleteWipe />}
              </div>
            ))}
          </div>
        )}

        {rootCats.length === 0 && (isSpaceView ? !spaceId || allPages.filter(p => p.categoryId === spaceId).length === 0 : loosePages.length === 0) && (
          <div className="flex flex-col items-center py-8 px-4 text-center">
            <Folder size={28} className="text-[var(--text-disabled)] mb-2" />
            <p className="text-[11px] text-[var(--text-muted)]">暂无内容</p>
            <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">右键空白处创建目录、笔记本或页面</p>
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
                  onContextMenu={e => {
                    e.preventDefault(); e.stopPropagation()
                    setContextMenu({ type: 'page', id: p.id, x: e.clientX, y: e.clientY })
                  }}
                  className={`flex items-center gap-1.5 px-1 ml-2 py-[var(--kb-row-py)] cursor-pointer rounded text-[var(--kb-row-fs)] border-l-[3px] ${
                    deletingState(p.id) === 'animating' ? 'kb-deleting border-l-transparent'
                  : deletingState(p.id) === 'done' ? 'kb-deleting kb-done'
                    : activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                  }`}>
                  <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />
                  {editingPageId === p.id ? (
                    <input
                      className="flex-1 min-w-0 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1 py-[var(--kb-row-py)] text-[var(--kb-row-fs)] outline-none text-[var(--text-primary)]"
                      value={editPageName}
                      onChange={e => setEditPageName(e.target.value)}
                      onBlur={() => handleRenamePage(p.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenamePage(p.id); if (e.key === 'Escape') setEditingPageId(null) }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="truncate flex-1">{p.title || '无标题'}</span>
                  )}
                  {(() => { const fi = getFileTypeInfo(p.fileType || ''); return <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-1" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
                  {deletingState(p.id) === 'animating' && <DeleteWipe />}
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
            className="absolute bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-xl py-0.5 min-w-[170px]"
            ref={contextMenuRef}
            style={contextMenuStyle}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.type === 'category' && (
              <>
                {onCopy && (
                  <button onClick={() => { onCopy([{ type: 'category', id: contextMenu.id }]); setContextMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                    <Copy size={14} className="text-[var(--text-muted)]" />复制
                  </button>
                )}
                {onCut && (
                  <button onClick={() => { onCut([{ type: 'category', id: contextMenu.id }]); setContextMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                    <Scissors size={14} className="text-[var(--text-muted)]" />剪切
                  </button>
                )}
                {onPaste && (
                  <>
                    <div className="border-t border-[var(--border-color)] my-0.5" />
                    <button
                      onClick={() => { if (clipboard && clipboard.items.length > 0) { onPaste(contextMenu.id); setContextMenu(null) } }}
                      disabled={!clipboard || clipboard.items.length === 0}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${
                        clipboard && clipboard.items.length > 0
                          ? 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                          : 'text-[var(--text-disabled)] cursor-not-allowed'
                      }`}>
                      <ClipboardPaste size={14} className={clipboard && clipboard.items.length > 0 ? 'text-[var(--text-muted)]' : 'text-[var(--text-disabled)]'} />粘贴{clipboard && clipboard.items.length > 1 ? ` (${clipboard.items.length})` : ''}
                    </button>
                  </>
                )}
                <div className="border-t border-[var(--border-color)] my-0.5" />
                <button onClick={() => {
                  const cat = categories.find(c => c.id === contextMenu.id)
                  if (cat) { handleStartRename(cat.id, cat.name); setContextMenu(null) }
                }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                  <Pencil size={14} className="text-[var(--text-muted)]" />重命名
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
                <div className="border-t border-[var(--border-color)] my-0.5" />
                <button onClick={() => {
                  const cat = categories.find(c => c.id === contextMenu.id)
                  if (cat) {
                    if (skipDeleteConfirm) onDeleteNotebook(cat.id)
                    else setDeleteTarget({ id: cat.id, name: cat.name })
                  }
                  setContextMenu(null)
                }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors text-left">
                  <Trash2 size={14} />删除
                </button>
              </>
            )}
            {contextMenu.type === 'page' && (
              <>
                {onCopy && (
                  <button onClick={() => { onCopy([{ type: 'page', id: contextMenu.id }]); setContextMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                    <Copy size={14} className="text-[var(--text-muted)]" />复制
                  </button>
                )}
                {onCut && (
                  <button onClick={() => { onCut([{ type: 'page', id: contextMenu.id }]); setContextMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                    <Scissors size={14} className="text-[var(--text-muted)]" />剪切
                  </button>
                )}
                {onExportPage && (
                  <>
                    <div className="border-t border-[var(--border-color)] my-0.5" />
                    <button onClick={() => { onExportPage(contextMenu.id); setContextMenu(null) }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                      <FileOutput size={14} className="text-[var(--text-muted)]" />导出文件...
                    </button>
                  </>
                )}
                <div className="border-t border-[var(--border-color)] my-0.5" />
                <button onClick={() => { const pg = allPages.find(x => x.id === contextMenu.id); handleStartRenamePage(contextMenu.id, pg?.title || ''); setContextMenu(null) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                  <Pencil size={14} className="text-[var(--text-muted)]" />重命名
                </button>
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
                <div className="border-t border-[var(--border-color)] my-0.5" />
                {onDeletePage && (
                  <button onClick={() => { onDeletePage(contextMenu.id); setContextMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors text-left">
                    <Trash2 size={14} />删除
                  </button>
                )}
              </>
            )}
            {contextMenu.type === 'blank' && (
              <>
                {/* Context info */}
                {(() => {
                  const ctxCat = contextMenu.id ? categories.find(c => c.id === contextMenu.id) : null
                  const isRoot = !ctxCat
                  const isSpace = ctxCat?.categoryType === 'space'
                  const isNotebook = ctxCat?.categoryType === 'notebook'
                  const isChapter = ctxCat?.categoryType === 'folder' && categories.find(c => c.id === ctxCat.parentId)?.categoryType === 'notebook'
                  const insideNotebook = isNotebook || isChapter
                  const canCreatePage = isRoot || (!!ctxCat && !isNotebook)
                  // 空间沉浸视图下空白处右键：创建目录/笔记本的落点就是当前空间
                  const canCreateFolder = isSpace || (isRoot && isSpaceView) || (!!ctxCat && !insideNotebook && !isSpace)
                  const canCreateNotebook = isSpace || (isRoot && isSpaceView) || (!!ctxCat && !insideNotebook && !isSpace)
                  // 空间沉浸视图下：不在“根”层级，不能新建空间；空白处创建的目标是该空间
                  const canCreateSpace = isRoot && !isSpaceView

                  const btn = (disabled: boolean) =>
                    disabled ? 'text-[var(--text-disabled)] cursor-not-allowed' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  const iconCls = (disabled: boolean) => disabled ? 'text-[var(--text-disabled)]' : 'text-[var(--text-muted)]'

                  const handleCreatePage = () => {
                    if (isRoot) {
                      setContextMenu(null)
                      setPageCreateParent({ id: isSpaceView && spaceId ? spaceId : null }); setNewPageName('')
                    } else if (ctxCat && !isNotebook) {
                      setContextMenu(null); setPageCreateParent({ id: ctxCat.id }); setNewPageName('')
                    }
                  }
                  const handleCreateFolder = () => {
                    if (isSpace || (isRoot && isSpaceView) || (ctxCat && !insideNotebook && !isSpace)) {
                      setContextMenu(null)
                      setCreateParentId(ctxCat?.id ?? (isSpaceView ? spaceId : null))
                      setCreateMode('folder')
                      setNewName('')
                    } else if (isNotebook && ctxCat) {
                      // Create chapter under notebook
                      setContextMenu(null)
                      const notebookId = ctxCat.id
                      if (notebookId && onCreateChapterUnderNotebook) {
                        onCreateChapterUnderNotebook(notebookId)
                      }
                    }
                  }
                  const handleCreateNotebook = () => {
                    if (!canCreateNotebook) return
                    setContextMenu(null)
                    setCreateParentId(ctxCat?.id ?? (isSpaceView ? spaceId : null))
                    setCreateMode('notebook')
                    setNewName('')
                  }
                  const handleCreateSpace = () => {
                    setContextMenu(null)
                    setCreateParentId(null)
                    setCreateMode('space')
                    setNewName('')
                  }

                  return (
                    <>
                      <button onClick={handleCreatePage} disabled={!canCreatePage}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${btn(!canCreatePage)}`}>
                        <FileText size={14} className={iconCls(!canCreatePage)} />新建页面
                      </button>
                      {canCreateSpace && (
                        <button onClick={handleCreateSpace}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${btn(false)}`}>
                          <Layers size={14} className={iconCls(false)} />新建空间
                        </button>
                      )}
                      {(canCreateFolder || isNotebook) && (
                        <button onClick={handleCreateFolder}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${btn(false)}`}>
                          <Folder size={14} className={iconCls(false)} />新建{isNotebook ? '章节' : '目录'}
                        </button>
                      )}
                      {canCreateNotebook && (
                        <button onClick={handleCreateNotebook}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${btn(false)}`}>
                          <BookOpen size={14} className={iconCls(false)} />新建笔记本
                        </button>
                      )}
                      <div className="border-t border-[var(--border-color)] my-0.5" />
                    </>
                  )
                })()}
                {onPaste && (
                  <button
                    onClick={() => {
                      if (clipboard && clipboard.items.length > 0) {
                        onPaste(contextMenu.id || (isSpaceView ? spaceId ?? null : null))
                        setContextMenu(null)
                      }
                    }}
                    disabled={!clipboard || clipboard.items.length === 0}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${
                      clipboard && clipboard.items.length > 0
                        ? 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        : 'text-[var(--text-disabled)] cursor-not-allowed'
                    }`}>
                    <ClipboardPaste size={14} className={clipboard && clipboard.items.length > 0 ? 'text-[var(--text-muted)]' : 'text-[var(--text-disabled)]'} />粘贴{clipboard && clipboard.items.length > 1 ? ` (${clipboard.items.length})` : ''}
                  </button>
                )}
                <div className="border-t border-[var(--border-color)] my-0.5" />
                <button onClick={() => { setContextMenu(null); onImport() }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                  <Download size={14} className="text-[var(--text-muted)]" />导入文件...
                </button>
                {onImportFolder && (
                  <button onClick={() => { setContextMenu(null); onImportFolder() }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                    <Folder size={14} className="text-[var(--text-muted)]" />导入文件夹...
                  </button>
                )}
                <div className="border-t border-[var(--border-color)] my-0.5" />
                <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-3 py-1.5">排序方式</div>
                {sortModes.map(m => (
                  <button key={m.id} onClick={() => { setSortMode(m.id); setContextMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left">
                    <span className="w-4 flex items-center justify-center shrink-0">
                      {sortMode === m.id && <Check size={12} className="text-[var(--accent)]" />}
                    </span>
                    {m.label}
                  </button>
                ))}
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
