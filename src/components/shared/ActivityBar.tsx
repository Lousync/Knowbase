import { useState, useRef, useEffect } from 'react'
import type { TabName } from '../../types'
import { FileText, Calendar, BookOpen, Upload, Trash2, Download, Settings } from 'lucide-react'
import { SettingsDropdown } from '../../modules/settings/components/SettingsDropdown'

const tabs: { id: TabName; label: string; icon: React.ReactNode }[] = [
  { id: 'blog', label: '博客', icon: <FileText size={28} strokeWidth={1.5} /> },
  { id: 'schedule', label: '日程', icon: <Calendar size={28} strokeWidth={1.5} /> },
  { id: 'knowledge', label: '知识库', icon: <BookOpen size={28} strokeWidth={1.5} /> },
  { id: 'export', label: '导出', icon: <Upload size={28} strokeWidth={1.5} /> },
  { id: 'recycle', label: '回收站', icon: <Trash2 size={28} strokeWidth={1.5} /> },
]

interface Props {
  active: TabName
  onChange: (tab: TabName) => void
  onToggleSidebar?: () => void
}

export function ActivityBar({ active, onChange, onToggleSidebar }: Props) {
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
    <div className="w-14 bg-[#333] border-r border-[var(--border-color)] flex flex-col items-center py-2 gap-1 shrink-0 select-none">
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
              ${isActive ? 'text-white' : 'text-[#858585] hover:text-[var(--text-primary)]'}
            `}
          >
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-white rounded-r" />
            )}
            {tab.icon}
          </button>
        )
      })}

      {/* 导入按钮（未来用户模块占位） */}
      <div className="mt-auto">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-import-modal'))}
          className="w-14 h-14 flex items-center justify-center text-[#858585] hover:text-[var(--text-primary)] transition-colors"
          title="导入数据"
        >
          <Download size={28} strokeWidth={1.5} />
        </button>
      </div>

      {/* 设置按钮 */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setSettingsOpen(v => !v)}
          className="w-14 h-14 flex items-center justify-center text-[#858585] hover:text-[var(--text-primary)] transition-colors"
          title="设置"
        >
          <Settings size={28} strokeWidth={1.5} />
        </button>

        {settingsOpen && (
          <div className="absolute left-full bottom-0 ml-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50">
            <SettingsDropdown />
          </div>
        )}
      </div>
    </div>
  )
}
