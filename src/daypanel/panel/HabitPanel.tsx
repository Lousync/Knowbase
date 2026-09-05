import { useState } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import type { Habit } from '../../types'
import {
  currentStreak, longestStreak, totalCount, completionRate30d, weekDoneCount,
  formatLocalDate, type RecordIndex,
} from '../../modules/toolbox/components/habit-tracker/dateUtils'

interface Props {
  /** 全部习惯（内部过滤 archived） */
  habits: Habit[]
  /** 打卡记录索引（buildRecordIndex 结果，由父层持有保证双侧同源） */
  habitIndex: RecordIndex
  /** 今日计划中的习惯 */
  plannedHabits: Habit[]
  /** 今日已打卡数 */
  checkedToday: number
  onCheck: (h: Habit) => void
  todayDate: Date
  /** 在主窗口工具箱中管理 */
  onOpenInMain: () => void
}

/**
 * 侧边栏「打卡」Tab：完成度圆环 + 今日/统计 子视图。
 * 数据与工具箱习惯打卡完全同源（同一 habitGetAll / toggleHabitCheck IPC + data-changed 广播）。
 */
export function HabitPanel({ habits, habitIndex, plannedHabits, checkedToday, onCheck, todayDate, onOpenInMain }: Props) {
  const [sub, setSub] = useState<'today' | 'stats'>('today')
  const active = habits.filter(h => !h.archived)
  const plannedCount = plannedHabits.length
  const pct = plannedCount > 0 ? Math.round((checkedToday / plannedCount) * 100) : 100
  const bestStreak = active.reduce((m, h) => Math.max(m, longestStreak(h, habitIndex.get(h.id) ?? new Set(), todayDate)), 0)

  // 近 7 日（含今日）打卡迷你条
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate)
    d.setDate(d.getDate() - (6 - i))
    return formatLocalDate(d)
  })

  return (
    <div className="space-y-3">
      {/* 完成度圆环 */}
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-2.5">
        <div
          className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(var(--success) ${pct}%, var(--bg-tertiary) 0)` }}
        >
          <div className="absolute inset-[5px] rounded-full bg-[var(--bg-primary)]" />
          <span className="relative text-[12px] font-bold text-[var(--success)]">{checkedToday}/{plannedCount}</span>
        </div>
        <div className="text-[11px] leading-[1.7] text-[var(--text-muted)]">
          <b className="text-[12px] text-[var(--text-primary)]">今日打卡 {checkedToday} / {plannedCount}</b>
          <br />
          {plannedCount > 0 && checkedToday < plannedCount
            ? <>全勤再坚持 {plannedCount - checkedToday} 项{bestStreak > 0 && <> · 最佳连续 {bestStreak} 天 🔥</>}</>
            : <>今日打卡已完成{bestStreak > 0 && <> · 最佳连续 {bestStreak} 天 🔥</>}</>}
        </div>
      </div>

      {/* 今日 / 统计 子切换 */}
      <div>
        <div className="flex items-center justify-between gap-1 px-0.5">
          <div className="flex gap-0.5 rounded-lg bg-[var(--bg-tertiary)] p-0.5">
            {(['today', 'stats'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSub(s)}
                className={`rounded-md px-2.5 py-0.5 text-[10.5px] transition-colors ${
                  sub === s ? 'bg-[var(--bg-primary)] font-semibold text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'
                }`}
              >
                {s === 'today' ? '今日' : '统计'}
              </button>
            ))}
          </div>
          <button onClick={onOpenInMain} className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)]" title="在主窗口工具箱中管理">
            管理 <ExternalLink size={10} />
          </button>
        </div>

        {/* 今日：勾选列表 */}
        {sub === 'today' && (
          <div className="mt-1.5 space-y-0.5">
            {plannedHabits.map(h => {
              const done = habitIndex.get(h.id)?.has(formatLocalDate(todayDate)) ?? false
              const streak = currentStreak(h, habitIndex.get(h.id) ?? new Set(), todayDate)
              return (
                <div key={h.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-[var(--bg-hover)]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: h.color }} />
                  <span className="min-w-0 flex-1 truncate text-xs">{h.name}</span>
                  {/* 近 7 日迷你条 */}
                  <span className="flex shrink-0 gap-[2.5px]">
                    {weekDays.map(d => (
                      <i
                        key={d}
                        className={`h-3 w-[5px] rounded-sm ${habitIndex.get(h.id)?.has(d) ? 'opacity-75' : ''}`}
                        style={{ backgroundColor: habitIndex.get(h.id)?.has(d) ? 'var(--success)' : 'var(--bg-tertiary)' }}
                      />
                    ))}
                  </span>
                  {streak > 0 && <span className="shrink-0 text-[10.5px] text-[var(--text-muted)]">{streak}天</span>}
                  <button
                    onClick={() => onCheck(h)}
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                      done ? 'border-[var(--success)] bg-[var(--success)] text-white' : 'border-[var(--border-color)] hover:border-[var(--success)]'
                    }`}
                    title={done ? '取消打卡' : '打卡'}
                  >
                    {done && <Check size={12} strokeWidth={3} />}
                  </button>
                </div>
              )
            })}
            {plannedHabits.length === 0 && (
              <p className="px-1 py-2 text-xs text-[var(--text-muted)]">今天没有计划中的习惯</p>
            )}
          </div>
        )}

        {/* 统计：每习惯 2×2 指标卡（与工具箱 StatsView 同指标） */}
        {sub === 'stats' && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {active.map(h => {
              const done = habitIndex.get(h.id) ?? new Set<string>()
              const rate30 = completionRate30d(h, done, todayDate)
              const rateColor = rate30 >= 80 ? 'var(--success)' : rate30 < 40 ? 'var(--warning)' : 'var(--text-primary)'
              return (
                <div key={h.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-2">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold">
                    <i className="h-2 w-2 rounded-full" style={{ backgroundColor: h.color }} />
                    {h.name}
                    {h.ruleType === 'flexible' && (
                      <span className="text-[9.5px] font-normal text-[var(--text-muted)]">弹性 · 每周{h.weeklyTarget}次</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {h.ruleType === 'flexible' ? (
                      <StatCell label="🔥 本周" value={`${weekDoneCount(done, todayDate)}/${h.weeklyTarget}`}
                        color={weekDoneCount(done, todayDate) >= h.weeklyTarget ? 'var(--success)' : undefined} />
                    ) : (
                      <StatCell label="🔥 当前连续" value={`${currentStreak(h, done, todayDate)} 天`} color={currentStreak(h, done, todayDate) > 0 ? 'var(--accent)' : undefined} />
                    )}
                    <StatCell label="🏆 最长连续" value={`${longestStreak(h, done, todayDate)} 天`} />
                    <StatCell label="# 累计" value={`${totalCount(done)} 次`} />
                    <StatCell label="📈 近30天" value={`${rate30}%`} color={rateColor}
                      bar={rate30} barColor={h.color} />
                  </div>
                </div>
              )
            })}
            {active.length === 0 && (
              <p className="px-1 py-2 text-xs text-[var(--text-muted)]">创建习惯后这里会显示打卡统计</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCell({ label, value, color, bar, barColor }: {
  label: string; value: string; color?: string; bar?: number; barColor?: string
}) {
  return (
    <div className="rounded-lg bg-[var(--bg-primary)] px-2 py-1">
      <div className="text-[9.5px] text-[var(--text-muted)]">{label}</div>
      <div className="text-[12.5px] font-bold tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
      {bar !== undefined && (
        <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-[var(--bg-hover)]">
          <div className="h-full rounded-full" style={{ width: `${bar}%`, backgroundColor: barColor }} />
        </div>
      )}
    </div>
  )
}
