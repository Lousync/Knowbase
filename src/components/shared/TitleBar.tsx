import { useState, useEffect } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api?.isMaximized()?.then(setIsMaximized)
    window.api?.onMaximizeChange?.((v: boolean) => setIsMaximized(v))
  }, [])

  return (
    <div
      className="flex items-center justify-between h-9 bg-[#2d2d2d] border-b border-[#3c3c3c] select-none shrink-0 drag-region"
    >
      <div className="flex items-center gap-2 px-3 text-sm text-[#cccccc]">
        <span className="text-base">📝</span>
        <span className="font-medium text-[13px]">KnowledgeRecorder</span>
      </div>

      <div className="flex items-center h-full">
        {/* 窗口控制按钮 */}
        <div className="flex h-full no-drag">
          <WinBtn onClick={() => window.api?.minimize()} title="最小化"><Minus size={16} strokeWidth={1.5} /></WinBtn>
          <WinBtn onClick={() => window.api?.maximize()} title={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? <Copy size={14} strokeWidth={1.5} /> : <Square size={14} strokeWidth={1.5} />}
          </WinBtn>
          <WinBtn onClick={() => window.api?.close()} title="关闭" isClose>
            <X size={16} strokeWidth={1.5} />
          </WinBtn>
        </div>
      </div>
    </div>
  )
}

function WinBtn({ children, onClick, title, isClose }: {
  children: React.ReactNode; onClick: () => void; title?: string; isClose?: boolean
}) {
  return (
    <button onClick={onClick} title={title}
      className={`flex items-center justify-center w-11 h-full transition-colors duration-100 ${isClose ? 'text-[#cccccc] hover:bg-[#e81123] hover:text-white' : 'text-[#cccccc] hover:bg-[#3e3e3e]'}`}>
      {children}
    </button>
  )
}
