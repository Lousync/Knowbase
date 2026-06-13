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
  const today = new Date().toISOString().split('T')[0]
  const hasToday = entries.some(e => e.date === today)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3 text-[var(--text-muted)]">
          <div className="w-8 h-8 border-2 border-[var(--border-color)] border-t-[#007acc] rounded-full animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    )
  }

  // 按日期分组
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-primary)]">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            文章归档 {sorted.length > 0 ? `(${sorted.length})` : ''}
          </h2>
          {!hasToday && (
            <button onClick={onNewEntry} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--accent)] hover:bg-[#007acc15] rounded transition-colors">
              <Plus size={15} /> 新建
            </button>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
            <FileText size={48} className="mb-4 text-[var(--input-bg)]" />
            <p className="text-base mb-1">还没有文章</p>
            <p className="text-sm mb-5">点击下方按钮，记录今天的日记</p>
            <button onClick={onNewEntry} className="flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-white text-sm rounded hover:bg-[var(--accent-hover)] transition-colors">
              <Plus size={16} />
              今日文章编写
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map(entry => (
              <EntryCard key={entry.id} entry={entry} onClick={() => onEntryClick(entry)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
