import { useState, useEffect } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api.isMaximized().then(setIsMaximized)
    window.api.onMaximizeChange(setMax => setIsMaximized(setMax))
  }, [])

  return (
    <div
      className="flex items-center justify-between h-9 bg-[#2d2d2d] border-b border-[#3c3c3c] select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：应用标题（拖拽区域） */}
      <div className="flex items-center gap-2 px-3 text-sm text-[#cccccc]">
        <span className="text-base">📝</span>
        <span className="font-medium text-[13px]">KnowledgeRecorder</span>
      </div>

      {/* 右侧：窗口控制按钮（不可拖拽） */}
      <div
        className="flex h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <WindowButton onClick={() => window.api.minimize()} title="最小化">
          <Minus size={16} strokeWidth={1.5} />
        </WindowButton>
        <WindowButton onClick={() => window.api.maximize()} title={isMaximized ? '还原' : '最大化'}>
          {isMaximized ? (
            <Copy size={14} strokeWidth={1.5} />
          ) : (
            <Square size={14} strokeWidth={1.5} />
          )}
        </WindowButton>
        <WindowButton onClick={() => window.api.close()} title="关闭" isClose>
          <X size={16} strokeWidth={1.5} />
        </WindowButton>
      </div>
    </div>
  )
}

function WindowButton({
  children,
  onClick,
  title,
  isClose = false
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  isClose?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`
        flex items-center justify-center w-11 h-full
        transition-colors duration-100
        ${isClose
          ? 'text-[#cccccc] hover:bg-[#e81123] hover:text-white'
          : 'text-[#cccccc] hover:bg-[#3e3e3e]'
        }
      `}
    >
      {children}
    </button>
  )
}
