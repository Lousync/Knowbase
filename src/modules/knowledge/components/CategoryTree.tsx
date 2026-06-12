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

  const renderTree = (items: KnowledgeCategory[], depth: number) => {
    return items.map(cat => {
      const isExpanded = expanded.has(cat.id)
      const isSelected = selectedId === cat.id
      const children = categories.filter(c => c.parentId === cat.id)

      return (
        <div key={cat.id}>
          <div
            className={`flex items-center gap-1 py-0.5 pr-2 cursor-pointer group text-[13px] hover:bg-[#2a2d2e] ${
              isSelected ? 'bg-[#094771] text-white' : 'text-[#cccccc]'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => { onSelect(cat.id); toggleExpand(cat.id) }}
          >
            <span className="shrink-0 w-4 flex items-center justify-center text-[#969696]">
              {children.length > 0 ? (
                isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
              ) : (
                <span className="w-[14px]" />
              )}
            </span>
            <span className="shrink-0 text-[#c5a332]">
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            {editingId === cat.id ? (
              <input
                className="flex-1 bg-[#3c3c3c] border border-[#007acc] rounded px-1 text-[13px] outline-none"
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
            <div className="hidden group-hover:flex items-center gap-0.5 ml-1 shrink-0">
              <button
                className="p-0.5 hover:text-[#cccccc] text-[#969696]"
                onClick={e => { e.stopPropagation(); setNewCatParent(cat.id); setNewName('') }}
                title="添加子分类"
              >
                <Plus size={12} />
              </button>
              <button
                className="p-0.5 hover:text-[#cccccc] text-[#969696]"
                onClick={e => { e.stopPropagation(); handleStartRename(cat.id, cat.name) }}
                title="重命名"
              >
                <Pencil size={12} />
              </button>
              <button
                className="p-0.5 hover:text-[#e81123] text-[#969696]"
                onClick={e => { e.stopPropagation(); onDelete(cat.id) }}
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          {isExpanded && children.length > 0 && (
            <div>{renderTree(children, depth + 1)}</div>
          )}
          {/* 内联新建输入框 */}
          {newCatParent === cat.id && (
            <div className="flex items-center gap-1 py-0.5 pl-2" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              <input
                className="flex-1 bg-[#3c3c3c] border border-[#007acc] rounded px-1 text-[13px] outline-none text-[#cccccc]"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onBlur={() => { handleCreate() }}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setNewCatParent(null); setNewName('') } }}
                placeholder="分类名"
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
        <span className="text-[11px] font-semibold text-[#969696] uppercase tracking-wide">分类目录</span>
        <button
          className="p-0.5 hover:text-[#cccccc] text-[#969696]"
          onClick={() => { setNewCatParent(null); setNewName('') }}
          title="新建根分类"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {/* 全部页面 */}
        <div
          className={`flex items-center gap-1 py-1 px-3 cursor-pointer text-[13px] hover:bg-[#2a2d2e] ${
            selectedId === null ? 'bg-[#094771] text-white' : 'text-[#cccccc]'
          }`}
          onClick={() => onSelect(null)}
        >
          <span className="w-4" />
          <span className="text-[#969696]"><Folder size={14} /></span>
          <span>全部页面</span>
        </div>
        {/* 分类树 */}
        {renderTree(rootCategories, 0)}
        {/* 根级别新建 */}
        {newCatParent === null && (
          <div className="flex items-center gap-1 py-1 px-3 mt-1">
            <input
              className="flex-1 bg-[#3c3c3c] border border-[#007acc] rounded px-1 text-[13px] outline-none text-[#cccccc]"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={() => handleCreate()}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setNewCatParent(null); setNewName('') } }}
              placeholder="新分类名称"
              autoFocus
            />
          </div>
        )}
      </div>
    </div>
  )
}
