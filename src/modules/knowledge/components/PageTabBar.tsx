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
  const [dragSide, setDragSide] = useState<'left' | 'right'>('right')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, pageId: string) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pageId)
    setDraggedId(pageId)
    requestAnimationFrame(() => {
      (e.currentTarget as HTMLElement).style.opacity = '0.4'
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedId(null)
    setDragOverTabId(null)
  }, [])

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.dataTransfer.dropEffect = 'move'

    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId) return

    const tabEl = (e.target as HTMLElement).closest('[data-tab-id]') as HTMLElement | null
    if (tabEl) {
      const tabId = tabEl.getAttribute('data-tab-id')
      if (tabId === sourceId) {
        setDragOverTabId(null)
        return
      }
      const rect = tabEl.getBoundingClientRect()
      setDragSide(e.clientX < rect.left + rect.width / 2 ? 'left' : 'right')
      setDragOverTabId(tabId)
    } else {
      setDragOverTabId(null)
    }
  }, [])

  const handleContainerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDraggedId(null)
    setDragOverTabId(null)

    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId) return

    const tabEl = (e.target as HTMLElement).closest('[data-tab-id]') as HTMLElement | null
    if (!tabEl) return
    const targetId = tabEl.getAttribute('data-tab-id')!
    if (sourceId === targetId) return

    const ids = [...openPageIds]
    const srcIdx = ids.indexOf(sourceId)
    if (srcIdx === -1) return

    ids.splice(srcIdx, 1)
    const targetIdx = ids.indexOf(targetId)
    const insertIdx = dragSide === 'right' ? targetIdx + 1 : targetIdx
    ids.splice(insertIdx, 0, sourceId)
    onReorder(ids)
  }, [openPageIds, dragSide, onReorder])

  if (openPageIds.length === 0) return null

  return (
    <div
      data-drop-container
      className="flex items-center h-9 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] select-none shrink-0 overflow-x-auto"
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      {openPageIds.map(pageId => {
        const info = openPageInfos[pageId]
        const title = info?.title || ''
        const fileInfo = getFileTypeInfo(info?.fileType || '')
        const isActive = pageId === activePageId
        const isDragged = pageId === draggedId
        const isDragOver = pageId === dragOverTabId

        return (
          <div
            key={pageId}
            data-tab-id={pageId}
            className={`relative group ${isDragged ? 'opacity-40' : ''}`}
            style={
              isDragOver
                ? { boxShadow: dragSide === 'left' ? 'inset 2px 0 0 var(--accent)' : 'inset -2px 0 0 var(--accent)' }
                : undefined
            }
          >
            <div
              draggable
              onClick={() => onSelectTab(pageId)}
              onDragStart={e => handleDragStart(e, pageId)}
              onDragEnd={handleDragEnd}
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
          </div>
        )
      })}
    </div>
  )
}
