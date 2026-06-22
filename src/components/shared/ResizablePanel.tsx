import { useState, useEffect, useRef, useCallback } from 'react'
import { getSettingRaw, setSettingRaw } from '../../lib/ipc'

interface Props {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  visible: boolean
  className?: string
  children: React.ReactNode
  /** Pre-loaded persisted width — when provided, skips async getSetting */
  initialWidth?: number
  /** Show drag handle on right edge. Default true. */
  showHandle?: boolean
  /** VS Code snap-close: called when dragged left past minWidth/2 */
  onSnapClose?: () => void
  /** VS Code snap-open: called when dragged right past minWidth/2 from collapsed state */
  onSnapOpen?: () => void
}

export function ResizablePanel({ storageKey, defaultWidth, minWidth, maxWidth, visible, className = '', children, initialWidth, showHandle = true, onSnapClose, onSnapOpen }: Props) {
  const [width, setWidth] = useState(initialWidth ?? defaultWidth)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(initialWidth ?? defaultWidth)
  const startXRef = useRef(0)
  const startWRef = useRef(0)
  const loadedRef = useRef(initialWidth != null)  // skip async load if pre-loaded

  // 加载持久化宽度（仅在未预加载时）
  useEffect(() => {
    if (loadedRef.current) return
    getSettingRaw(storageKey).then(v => {
      if (typeof v === 'number') {
        const clamped = Math.max(minWidth, Math.min(maxWidth, v))
        setWidth(clamped)
        widthRef.current = clamped
      }
    })
  }, [storageKey, minWidth, maxWidth])

  // mousedown on handle
  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startXRef.current = e.clientX
    startWRef.current = widthRef.current
    setDragging(true)
  }, [])

  // 全局拖拽事件（只在 dragging 切换时重新绑定）
  useEffect(() => {
    if (!dragging) return

    let snapped = false

    const onMove = (e: MouseEvent) => {
      if (snapped) return
      const delta = e.clientX - startXRef.current
      const raw = startWRef.current + delta
      // VS Code snap-close: drag past half of minWidth → auto-collapse
      if (onSnapClose && raw < minWidth * 0.5) {
        snapped = true
        setDragging(false)
        onSnapClose()
        return
      }
      const next = Math.max(minWidth, Math.min(maxWidth, raw))
      widthRef.current = next
      setWidth(next)
    }

    const onUp = () => {
      setDragging(false)
      if (!snapped) {
        setSettingRaw(storageKey, widthRef.current)
      }
    }

    // 拖拽期间禁用文本选中
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragging, minWidth, maxWidth, storageKey, onSnapClose])
  // 注意：width 不在依赖中 — 用 widthRef 避免每次像素变化都重建监听器

  // 折叠时重置为 0，但边缘分割条保留 4px 以供重新拖出
  const displayWidth = visible ? width : (onSnapOpen ? 4 : 0)
  const showBorder = visible && !dragging

  // 从折叠状态拖拽以拉出侧边栏
  const onEdgeMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onSnapOpen) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    let opened = false

    const onMove = (ev: MouseEvent) => {
      if (opened) return
      if (ev.clientX - startX > minWidth * 0.5) {
        opened = true
        onSnapOpen()
      }
    }
    const onUp = () => {
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [minWidth, onSnapOpen])

  return (
    <div
      ref={panelRef}
      className={`shrink-0 relative flex flex-col bg-[var(--bg-secondary)] overflow-hidden ${className}`}
      style={{
        width: displayWidth,
        borderRightWidth: showBorder ? 1 : 0,
        borderColor: showBorder ? 'var(--border-color)' : 'transparent',
        transition: dragging ? 'none' : 'width 200ms ease-out'
      }}
    >
      {visible && children}

      {/* 折叠边缘分割条 — 鼠标悬停显示蓝色可拖拽条，拖拽拉出侧边栏 */}
      {!visible && onSnapOpen && (
        <div
          className="absolute inset-0 z-30 group"
          style={{ cursor: 'col-resize' }}
          onMouseDown={onEdgeMouseDown}
        >
          <div className="absolute top-0 bottom-0 left-0 w-1 bg-[var(--accent)]/0 group-hover:bg-[var(--accent)]/60 transition-colors duration-150" />
        </div>
      )}

      {/* 拖拽手柄 — 右边缘内侧 6px，独立于 border 不重叠 */}
      {visible && showHandle && (
        <div
          className={`absolute top-0 right-0 w-1.5 h-full z-30 transition-colors ${
            dragging ? 'bg-[var(--accent)] cursor-col-resize' : 'cursor-col-resize hover:bg-[var(--accent)]/20'
          }`}
          style={{ marginRight: -3 }}
          onMouseDown={onHandleMouseDown}
        />
      )}
    </div>
  )
}
