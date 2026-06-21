import { useEffect } from 'react'
import { BookOpen, Folder, FolderOpen, X } from 'lucide-react'
import type { KnowledgeCategory } from '../../../types'

interface Props {
  open: boolean
  moveType: 'category' | 'page'
  moveId: string
  categories: KnowledgeCategory[]
  sortCats: (list: KnowledgeCategory[]) => KnowledgeCategory[]
  isDescendant: (ancestorId: string, nodeId: string) => boolean
  canAcceptCategory: (targetId: string, draggedId: string) => boolean
  onMoveCategory: (categoryId: string, newParentId: string | null) => void
  onMovePageToNotebook: (pageId: string, notebookId: string) => void
  onMovePageToCategory: (pageId: string, categoryId: string) => void
  onMovePageToLoose: (pageId: string) => void
  onClose: () => void
}

/**
 * Modal category tree picker — used as the "move to..." target selector.
 * Replaces drag-and-drop with a reliable click-to-select UI.
 */
export function CategoryMovePicker({
  open, moveType, moveId, categories, sortCats,
  isDescendant, canAcceptCategory,
  onMoveCategory, onMovePageToNotebook, onMovePageToCategory, onMovePageToLoose,
  onClose,
}: Props) {
  // Escape key dismiss
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // ---- validate a target for category moves ----
  function isValidTarget(targetId: string): boolean {
    if (targetId === moveId) return false
    if (isDescendant(moveId, targetId)) return false
    if (!canAcceptCategory(targetId, moveId)) return false
    return true
  }

  // ---- recursive tree render (flat list, always fully expanded) ----
  function renderPickerTree(parentId: string | null, depth: number): React.ReactNode[] {
    const items = sortCats(categories.filter(c => c.parentId === parentId))
    return items.flatMap(cat => {
      const isNotebook = cat.categoryType === 'notebook'
      const disabled = moveType === 'category' ? !isValidTarget(cat.id) : false

      const handleClick = () => {
        if (disabled) return
        if (moveType === 'category') {
          onMoveCategory(moveId, cat.id)
        } else {
          // page move: notebooks need special handling (auto-create chapter)
          if (isNotebook) {
            onMovePageToNotebook(moveId, cat.id)
          } else {
            onMovePageToCategory(moveId, cat.id)
          }
        }
        onClose()
      }

      const node = (
        <button
          key={cat.id}
          onClick={handleClick}
          disabled={disabled}
          className={`w-full flex items-center gap-1.5 py-1 px-2 text-left transition-colors rounded ${
            disabled
              ? 'text-[var(--text-disabled)] cursor-not-allowed'
              : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {isNotebook ? (
            <BookOpen size={15} className="shrink-0 text-[var(--text-muted)]" />
          ) : (
            <Folder size={15} className="shrink-0 text-[var(--warning)]" />
          )}
          <span className="truncate text-[13px]">{cat.name}</span>
          {disabled && (
            <span className="shrink-0 text-[10px] text-[var(--text-disabled)] ml-1">不可用</span>
          )}
        </button>
      )

      const children = renderPickerTree(cat.id, depth + 1)
      return [node, ...children]
    })
  }

  const title = moveType === 'category' ? '移动目录到...' : '移动页面到...'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl flex flex-col"
        style={{ width: '380px', maxHeight: '500px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-color)]">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
          <button onClick={onClose} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
          {/* Root / Loose option */}
          <button
            onClick={() => {
              if (moveType === 'category') {
                onMoveCategory(moveId, null)
              } else {
                onMovePageToLoose(moveId)
              }
              onClose()
            }}
            className="w-full flex items-center gap-1.5 py-1.5 px-3 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-color)]"
          >
            <FolderOpen size={15} className="shrink-0 text-[var(--text-muted)]" />
            <span>{moveType === 'category' ? '根层级（移到顶层）' : '松散页面（取消归属）'}</span>
          </button>

          {renderPickerTree(null, 0)}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--border-color)]">
          <button
            onClick={onClose}
            className="w-full py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
