import { Tag } from '../../../types'
import { SearchBar, TagBadge } from '../../../components/shared'
import { Plus, List, RefreshCw } from 'lucide-react'

interface SidebarProps {
  tags: Tag[]
  activeTagId: string | null
  onSelectTag: (tagId: string | null) => void
  onNewEntry: () => void
  onRefresh: () => void
}

export function Sidebar({ tags, activeTagId, onSelectTag, onNewEntry, onRefresh }: SidebarProps) {
  return (
    <aside className="w-56 bg-[#252526] border-r border-[#3c3c3c] flex flex-col h-full shrink-0">
      {/* 模块标题 */}
      <div className="px-4 py-4 border-b border-[#3c3c3c]">
        <h1 className="text-sm font-semibold text-[#cccccc] select-none">📝 博客</h1>
      </div>

      {/* 新建按钮 */}
      <div className="px-3 py-3">
        <button
          onClick={onNewEntry}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-[#007acc] text-white text-sm rounded hover:bg-[#1a8ad4] transition-colors"
        >
          <Plus size={15} /> 新建博文
        </button>
      </div>

      {/* 搜索 */}
      <div className="px-3 pb-2">
        <SearchBar />
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto px-2 py-1">
        <button
          onClick={() => onSelectTag(null)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[13px] rounded mb-0.5 transition-colors ${activeTagId === null ? 'bg-[#37373d] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'}`}
        >
          <List size={15} /> 全部博文
        </button>

        {tags.length > 0 && (
          <>
            <div className="px-3 py-2 text-[11px] font-semibold text-[#6a6a6a] uppercase tracking-wider">标签</div>
            {tags.map(tag => (
              <button
                key={tag.id}
                onClick={() => onSelectTag(tag.id === activeTagId ? null : tag.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[13px] rounded mb-0.5 transition-colors ${activeTagId === tag.id ? 'bg-[#37373d] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'}`}
              >
                <TagBadge name={tag.name} color={tag.color} size="sm" />
                {tag.name}
              </button>
            ))}
          </>
        )}
      </nav>

      {/* 刷新 */}
      <div className="px-3 py-2 border-t border-[#3c3c3c]">
        <button onClick={onRefresh} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs text-[#6a6a6a] hover:text-[#cccccc] hover:bg-[#2a2d2e] rounded transition-colors">
          <RefreshCw size={13} /> 刷新
        </button>
      </div>
    </aside>
  )
}
