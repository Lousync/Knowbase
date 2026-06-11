import { Entry } from '../../../types'
import { TagBadge } from '../../../components/shared'
import { Pin } from 'lucide-react'

interface EntryCardProps {
  entry: Entry
  onClick: () => void
}

export function EntryCard({ entry, onClick }: EntryCardProps) {
  const preview = entry.contentMd
    ?.replace(/[#*`~>[\]()!_\-|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '暂无内容'

  return (
    <article
      onClick={onClick}
      className="group p-4 bg-[#2d2d2d] border border-[#3c3c3c] rounded-md cursor-pointer hover:border-[#007acc] transition-all"
    >
      <div className="flex items-start gap-2 mb-1.5">
        {entry.isPinned && <Pin size={14} className="text-amber-500 shrink-0 mt-0.5" />}
        <h3 className="text-[15px] font-semibold text-[#e0e0e0] leading-snug line-clamp-1">
          {entry.title || '无标题'}
        </h3>
      </div>
      <p className="text-[13px] text-[#969696] line-clamp-2 mb-2.5 leading-relaxed">{preview}</p>
      <div className="flex items-center gap-3 text-[11px] text-[#6a6a6a]">
        <span>{entry.date}</span><span>{entry.wordCount} 字</span>
        {entry.tags?.slice(0, 3).map(t => (
          <span key={t.id} className="flex items-center gap-1">
            <TagBadge color={t.color} size="sm" />{t.name}
          </span>
        ))}
      </div>
    </article>
  )
}
