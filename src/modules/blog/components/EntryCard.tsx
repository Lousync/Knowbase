import { Entry } from '../../../types'

interface EntryCardProps {
  entry: Entry
  onClick: () => void
}

export function EntryCard({ entry, onClick }: EntryCardProps) {
  const today = new Date().toISOString().split('T')[0]
  const isToday = entry.date === today

  return (
    <article
      onClick={onClick}
      className="group flex items-center justify-between px-4 py-3 bg-[#2d2d2d] border border-[#3c3c3c] rounded-md cursor-pointer hover:border-[#007acc] transition-all"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[14px] font-medium text-[#e0e0e0]">
          {entry.date}
        </h3>
        {isToday && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#007acc] text-white">今天</span>
        )}
      </div>
      <span className="text-[11px] text-[#6a6a6a] shrink-0">{entry.wordCount} 字</span>
    </article>
  )
}
