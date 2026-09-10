import { useState, useEffect, useRef, useCallback } from 'react'
import { getSettingRaw, setSettingRaw, resizeForSidebar } from '../../lib/ipc'

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
  /** 面板停靠方向：left（默认，手柄在右缘）/ right（手柄在左缘，拖拽方向镜像） */
  side?: 'left' | 'right'
  /** 折叠后保留的边条宽度 px。贴窗口边缘的面板建议 ≥12 以避开系统原生缩放热区 */
  collapsedWidth?: number
  /** 抽屉式窗口外扩：visible 翻转时窗口宽度同步 ±当前面板宽度，主内容不被挤压（最大化/全屏时主进程自动跳过） */
  growWindow?: boolean
  /** 面板实际占宽上报（px，折叠/卸载为 0）。供标题栏把搜索框等锚定在主内容区，外扩时不漂移 */
  onWidthChange?: (width: number) => void
}

export function ResizablePanel({ storageKey, defaultWidth, minWidth, maxWidth, visible, className = '', children, initialWidth, showHandle = true, onSnapClose, onSnapOpen, side = 'left', collapsedWidth = 4, growWindow = false, onWidthChange }: Props) {
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

  // 约束变化联动（如主窗口缩放导致 maxWidth 变小）→ 当前宽度超限时自动收窄
  useEffect(() => {
    const next = Math.max(minWidth, Math.min(maxWidth, widthRef.current))
    if (next !== widthRef.current) {
      widthRef.current = next
      setWidth(next)
    }
  }, [minWidth, maxWidth])

  // 抽屉式窗口外扩（绝对宽度协议）：上报面板期望宽度，0 = 收回。
  // 主进程以「打开时刻基准宽」为锚点计算，重复/乱序消息不会累积漂移。
  // 开合/卸载请求缓动动画（animate = !dragging），拖拽调宽传 false 即时跟随；
  // 卸载时收回（日程面板以卸载方式隐藏）。
  useEffect(() => {
    if (!growWindow) return
    void resizeForSidebar(visible ? widthRef.current : 0, !dragging)
  }, [growWindow, visible, width, dragging])
  useEffect(() => {
    return () => {
      if (growWindow) void resizeForSidebar(0, true)
    }
  }, [growWindow])

  // 面板实际占宽上报：经 ref 转发避免调用方内联回调导致重复触发
  const reportWidthRef = useRef(onWidthChange)
  reportWidthRef.current = onWidthChange
  useEffect(() => {
    reportWidthRef.current?.(visible ? width : 0)
  }, [visible, width])

  // mousedown on handle
  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startXRef.current = e.clientX
    startWRef.current = widthRef.current
    setDragging(true)
  }, [])

  // onSnapClose 经 ref 转发（2026-09-09 修）：调用方普遍传内联箭头函数，若直接进依赖数组，
  // 拖拽期间每次 setWidth 渲染都会 cleanup + 重注册 window 监听，顺带把 body.cursor 反复置空再设回
  // （cursor 闪烁），且局部 snapped 被重置。改为 ref 后监听器只在 dragging 翻转时绑定一次。
  const onSnapCloseRef = useRef(onSnapClose)
  onSnapCloseRef.current = onSnapClose

  // 全局拖拽事件（只在 dragging 切换时重新绑定）
  useEffect(() => {
    if (!dragging) return

    let snapped = false

    const onMove = (e: MouseEvent) => {
      if (snapped) return
      // right 侧面板：向左拖 = 变宽，方向镜像
      const delta = (e.clientX - startXRef.current) * (side === 'right' ? -1 : 1)
      const raw = startWRef.current + delta
      // VS Code snap-close: drag past half of minWidth → auto-collapse
      if (onSnapCloseRef.current && raw < minWidth * 0.5) {
        snapped = true
        setDragging(false)
        onSnapCloseRef.current()
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
  }, [dragging, minWidth, maxWidth, storageKey, side])
  // 注意：width 不在依赖中 — 用 widthRef 避免每次像素变化都重建监听器
  // onSnapClose 同理走 ref（见上），不进依赖

  // 折叠时重置为边条宽度（贴窗缘的面板用 collapsedWidth 避开系统缩放热区）
  const displayWidth = visible ? width : (onSnapOpen ? collapsedWidth : 0)

  // 从折叠状态拖拽以拉出侧边栏（right 侧：向左拖出）
  const onEdgeMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onSnapOpen) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    let opened = false

    const onMove = (ev: MouseEvent) => {
      if (opened) return
      const moved = side === 'right' ? startX - ev.clientX : ev.clientX - startX
      if (moved > minWidth * 0.5) {
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
  }, [minWidth, onSnapOpen, side])

  const isRight = side === 'right'
  return (
    <div
      ref={panelRef}
      className={`shrink-0 relative flex flex-col bg-[var(--bg-secondary)] overflow-hidden ${className}`}
      style={{
        width: displayWidth,
        transition: dragging ? 'none' : 'width 200ms ease-out'
      }}
    >
      {visible && children}

      {/* 折叠边缘分割条 — 悬停显示蓝色可拖拽条；支持拖拽拉出 + 单击兜底展开 */}
      {!visible && onSnapOpen && (
        <div
          className="absolute inset-0 z-30 group"
          style={{ cursor: 'col-resize' }}
          onMouseDown={onEdgeMouseDown}
          onClick={onSnapOpen}
          title="拖拽或点击展开"
        >
          <div className={`absolute top-0 bottom-0 ${isRight ? 'right-0' : 'left-0'} w-1 bg-[var(--accent)]/0 group-hover:bg-[var(--accent)]/60 transition-colors duration-150`} />
        </div>
      )}

      {/* 拖拽手柄 — 常显淡色、内贴覆盖分隔线位置（不外探，避免与 border-r 形成双线）；hover/拖拽变主题色 */}
      {visible && showHandle && (
        <div
          className={`absolute top-0 h-full w-0.5 z-30 transition-colors ${
            dragging ? 'bg-[var(--accent)] cursor-col-resize' : 'cursor-col-resize bg-[var(--border-color)] hover:bg-[var(--accent)]/40'
          }`}
          style={isRight ? { left: 0 } : { right: 0 }}
          onMouseDown={onHandleMouseDown}
        />
      )}
    </div>
  )
}
