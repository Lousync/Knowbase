import { useState, useEffect } from 'react'
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
  onCreateNotebook: (name: string) => void
  onRenameNotebook: (id: string, name: string) => void
  onDeleteNotebook: (id: string) => void
  onOpenPage: (id: string) => void
  onCreateLoosePage: () => void
  onImport: () => void
  onOpenRecycleBin: () => void
  onDropOnNotebook: (pageId: string, notebookId: string) => void
  onDropOnLooseArea: (pageId: string) => void
}

export function NotebookList({
  categories, loosePages, starredPages,
  selectedNotebookId, activePageId,
  onSelectNotebook, onCreateNotebook, onRenameNotebook, onDeleteNotebook,
  onOpenPage, onCreateLoosePage, onImport, onOpenRecycleBin,
  onDropOnNotebook, onDropOnLooseArea,
}: Props) {
  const rootCats = categories.filter(c => !c.parentId)
  const [newName, setNewName] = useState('')
  const [createMode, setCreateMode] = useState<'folder' | 'notebook' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [starredOpen, setStarredOpen] = useState(false)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)

  // Track notebook names: any category created via "笔记本" button in this session
  const [notebookNames, setNotebookNames] = useState<Set<string>>(new Set())

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
    if (!newName.trim()) { setNewName(''); setCreateMode(null); return }
    const name = newName.trim()
    if (createMode === 'notebook') {
      setNotebookNames(prev => new Set([...prev, name]))
    }
    onCreateNotebook(name)
    setNewName(''); setCreateMode(null)
  }

  function handleStartRename(id: string, name: string) { setEditingId(id); setEditName(name) }
  function handleRename(id: string) {
    if (!editName.trim()) { setEditingId(null); return }
    onRenameNotebook(id, editName.trim()); setEditingId(null)
  }

  // ---- render a tree node (recursive) ----
  function renderCategory(cat: KnowledgeCategory, depth: number) {
    const isExpanded = expanded.has(cat.id)
    const isSelected = selectedNotebookId === cat.id
    const children = categories.filter(c => c.parentId === cat.id)
    const hasChildren = children.length > 0
    const isNotebook = notebookNames.has(cat.name)

    return (
      <div key={cat.id}>
        <div
          draggable={false}
          onDragOver={e => { e.preventDefault(); setDragOverId(cat.id) }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={e => {
            e.preventDefault(); setDragOverId(null)
            const pageId = e.dataTransfer.getData('text/plain')
            if (pageId) onDropOnNotebook(pageId, cat.id)
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
                isSelected ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              } ${dragOverId === cat.id ? 'ring-1 ring-[var(--accent)]' : ''}`}
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
          <button onClick={() => { setCreateMode('folder'); setNewName('') }}
            className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border-color)]">
            <Folder size={12} />目录
          </button>
          <button onClick={() => { setCreateMode('notebook'); setNewName('') }}
            className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border-color)]">
            <BookOpen size={12} />笔记本
          </button>
          <button onClick={onCreateLoosePage}
            className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border-color)]">
            <FileText size={11} />页面
          </button>
        </div>

        {/* Inline create input */}
        {createMode && (
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {rootCats.map(cat => renderCategory(cat, 0))}

        {/* Root-level loose pages */}
        {loosePages.length > 0 && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOverId('__loose') }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={e => {
              e.preventDefault(); setDragOverId(null)
              const pageId = e.dataTransfer.getData('text/plain')
              if (pageId) onDropOnLooseArea(pageId)
            }}
            className={dragOverId === '__loose' ? 'ring-1 ring-[var(--accent)] rounded mx-1' : ''}
          >
            {loosePages.map(p => (
              <div key={p.id}
                draggable
                onDragStart={e => { e.dataTransfer.setData('text/plain', p.id) }}
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

      {/* ===== Recycle Bin ===== */}
      <div className="border-t border-[var(--border-color)] px-2 py-0.5">
        <button onClick={onOpenRecycleBin}
          className="w-full flex items-center gap-1.5 px-1 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
          <Trash2 size={15} />回收站
        </button>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除"
        message={`确定要删除「${deleteTarget?.name ?? ''}」吗？其下所有子目录和页面将被移到零散文件中。`}
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
