import { Entry } from '../../../types'
import { EntryCard } from '../components/EntryCard'
import { Plus, FileText } from 'lucide-react'

interface EntryListProps {
  entries: Entry[]
  loading: boolean
  onEntryClick: (entry: Entry) => void
  onNewEntry: () => void
}

export function EntryList({ entries, loading, onEntryClick, onNewEntry }: EntryListProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#1e1e1e]">
        <div className="flex flex-col items-center gap-3 text-[#6a6a6a]">
          <div className="w-8 h-8 border-2 border-[#3c3c3c] border-t-[#007acc] rounded-full animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#1e1e1e]">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-[#cccccc] uppercase tracking-wider">
            博文列表 {entries.length > 0 ? `(${entries.length})` : ''}
          </h2>
          {entries.length > 0 && (
            <button onClick={onNewEntry} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[#007acc] hover:bg-[#007acc15] rounded transition-colors">
              <Plus size={15} /> 新建
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#6a6a6a]">
            <FileText size={48} className="mb-4 text-[#3c3c3c]" />
            <p className="text-base mb-1">还没有博文</p>
            <p className="text-sm mb-5">点击下方按钮，开始记录你的第一篇日记</p>
            <button onClick={onNewEntry} className="flex items-center gap-2 px-5 py-2.5 bg-[#007acc] text-white text-sm rounded hover:bg-[#1a8ad4] transition-colors">
              <Plus size={16} /> 创建第一篇博文
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => (
              <EntryCard key={entry.id} entry={entry} onClick={() => onEntryClick(entry)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
