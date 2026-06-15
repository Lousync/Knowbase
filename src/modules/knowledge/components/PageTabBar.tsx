import { useState, useCallback } from 'react'
import { FileText, X } from 'lucide-react'

interface PageTabBarProps {
  openPageIds: string[]
  activePageId: string | null
  openPageTitles: Record<string, string>
  onSelectTab: (pageId: string) => void
  onCloseTab: (pageId: string) => void
  onReorder: (newOrder: string[]) => void
}

export function PageTabBar({ openPageIds, activePageId, openPageTitles, onSelectTab, onCloseTab, onReorder }: PageTabBarProps) {
  const [dragSide, setDragSide] = useState<'left' | 'right'>('right')
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, pageId: string) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pageId)
    setDraggedId(pageId)
    requestAnimationFrame(() => {
      (e.currentTarget as HTMLElement).style.opacity = '0.4'
    })
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setDraggedId(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, pageId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (pageId === draggedId) return

    const rect = e.currentTarget.getBoundingClientRect()
    setDragSide(e.clientX < rect.left + rect.width / 2 ? 'left' : 'right')
  }, [draggedId])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    setDraggedId(null)

    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId) return

    const ids = [...openPageIds]
    const srcIdx = ids.indexOf(sourceId)
    if (srcIdx === -1) return

    ids.splice(srcIdx, 1)
    const targetIdx = ids.indexOf(targetId)
    const insertIdx = dragSide === 'right' ? targetIdx + 1 : targetIdx
    ids.splice(insertIdx, 0, sourceId)
    onReorder(ids)
  }, [openPageIds, dragSide, onReorder])

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  if (openPageIds.length === 0) return null

  return (
    <div
      className="flex items-center h-9 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] select-none shrink-0 overflow-x-auto"
      onDragOver={handleContainerDragOver}
    >
      {openPageIds.map(pageId => {
        const title = openPageTitles[pageId] || ''
        const isActive = pageId === activePageId
        const isDragged = pageId === draggedId

        return (
          <div
            key={pageId}
            className={`relative group ${isDragged ? 'opacity-40' : ''}`}
          >
            <div
              draggable
              onClick={() => onSelectTab(pageId)}
              onDragStart={e => handleDragStart(e, pageId)}
              onDragEnd={handleDragEnd}
              onDragOver={e => handleDragOver(e, pageId)}
              onDrop={e => handleDrop(e, pageId)}
              className={`
                flex items-center gap-1.5 h-9 px-3 text-[13px] cursor-pointer whitespace-nowrap
                border-r border-[var(--border-color)] transition-colors duration-75
                ${isActive
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] border-t-2 border-t-[var(--accent)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border-t-2 border-t-transparent'
                }
              `}
            >
              <FileText size={14} className={`shrink-0 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
              <span className="truncate max-w-[160px]">{title || '加载中...'}</span>
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
          </div>
        )
      })}
    </div>
  )
}
