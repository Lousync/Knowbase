import { useState, useEffect, useRef, useCallback } from 'react'
import { getSetting, setSetting } from '../../lib/ipc'

interface Props {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  visible: boolean
  className?: string
  children: React.ReactNode
}

export function ResizablePanel({ storageKey, defaultWidth, minWidth, maxWidth, visible, className = '', children }: Props) {
  const [width, setWidth] = useState(defaultWidth)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)
  const startWRef = useRef(0)

  // 加载持久化宽度
  useEffect(() => {
    getSetting(storageKey).then(v => {
      if (typeof v === 'number') setWidth(Math.max(minWidth, Math.min(maxWidth, v)))
    })
  }, [storageKey, minWidth, maxWidth])

  // 拖拽
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startXRef.current = e.clientX
    startWRef.current = width
    setDragging(true)
  }, [width])

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current
      const next = Math.max(minWidth, Math.min(maxWidth, startWRef.current + delta))
      setWidth(next)
    }
    const onUp = () => {
      setDragging(false)
      setSetting(storageKey, width)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, minWidth, maxWidth, width, storageKey])

  return (
    <div
      ref={panelRef}
      className={`shrink-0 relative flex flex-col bg-[#252526] border-r border-[#3c3c3c] transition-all duration-200 ease-out overflow-hidden ${className}`}
      style={{ width: visible ? width : 0, borderRightWidth: visible ? undefined : 0 }}
    >
      {visible && children}

      {/* 拖拽手柄 */}
      {visible && (
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize z-30 transition-colors ${dragging ? 'bg-[#007acc]' : 'hover:bg-[#007acc]'}`}
          onMouseDown={onMouseDown}
        />
      )}
    </div>
  )
}
