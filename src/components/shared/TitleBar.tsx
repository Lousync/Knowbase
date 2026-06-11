import { useState, useEffect, useRef } from 'react'
import { Minus, Square, X, Copy, Settings } from 'lucide-react'

interface Props {
  onToggleLineNumbers?: () => void
  showLineNumbers?: boolean
  zoomReset?: () => void
}

export function TitleBar({ onToggleLineNumbers, showLineNumbers, zoomReset }: Props) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api?.isMaximized()?.then(setIsMaximized)
    window.api?.onMaximizeChange?.((v: boolean) => setIsMaximized(v))
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
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
        {/* 设置按钮 */}
        <div className="relative no-drag" ref={menuRef}>
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="flex items-center justify-center w-9 h-full text-[#cccccc] hover:bg-[#3e3e3e] transition-colors"
            title="设置"
          >
            <Settings size={15} strokeWidth={1.5} />
          </button>

          {settingsOpen && (
            <div className="absolute right-0 top-full mt-0 w-48 bg-[#252526] border border-[#3c3c3c] rounded shadow-xl py-1 z-50">
              <div className="px-3 py-1.5 text-[11px] text-[#6a6a6a] uppercase tracking-wider">设置</div>
              <label className="flex items-center justify-between px-3 py-1.5 hover:bg-[#2a2d2e] cursor-pointer">
                <span className="text-[13px] text-[#cccccc]">显示行号</span>
                <input
                  type="checkbox"
                  checked={showLineNumbers ?? false}
                  onChange={onToggleLineNumbers}
                  className="accent-[#007acc]"
                />
              </label>
              <div className="border-t border-[#3c3c3c] mt-1 pt-1">
                <button
                  onClick={() => zoomReset?.()}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-[#cccccc] hover:bg-[#2a2d2e]"
                >
                  重置缩放
                </button>
              </div>
            </div>
          )}
        </div>

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
