import { useState } from 'react'
import { ArrowLeft, Layers, Pencil } from 'lucide-react'
import type { KnowledgeCategory } from '../../../types'

interface Props {
  space: KnowledgeCategory
  onCollapse: () => void
  onRename?: (id: string, name: string) => void
}

/**
 * 空间沉浸视图的顶部返回栏 — 打开某个空间后显示。
 * 注意：NotebookList 始终挂载（保留展开状态），此组件只是在其上方叠加返回头。
 */
export function SpacePanel({ space, onCollapse, onRename }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(space.name)

  const commit = () => {
    setEditing(false)
    const trimmed = name.trim()
    if (trimmed && trimmed !== space.name) onRename?.(space.id, trimmed)
    else setName(space.name)
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--border-color)] shrink-0">
      <button
        onClick={onCollapse}
        className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="返回空间列表"
      >
        <ArrowLeft size={18} />
      </button>
      <Layers size={15} className="shrink-0 text-[var(--info)]" />
      {editing ? (
        <input
          className="flex-1 min-w-0 bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-[12px] outline-none text-[var(--text-primary)]"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(space.name); setEditing(false) } }}
          autoFocus
        />
      ) : (
        <>
          <span className="text-[12px] font-medium text-[var(--text-secondary)] truncate">{space.name}</span>
          {onRename && (
            <button
              onClick={() => { setName(space.name); setEditing(true) }}
              className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="重命名空间"
            >
              <Pencil size={12} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

