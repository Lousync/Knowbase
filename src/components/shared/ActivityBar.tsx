import { useState, useRef, useEffect } from 'react'
import type { TabName } from '../../types'
import { FileText, Calendar, BookOpen, Upload, Settings } from 'lucide-react'

const tabs: { id: TabName; label: string; icon: React.ReactNode }[] = [
  { id: 'blog', label: '博客', icon: <FileText size={28} strokeWidth={1.5} /> },
  { id: 'schedule', label: '日程', icon: <Calendar size={28} strokeWidth={1.5} /> },
  { id: 'knowledge', label: '知识库', icon: <BookOpen size={28} strokeWidth={1.5} /> },
  { id: 'export', label: '导出', icon: <Upload size={28} strokeWidth={1.5} /> }
]

interface Props {
  active: TabName
  onChange: (tab: TabName) => void
  onToggleSidebar?: () => void
  showLineNumbers?: boolean
  onToggleLineNumbers?: () => void
  zoomReset?: () => void
}

export function ActivityBar({ active, onChange, onToggleSidebar, showLineNumbers, onToggleLineNumbers, zoomReset }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="w-14 bg-[#333] border-r border-[#3c3c3c] flex flex-col items-center py-2 gap-1 shrink-0 select-none">
      {/* 模块 Tab 按钮 */}
      {tabs.map(tab => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => {
              if (isActive && onToggleSidebar) {
                onToggleSidebar()
              } else {
                onChange(tab.id)
              }
            }}
            title={tab.label}
            className={`
              w-14 h-14 flex items-center justify-center relative transition-colors
              ${isActive ? 'text-white' : 'text-[#858585] hover:text-[#cccccc]'}
            `}
          >
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-white rounded-r" />
            )}
            {tab.icon}
          </button>
        )
      })}

      {/* 底部设置按钮（VS Code 风格） */}
      <div className="mt-auto relative" ref={menuRef}>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-14 h-14 flex items-center justify-center text-[#858585] hover:text-[#cccccc] transition-colors"
          title="设置"
        >
          <Settings size={28} strokeWidth={1.5} />
        </button>

        {settingsOpen && (
          <div className="absolute left-full bottom-0 ml-1 w-44 bg-[#252526] border border-[#3c3c3c] rounded shadow-xl py-1 z-50">
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
    </div>
  )
}
