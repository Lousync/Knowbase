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
      className="group flex items-center justify-between px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-md cursor-pointer hover:border-[var(--accent)] transition-all"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[14px] font-medium text-[#e0e0e0]">
          {entry.date}
        </h3>
        {isToday && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)] text-white">今天</span>
        )}
      </div>
      <span className="text-[11px] text-[var(--text-muted)] shrink-0">{fmtShort(entry.updatedAt)}</span>
    </article>
  )
}

function fmtShort(dateStr: string): string {
  const d = new Date(dateStr)
  const now = Date.now()
  const diff = now - d.getTime()
  if (isNaN(diff)) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  if (days < 30) return `${Math.floor(days / 7)}周前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}月前`
  return d.toLocaleDateString('zh-CN')
}
