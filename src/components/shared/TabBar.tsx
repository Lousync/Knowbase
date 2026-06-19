import type { TabName } from '../../types'
import { FileText, Calendar, BookOpen, Download, Wrench } from 'lucide-react'

const tabs: { id: TabName; label: string; icon: React.ReactNode }[] = [
  { id: 'blog', label: '博客', icon: <FileText size={15} /> },
  { id: 'schedule', label: '日程', icon: <Calendar size={15} /> },
  { id: 'knowledge', label: '知识库', icon: <BookOpen size={15} /> },
  { id: 'toolbox', label: '工具箱', icon: <Wrench size={15} /> },
  { id: 'export', label: '导出', icon: <Download size={15} /> }
]

interface TabBarProps {
  activeTab: TabName
  onChange: (tab: TabName) => void
}

export function TabBar({ activeTab, onChange }: TabBarProps) {
  return (
    <div className="flex items-center h-9 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] select-none shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            flex items-center gap-1.5 h-full px-4 text-[13px]
            border-b-2 transition-colors duration-100
            ${activeTab === tab.id
              ? 'text-[#ffffff] border-[var(--accent)] bg-[var(--bg-primary)]'
              : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
            }
          `}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}
