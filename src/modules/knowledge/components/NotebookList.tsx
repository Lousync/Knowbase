import { useState, useEffect, useRef } from 'react'
import { FileText, Folder, FolderOpen, BookOpen, ChevronRight, ChevronDown, Plus, Pencil, Trash2, Star, Download } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../../types'
import { ConfirmDialog } from '../../../components/shared'
import { getSetting, setSetting } from '../../../lib/ipc'

interface Props {
  categories: KnowledgeCategory[]
  loosePages: KnowledgePage[]
  starredPages: KnowledgePage[]
  selectedNotebookId: string | null
  activePageId: string | null
  onSelectNotebook: (id: string | null) => void
  onCreateNotebook: (name: string, categoryType: 'folder' | 'notebook', parentId: string | null) => void
  onRenameNotebook: (id: string, name: string) => void
  onDeleteNotebook: (id: string) => void
  onOpenPage: (id: string) => void
  onCreateLoosePage: () => void
  onImport: () => void
  onDropOnNotebook: (pageId: string, notebookId: string) => void
  onDropOnCategory: (pageId: string, categoryId: string) => void
  onDropOnLooseArea: (pageId: string) => void
  onMoveCategory: (categoryId: string, newParentId: string | null) => void
}

export function NotebookList({
  categories, loosePages, starredPages,
  selectedNotebookId, activePageId,
  onSelectNotebook, onCreateNotebook, onRenameNotebook, onDeleteNotebook,
  onOpenPage, onCreateLoosePage, onImport,
  onDropOnNotebook, onDropOnCategory, onDropOnLooseArea, onMoveCategory,
}: Props) {
  const rootCats = categories.filter(c => !c.parentId)
  const [newName, setNewName] = useState('')
  const [createMode, setCreateMode] = useState<'folder' | 'notebook' | null>(null)
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [starredOpen, setStarredOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)  // which node is currently hovered during drag

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

  // ---- cycle prevention for drag-and-drop ----
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

  // ---- whether a category can accept dropped categories (folders only, not notebooks) ----
  function canAcceptCategory(targetId: string): boolean {
    const cat = categories.find(c => c.id === targetId)
    return cat?.categoryType === 'folder'
  }

  // ---- parse drag data: JSON {type, id} with legacy raw-string fallback ----
  function parseDragData(raw: string): { type: 'page' | 'category'; id: string } | null {
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (parsed.type === 'page' || parsed.type === 'category') {
        if (typeof parsed.id === 'string') return parsed
      }
    } catch {}
    // Legacy: raw string = page ID
    return { type: 'page', id: raw }
  }

  // ---- render a tree node (recursive) ----
  function renderCategory(cat: KnowledgeCategory, depth: number) {
    const isExpanded = expanded.has(cat.id)
    const isSelected = selectedNotebookId === cat.id
    const children = categories.filter(c => c.parentId === cat.id)
    const hasChildren = children.length > 0
    const isNotebook = cat.categoryType === 'notebook'
    const isDragOver = dragTargetId === cat.id

    return (
      <div key={cat.id}>
        <div
          data-cat-id={cat.id}
          draggable
          onDragStart={e => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'category', id: cat.id }))
            requestAnimationFrame(() => {
              (e.currentTarget as HTMLElement).style.opacity = '0.4'
            })
          }}
          onDragEnd={e => {
            (e.currentTarget as HTMLElement).style.opacity = '1'
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
              onClick={() => { if (hasChildren) toggleExpand(cat.id); onSelectNotebook(cat.id) }}
              className={`flex items-center gap-1.5 py-0.5 cursor-pointer group rounded transition-colors ${
                isSelected ? 'bg-[var(--bg-selected)] text-white'
                : isDragOver ? 'bg-[var(--drop-bg)] text-[var(--text-primary)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: '4px' }}
            >
              <span className="shrink-0 w-3.5 flex items-center justify-center">
                {hasChildren ? (
                  isExpanded ? <ChevronDown size={14} className="text-[var(--text-muted)]" /> : <ChevronRight size={14} className="text-[var(--text-muted)]" />
                ) : (
                  <span className="w-3.5" />
                )}
              </span>
              {isNotebook ? (
                <BookOpen size={15} className={`shrink-0 ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
              ) : hasChildren ? (
                isExpanded ? <FolderOpen size={15} className="shrink-0 text-[var(--warning)]" /> : <Folder size={15} className="shrink-0 text-[var(--warning)]" />
              ) : (
                <Folder size={15} className="shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="flex-1 truncate text-[13px]">{cat.name}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                {!isNotebook && (
                  <button onClick={e => { e.stopPropagation(); setCreateParentId(cat.id); setCreateMode('folder'); setNewName('') }}
                    className="p-0.5 hover:text-white text-[var(--text-secondary)]" title="新建子目录">
                    <Plus size={13} />
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); handleStartRename(cat.id, cat.name) }}
                  className="p-0.5 hover:text-white text-[var(--text-secondary)]" title="重命名">
                  <Pencil size={13} />
                </button>
                <button onClick={e => { e.stopPropagation(); if (skipDeleteConfirm) onDeleteNotebook(cat.id); else setDeleteTarget({ id: cat.id, name: cat.name }) }}
                  className="p-0.5 hover:text-[var(--danger)] text-[var(--text-secondary)]" title="删除">
                  <Trash2 size={13} />
                </button>
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
        {isExpanded && hasChildren && (
          <div>{children.map(ch => renderCategory(ch, depth + 1))}</div>
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
        data-drop-container
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onDragOver={e => {
          const d = parseDragData(e.dataTransfer.getData('text/plain'))
          if (!d) return

          if (d.type === 'category') {
            const el = (e.target as HTMLElement).closest('[data-cat-id]') as HTMLElement | null
            if (el) {
              const tid = el.getAttribute('data-cat-id')!
              if (d.id !== tid && !isDescendant(tid, d.id) && canAcceptCategory(tid)) {
                e.dataTransfer.dropEffect = 'move'
                setDragTargetId(tid)
              } else {
                e.dataTransfer.dropEffect = 'none'
                setDragTargetId(null)
              }
            } else {
              e.dataTransfer.dropEffect = 'move'
              setDragTargetId('__root')
            }
          } else if (d.type === 'page') {
            const el = (e.target as HTMLElement).closest('[data-cat-id]') as HTMLElement | null
            if (el) {
              e.dataTransfer.dropEffect = 'move'
              setDragTargetId(el.getAttribute('data-cat-id')!)
            } else {
              e.dataTransfer.dropEffect = 'move'
              setDragTargetId('__loose')
            }
          }
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragTargetId(null)
          }
        }}
        onDrop={e => {
          e.preventDefault()
          setDragTargetId(null)
          const d = parseDragData(e.dataTransfer.getData('text/plain'))
          if (!d) return

          if (d.type === 'category') {
            const target = (e.target as HTMLElement).closest('[data-cat-id]') as HTMLElement | null
            if (target) {
              const targetId = target.getAttribute('data-cat-id')!
              if (d.id !== targetId && !isDescendant(targetId, d.id) && canAcceptCategory(targetId)) {
                onMoveCategory(d.id, targetId)
              }
            } else {
              onMoveCategory(d.id, null)
            }
          } else if (d.type === 'page') {
            const catTarget = (e.target as HTMLElement).closest('[data-cat-id]') as HTMLElement | null
            if (catTarget) {
              const tid = catTarget.getAttribute('data-cat-id')!
              const cat = categories.find(c => c.id === tid)
              if (cat?.categoryType === 'notebook') {
                onDropOnNotebook(d.id, tid)
              } else {
                onDropOnCategory(d.id, tid)
              }
            } else {
              onDropOnLooseArea(d.id)
            }
          }
        }}
      >
        {rootCats.map(cat => renderCategory(cat, 0))}

        {/* Root-level loose pages */}
        {loosePages.length > 0 && (
          <div className={dragTargetId === '__loose' ? 'bg-[var(--drop-bg)] rounded mx-1' : ''}
          >
            {loosePages.map(p => (
              <div key={p.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                  requestAnimationFrame(() => {
                    (e.currentTarget as HTMLElement).style.opacity = '0.4'
                  })
                }}
                onDragEnd={e => {
                  (e.currentTarget as HTMLElement).style.opacity = '1'
                }}
                onClick={() => onOpenPage(p.id)}
                className={`flex items-center gap-1.5 py-0.5 cursor-pointer group rounded transition-colors ${
                  activePageId === p.id ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
                style={{ paddingLeft: '8px', paddingRight: '4px' }}
              >
                <span className="w-3.5 shrink-0" />
                <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
                <span className="flex-1 truncate text-[13px]">{p.title || '无标题'}</span>
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
                  className={`flex items-center gap-1.5 px-1 ml-2 py-0.5 cursor-pointer rounded text-[12px] ${activePageId === p.id ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}>
                  <Star size={11} className="shrink-0 text-[var(--warning)]" fill="#c5a332" />
                  <span className="truncate flex-1">{p.title || '无标题'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
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
