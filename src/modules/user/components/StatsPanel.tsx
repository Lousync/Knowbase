import type { UserStats } from '../../../types'

interface Props {
  stats: UserStats | null
}

export function StatsPanel({ stats }: Props) {
  if (!stats) return null

  const items: { icon: string; label: string; value: number | string; unit?: string }[] = [
    { icon: '📝', label: '博客文章', value: stats.blogCount, unit: '篇' },
    { icon: '📅', label: '日程待办', value: stats.scheduleTodos, unit: '条' },
    { icon: '📚', label: '知识页面', value: stats.knowledgePages, unit: '页' },
    { icon: '📁', label: '分类目录', value: stats.totalCategories, unit: '个' },
    { icon: '🔥', label: '连续记录', value: stats.consecutiveDays, unit: '天' },
    { icon: '✏️', label: '总字数', value: stats.totalWords.toLocaleString(), unit: '字' },
  ]

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">使用统计</h3>
      <div className="grid grid-cols-2 gap-2">
        {items.map(item => (
          <div key={item.label}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)]"
          >
            <span className="text-[18px]">{item.icon}</span>
            <div className="flex flex-col">
              <span className="text-[11px] text-[var(--text-muted)]">{item.label}</span>
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">
                {item.value}<span className="text-[11px] text-[var(--text-muted)] ml-0.5">{item.unit}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
