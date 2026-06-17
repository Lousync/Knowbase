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
}

export function ResizablePanel({ storageKey, defaultWidth, minWidth, maxWidth, visible, className = '', children, initialWidth, showHandle = true }: Props) {
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

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current
      const next = Math.max(minWidth, Math.min(maxWidth, startWRef.current + delta))
      widthRef.current = next
      setWidth(next)
    }

    const onUp = () => {
      setDragging(false)
      // 用 ref 保存最新值，避免闭包陈旧问题
      setSettingRaw(storageKey, widthRef.current)
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
  }, [dragging, minWidth, maxWidth, storageKey])
  // 注意：width 不在依赖中 — 用 widthRef 避免每次像素变化都重建监听器

  // 折叠时重置为 0
  const displayWidth = visible ? width : 0
  const showBorder = visible && !dragging

  return (
    <div
      ref={panelRef}
      className={`shrink-0 relative flex flex-col bg-[var(--bg-secondary)] overflow-hidden ${className}`}
      style={{
        width: displayWidth,
        borderRightWidth: showBorder ? 1 : 0,
        borderColor: showBorder ? '#3c3c3c' : 'transparent',
        transition: dragging ? 'none' : 'width 200ms ease-out'
      }}
    >
      {visible && children}

      {/* 拖拽手柄 — 右边缘内侧 6px，独立于 border 不重叠 */}
      {visible && showHandle && (
        <div
          className={`absolute top-0 right-0 w-1.5 h-full z-30 transition-colors ${
            dragging ? 'bg-[var(--accent)] cursor-col-resize' : 'cursor-col-resize hover:bg-[#007acc30]'
          }`}
          style={{ marginRight: -3 }}
          onMouseDown={onHandleMouseDown}
        />
      )}
    </div>
  )
}
