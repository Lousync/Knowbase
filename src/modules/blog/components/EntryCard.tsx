import { Entry } from '../../../types'

interface EntryCardProps {
  entry: Entry
  onClick: () => void
  size?: 's' | 'm' | 'l'
}

const SIZE_MAP = {
  s: { py: 'py-1', px: 'px-3', title: 'text-[12px]', meta: 'text-[10px]', gap: 'gap-2' },
  m: { py: 'py-3', px: 'px-4', title: 'text-[14px]', meta: 'text-[11px]', gap: 'gap-2' },
  l: { py: 'py-4', px: 'px-5', title: 'text-[16px]', meta: 'text-[12px]', gap: 'gap-3' },
}

export function EntryCard({ entry, onClick, size = 'm' }: EntryCardProps) {
  const today = new Date().toISOString().split('T')[0]
  const isToday = entry.date === today
  const sz = SIZE_MAP[size]

  const tags = entry.tags || []
  const states = entry.states?.split(',').filter(Boolean) || []

  return (
    <article
      onClick={onClick}
      className={`group flex items-center justify-between ${sz.px} ${sz.py} bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-md cursor-pointer hover:border-[var(--accent)] transition-all`}
    >
      <div className={`flex items-center ${sz.gap} min-w-0`}>
        {/* Date */}
        <h3 className={`${sz.title} font-medium text-[#e0e0e0] shrink-0`}>
          {entry.date.slice(-5)}
        </h3>

        {/* States (emojis) */}
        {states.length > 0 && (
          <span className="shrink-0 text-[16px]">{states.join('')}</span>
        )}

        {/* Today badge */}
        {isToday && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)] text-white shrink-0">今天</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1">
            {tags.slice(0, 3).map(t => (
              <span key={t.id}
                className={`${sz.meta} px-1 rounded shrink-0 max-w-[80px] truncate`}
                style={{ backgroundColor: t.color + '20', color: t.color }}
              >
                {t.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className={`${sz.meta} text-[var(--text-muted)]`}>+{tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Modified time */}
        <span className={`${sz.meta} text-[var(--text-muted)] shrink-0`}>{fmtShort(entry.updatedAt)}</span>
      </div>
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
