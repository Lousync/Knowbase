import { useState, useCallback } from 'react'
import { X, Pin } from 'lucide-react'
import { FileIcon } from '../../../components/shared/FileIcon'
import { getFileTypeInfo } from '../../../lib/fileTypes'

/**
 * 页签栏：预览/钉住双态（VS Code 模型，2026-09-12）。
 * - 预览态（斜体）：浏览产生，全栏最多一个「预览槽」，再次浏览原位替换——标签栏不膨胀；
 * - 钉住态（正常字重 + 图钉）：双击标签 / 图钉按钮 / 右键菜单显式固定，永不被浏览替换；
 * - 编辑中（dirty，未保存）视同钉住：不会被替换，关闭走未保存确认。
 * 知识库 vault 只读化后 dirty 几乎不再产生，钉住是标签累积的唯一入口。 */

export interface PageInfo {
  title: string
  fileType: string
}

interface PageTabBarProps {
  openPageIds: string[]
  activePageId: string | null
  openPageInfos: Record<string, PageInfo>
  /** 编辑中（未保存）——视同钉住，关闭需确认 */
  dirtyPageIds?: Set<string>
  /** 用户显式固定的标签 */
  pinnedPageIds?: Set<string>
  onSelectTab: (pageId: string) => void
  onCloseTab: (pageId: string) => void
  onReorder: (newOrder: string[]) => void
  onTogglePin: (pageId: string) => void
  onTabContextMenu?: (e: React.MouseEvent, pageId: string) => void
  rightActions?: React.ReactNode
}

export function PageTabBar({ openPageIds, activePageId, openPageInfos, dirtyPageIds, pinnedPageIds, onSelectTab, onCloseTab, onReorder, onTogglePin, onTabContextMenu, rightActions }: PageTabBarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, pageId: string) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pageId)
    setDraggedId(pageId)
    ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    ;(e.currentTarget as HTMLElement).style.opacity = '1'
    setDraggedId(null)
    // Clear all drop indicators
    document.querySelectorAll('[data-tab-id]').forEach(el => {
      ;(el as HTMLElement).style.boxShadow = ''
    })
  }, [])

  // Per-tab: allow drops on self to determine left/right insert
  const handleTabDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'

    const srcId = e.dataTransfer.getData('text/plain')
    if (!srcId || srcId === targetId) {
      ;(e.currentTarget as HTMLElement).style.boxShadow = ''
      return
    }

    // Show drop indicator: left half → insert before, right half → insert after
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    ;(e.currentTarget as HTMLElement).style.boxShadow =
      side === 'left' ? 'inset 2px 0 0 var(--accent)' : 'inset -2px 0 0 var(--accent)'
  }, [])

  const handleTabDragLeave = useCallback((e: React.DragEvent) => {
    ;(e.currentTarget as HTMLElement).style.boxShadow = ''
  }, [])

  const handleTabDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).style.boxShadow = ''

    const srcId = e.dataTransfer.getData('text/plain')
    if (!srcId || srcId === targetId) return

    const ids = [...openPageIds]
    const srcIdx = ids.indexOf(srcId)
    const dstIdx = ids.indexOf(targetId)
    if (srcIdx === -1 || dstIdx === -1) return

    // Determine side based on last known mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'

    ids.splice(srcIdx, 1)
    const insertIdx = side === 'right' ? ids.indexOf(targetId) + 1 : ids.indexOf(targetId)
    ids.splice(insertIdx, 0, srcId)
    onReorder(ids)
  }, [openPageIds, onReorder])

  if (openPageIds.length === 0) return null

  return (
    <div className="flex items-center h-9 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] select-none shrink-0">
      <div className="flex items-center h-full overflow-x-auto flex-1 min-w-0">
        {openPageIds.map(pageId => {
        const info = openPageInfos[pageId]
        const title = info?.title || ''
        const isActive = pageId === activePageId
        const isDragged = pageId === draggedId
        const isPinned = (pinnedPageIds?.has(pageId) ?? false) || (dirtyPageIds?.has(pageId) ?? false)
        const isPreview = !isPinned
        const fileType = info?.fileType || ''

        return (
          <div
            key={pageId}
            data-tab-id={pageId}
            draggable
            onClick={() => onSelectTab(pageId)}
            onDoubleClick={(e) => { e.preventDefault(); onTogglePin(pageId) }}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onCloseTab(pageId) } }}
            onContextMenu={(e) => { e.preventDefault(); onTabContextMenu?.(e, pageId) }}
            onDragStart={e => handleDragStart(e, pageId)}
            onDragEnd={handleDragEnd}
            onDragOver={e => handleTabDragOver(e, pageId)}
            onDragLeave={handleTabDragLeave}
            onDrop={e => handleTabDrop(e, pageId)}
            className={`
              relative group flex items-center gap-1.5 h-9 px-3 text-[13px] cursor-pointer whitespace-nowrap
              border-r border-[var(--border-color)] transition-colors duration-75
              ${isDragged ? 'opacity-40' : ''}
              ${isActive
                ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] border-t-2 border-t-[var(--accent)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border-t-2 border-t-transparent'
              }
            `}
          >
            <FileIcon ext={fileType} size={14} />
            <span className={`truncate max-w-[140px] ${isPreview ? 'italic' : ''}`}>{title || '加载中...'}</span>
            {(() => { const fi = getFileTypeInfo(fileType); return <span className="shrink-0 text-[8px] px-1 rounded font-medium" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> })()}
            <button
              onClick={e => { e.stopPropagation(); onTogglePin(pageId) }}
              onDoubleClick={e => e.stopPropagation()}
              className={`p-0.5 rounded hover:bg-[var(--bg-hover)] shrink-0
                ${isPinned
                  ? 'opacity-100 text-[var(--accent)]'
                  : 'opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-primary)]'}
              `}
              title={isPinned ? '取消固定' : '固定标签（双击标签也可）'}
            >
              <Pin size={12} className={isPinned ? 'fill-current' : ''} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onCloseTab(pageId) }}
              onDoubleClick={e => e.stopPropagation()}
              className={`p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0
                ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
              `}
              title="关闭（中键点击也可）"
            >
              <X size={14} />
            </button>
          </div>
        )
        })}
      </div>
      {rightActions && (
        <div className="flex items-center h-full shrink-0 gap-0.5 pr-1.5 pl-1.5 border-l border-[var(--border-color)]">
          {rightActions}
        </div>
      )}
    </div>
  )
}
