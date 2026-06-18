import { useState, useEffect } from 'react'
import { Minus, Square, X, Copy, Pin } from 'lucide-react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [isPinned, setIsPinned] = useState(false)

  useEffect(() => {
    window.api?.isMaximized()?.then(setIsMaximized)
    window.api?.isAlwaysOnTop()?.then(setIsPinned)
    window.api?.onMaximizeChange?.((v: boolean) => setIsMaximized(v))
  }, [])

  function togglePin() {
    const next = !isPinned
    setIsPinned(next)
    window.api?.setAlwaysOnTop(next)
  }

  return (
    <div
      className="flex items-center justify-between h-9 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)] select-none shrink-0 drag-region"
    >
      {/* drag region spacer */}
      <div className="flex-1" />

      {/* 窗口控制按钮 */}
      <div className="flex h-full no-drag">
          <WinBtn onClick={togglePin} title={isPinned ? '取消置顶' : '窗口置顶'}>
            <Pin size={14} strokeWidth={1.5} fill={isPinned ? 'var(--text-primary)' : 'transparent'} />
          </WinBtn>
          <WinBtn onClick={() => window.api?.minimize()} title="最小化"><Minus size={16} strokeWidth={1.5} /></WinBtn>
          <WinBtn onClick={() => window.api?.maximize()} title={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? <Copy size={14} strokeWidth={1.5} /> : <Square size={14} strokeWidth={1.5} />}
          </WinBtn>
          <WinBtn onClick={() => window.api?.close()} title="关闭" isClose>
            <X size={16} strokeWidth={1.5} />
          </WinBtn>
        </div>
    </div>
  )
}

function WinBtn({ children, onClick, title, isClose }: {
  children: React.ReactNode; onClick: () => void; title?: string; isClose?: boolean
}) {
  return (
    <button onClick={onClick} title={title}
      className={`flex items-center justify-center w-11 h-full transition-colors duration-100 ${isClose ? 'text-[var(--text-primary)] hover:bg-[var(--danger)] hover:text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}>
      {children}
    </button>
  )
}
