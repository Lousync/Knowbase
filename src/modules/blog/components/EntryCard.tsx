import { Entry } from '../../../types'

interface EntryCardProps {
  entry: Entry
  onClick: () => void
}

export function EntryCard({ entry, onClick }: EntryCardProps) {
  const today = new Date().toISOString().split('T')[0]
  const isToday = entry.date === today

  const preview = entry.contentMd
    ?.replace(/[#*`~>[\]()!_\-|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || '暂无内容'

  return (
    <article
      onClick={onClick}
      className="group p-4 bg-[#2d2d2d] border border-[#3c3c3c] rounded-md cursor-pointer hover:border-[#007acc] transition-all"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-[#e0e0e0] leading-snug">
            {entry.date}
          </h3>
          {isToday && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#007acc] text-white">今天</span>
          )}
        </div>
        <span className="text-[11px] text-[#6a6a6a]">{entry.wordCount} 字</span>
      </div>
      <p className="text-[13px] text-[#969696] line-clamp-2 leading-relaxed">{preview}</p>
    </article>
  )
}
