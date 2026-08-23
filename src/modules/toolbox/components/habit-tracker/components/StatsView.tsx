import { useMemo } from 'react'
import { Flame, Trophy, Hash, TrendingUp, Inbox } from 'lucide-react'
import type { Habit, HabitRecord } from '../../../../../types'
import { buildRecordIndex, currentStreak, longestStreak, weekDoneCount, completionRate30d, totalCount } from '../dateUtils'

interface Props {
  habits: Habit[]
  records: HabitRecord[]
}

export function StatsView({ habits, records }: Props) {
  const active = habits.filter(h => !h.archived)
  const idx = useMemo(() => buildRecordIndex(records), [records])

  const rows = useMemo(() => active.map(h => {
    const done = idx.get(h.id) ?? new Set<string>()
    return {
      habit: h,
      cur: currentStreak(h, done),
      longest: longestStreak(h, done),
      total: totalCount(done),
      rate30: completionRate30d(h, done),
      weekN: weekDoneCount(done),
    }
  }), [active, idx])

  return (
    <div className="max-w-2xl mx-auto px-6 py-5">
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">统计</h2>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Inbox size={28} className="text-[var(--text-muted)] opacity-50" />
          <p className="text-[13px] text-[var(--text-muted)] mt-3">创建习惯后这里会显示打卡统计</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map(r => (
            <div key={r.habit.id} className="border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)] p-3.5">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.habit.color }} />
                <span className="text-[14px] font-medium text-[var(--text-primary)]">{r.habit.name}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {r.habit.ruleType === 'flexible' ? (
                  <Stat icon={<Flame size={13} />} label="本周"
                    value={`${r.weekN}/${r.habit.weeklyTarget}`}
                    color={r.weekN >= r.habit.weeklyTarget ? 'var(--success)' : 'var(--text-primary)'} />
                ) : (
                  <Stat icon={<Flame size={13} />} label="当前连续" value={`${r.cur} 天`} color={r.cur > 0 ? 'var(--accent)' : undefined} />
                )}
                <Stat icon={<Trophy size={13} />} label="最长连续" value={r.habit.ruleType === 'flexible' ? '—' : `${r.longest} 天`} />
                <Stat icon={<Hash size={13} />} label="累计" value={`${r.total} 次`} />
                <Stat
                  icon={<TrendingUp size={13} />}
                  label="近30天"
                  value={`${r.rate30}%`}
                  color={r.rate30 >= 80 ? 'var(--success)' : r.rate30 < 40 ? 'var(--warning)' : undefined}
                  bar={r.rate30}
                  barColor={r.habit.color}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value, color, bar, barColor }: {
  icon: React.ReactNode; label: string; value: string; color?: string
  bar?: number; barColor?: string
}) {
  return (
    <div className="rounded bg-[var(--bg-primary)] px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] mb-0.5">
        {icon}{label}
      </div>
      <div className="text-[14px] font-semibold tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
      {bar !== undefined && (
        <div className="h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden mt-1.5">
          <div className="h-full rounded-full transition-all" style={{ width: `${bar}%`, backgroundColor: barColor }} />
        </div>
      )}
    </div>
  )
}
