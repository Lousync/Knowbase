import type { TabName } from '../../types'
import { FileText, Calendar, BookOpen, Download } from 'lucide-react'

const tabs: { id: TabName; label: string; icon: React.ReactNode }[] = [
  { id: 'blog', label: '博客', icon: <FileText size={22} strokeWidth={1.5} /> },
  { id: 'schedule', label: '日程', icon: <Calendar size={22} strokeWidth={1.5} /> },
  { id: 'knowledge', label: '知识库', icon: <BookOpen size={22} strokeWidth={1.5} /> },
  { id: 'export', label: '导出', icon: <Download size={22} strokeWidth={1.5} /> }
]

interface Props {
  active: TabName
  onChange: (tab: TabName) => void
  onToggleSidebar?: () => void
}

export function ActivityBar({ active, onChange, onToggleSidebar }: Props) {
  return (
    <div className="w-12 bg-[#333] border-r border-[#3c3c3c] flex flex-col items-center py-2 gap-0 shrink-0 select-none">
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
              w-12 h-12 flex items-center justify-center relative transition-colors
              ${isActive ? 'text-white' : 'text-[#858585] hover:text-[#cccccc]'}
            `}
          >
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-white rounded-r" />
            )}
            {tab.icon}
          </button>
        )
      })}
    </div>
  )
}
