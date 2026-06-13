import { useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Plus, Pencil, Trash2 } from 'lucide-react'
import type { KnowledgeCategory } from '../../../types'

interface Props {
  categories: KnowledgeCategory[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onCreate: (name: string, parentId: string | null) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function CategoryTree({ categories, selectedId, onSelect, onCreate, onRename, onDelete }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newCatParent, setNewCatParent] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [showRootInput, setShowRootInput] = useState(false)

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreate = () => {
    if (!newName.trim()) return
    onCreate(newName.trim(), newCatParent)
    setNewName('')
    setNewCatParent(null)
    setShowRootInput(false)
  }

  const handleStartRename = (id: string, name: string) => {
    setEditingId(id)
    setEditName(name)
  }

  const handleRename = (id: string) => {
    if (!editName.trim()) return
    onRename(id, editName.trim())
    setEditingId(null)
  }

  const handleCollapseAll = () => {
    setExpanded(new Set())
    onSelect(null)
  }

  const renderTree = (items: KnowledgeCategory[], depth: number) => {
    return items.map(cat => {
      const isExpanded = expanded.has(cat.id)
      const isSelected = selectedId === cat.id
      const children = categories.filter(c => c.parentId === cat.id)

      return (
        <div key={cat.id}>
          <div
            className={`flex items-center gap-1.5 py-1 pr-2 cursor-pointer group text-[14px] hover:bg-[var(--bg-hover)] ${
              isSelected ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-primary)]'
            }`}
            style={{ paddingLeft: `${depth * 20 + 12}px` }}
            onClick={() => { onSelect(cat.id); toggleExpand(cat.id) }}
          >
            <span className="shrink-0 w-4 flex items-center justify-center text-[var(--text-secondary)]">
              {children.length > 0 ? (
                isExpanded ? <ChevronDown size={24} /> : <ChevronRight size={24} />
              ) : (
                <span className="w-[16px]" />
              )}
            </span>
            <span className="shrink-0 text-[var(--warning)]">
              {isExpanded ? <FolderOpen size={24} /> : <Folder size={24} />}
            </span>
            {editingId === cat.id ? (
              <input
                className="flex-1 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 text-[14px] outline-none"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => handleRename(cat.id)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(cat.id); if (e.key === 'Escape') setEditingId(null) }}
                autoFocus
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 truncate">{cat.name}</span>
            )}
            <div className="hidden group-hover:flex items-center gap-1 ml-1 shrink-0">
              <button
                className="p-0.5 hover:text-[var(--text-primary)] text-[var(--text-secondary)]"
                onClick={e => { e.stopPropagation(); setNewCatParent(cat.id); setNewName('') }}
                title="添加子分类"
              >
                <Plus size={21} />
              </button>
              <button
                className="p-0.5 hover:text-[var(--text-primary)] text-[var(--text-secondary)]"
                onClick={e => { e.stopPropagation(); handleStartRename(cat.id, cat.name) }}
                title="重命名"
              >
                <Pencil size={21} />
              </button>
              <button
                className="p-0.5 hover:text-[var(--danger)] text-[var(--text-secondary)]"
                onClick={e => { e.stopPropagation(); onDelete(cat.id) }}
                title="删除"
              >
                <Trash2 size={21} />
              </button>
            </div>
          </div>
          {isExpanded && children.length > 0 && (
            <div>{renderTree(children, depth + 1)}</div>
          )}
          {newCatParent === cat.id && (
            <div className="flex items-center gap-1 py-1 pl-2" style={{ paddingLeft: `${(depth + 1) * 20 + 12}px` }}>
              <input
                className="flex-1 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 text-[14px] outline-none text-[var(--text-primary)]"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onBlur={() => handleCreate()}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setNewCatParent(null); setNewName('') } }}
                placeholder="分类名称"
                autoFocus
              />
            </div>
          )}
        </div>
      )
    })
  }

  const rootCategories = categories.filter(c => !c.parentId)

  return (
    <div className="flex flex-col h-full">
      {/* 全部页面 按钮 + 新建主题 按钮 */}
      <div className="px-2 py-1.5 border-b border-[var(--border-color)] space-y-1">
        <button
          onClick={handleCollapseAll}
          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-[14px] text-left hover:bg-[var(--bg-hover)] ${
            selectedId === null ? 'bg-[var(--bg-selected)] text-white hover:bg-[#0b5a8f]' : 'text-[var(--text-primary)]'
          }`}
        >
          <Folder size={24} className="shrink-0" />
          <span>全部页面</span>
        </button>
        {!showRootInput ? (
          <button
            onClick={() => setShowRootInput(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] text-left"
          >
            <Plus size={21} className="shrink-0" />
            <span>新建主题</span>
          </button>
        ) : (
          <div className="flex items-center gap-1 px-2">
            <input
              className="flex-1 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[14px] outline-none text-[var(--text-primary)]"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={() => handleCreate()}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowRootInput(false); setNewName('') } }}
              placeholder="主题名称"
              autoFocus
            />
          </div>
        )}
      </div>

      {/* 树 */}
      <div className="flex-1 overflow-y-auto py-1">
        {renderTree(rootCategories, 0)}
      </div>
    </div>
  )
}
