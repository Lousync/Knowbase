import { useState, useCallback } from 'react'
import { FileText, X } from 'lucide-react'
import { getFileTypeInfo } from '../../../lib/fileTypes'

export interface PageInfo {
  title: string
  fileType: string
}

interface PageTabBarProps {
  openPageIds: string[]
  activePageId: string | null
  openPageInfos: Record<string, PageInfo>
  onSelectTab: (pageId: string) => void
  onCloseTab: (pageId: string) => void
  onReorder: (newOrder: string[]) => void
}

export function PageTabBar({ openPageIds, activePageId, openPageInfos, onSelectTab, onCloseTab, onReorder }: PageTabBarProps) {
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
    <div className="flex items-center h-9 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] select-none shrink-0 overflow-x-auto">
      {openPageIds.map(pageId => {
        const info = openPageInfos[pageId]
        const title = info?.title || ''
        const fileInfo = getFileTypeInfo(info?.fileType || '')
        const isActive = pageId === activePageId
        const isDragged = pageId === draggedId

        return (
          <div
            key={pageId}
            data-tab-id={pageId}
            draggable
            onClick={() => onSelectTab(pageId)}
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
            <FileText size={14} className={`shrink-0 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
            <span className="truncate max-w-[140px]">{title || '加载中...'}</span>
            <span
              className="shrink-0 text-[8px] px-1 rounded font-medium"
              style={{ backgroundColor: `${fileInfo.color}20`, color: fileInfo.color }}
            >{fileInfo.badge}</span>
            <button
              onClick={e => { e.stopPropagation(); onCloseTab(pageId) }}
              className={`p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0
                ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
              `}
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
