import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ViewMode } from '../types'

export type { ViewMode }

/**
 * 侧栏月历（日期锚点）。
 *
 * 视图切换与象限图入口原先在这里，现已上移到模块顶栏（见 components/ViewSwitcher）——
 * 因为「周日程」视图下侧栏整体换成「待安排」栏，入口留在侧栏会随视图一起消失。
 */
interface Props {
  year: number
  month: number
  selectedDate: string | null
  dotDates: Set<string>
  deadlineCounts: Map<string, number>
  onSelectDate: (date: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function CalendarView({ year, month, selectedDate, dotDates, deadlineCounts, onSelectDate, onPrevMonth, onNextMonth, onToday }: Props) {
  const today = localToday()

  const weeks = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)
    const startDow = firstDay.getDay()
    const totalDays = lastDay.getDate()

    const cells: (number | null)[] = []
    const pad = startDow === 0 ? 6 : startDow - 1
    for (let i = 0; i < pad; i++) cells.push(null)
    for (let d = 1; d <= totalDays; d++) cells.push(d)

    const weeks: (number | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    return weeks
  }, [year, month])

  function dateStr(day: number) {
    const m = String(month).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return `${year}-${m}-${d}`
  }

  return (
    <div className="w-full shrink-0 bg-[var(--bg-secondary)] flex flex-col select-none">
      {/* header：月份导航 + 今天（视图切换已上移到模块顶栏） */}
      <div className="flex items-center gap-0.5 px-1.5 pt-1 pb-1 border-b border-[var(--border-color)]">
        <button onClick={onPrevMonth} title="上个月" className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronLeft size={14} />
        </button>
        <span className="flex-1 min-w-0 truncate text-center text-[12px] font-medium text-[var(--text-primary)] select-none">{year}年 {MONTHS[month - 1]}</span>
        <button onClick={onNextMonth} title="下个月" className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronRight size={14} />
        </button>
        <button
          onClick={onToday}
          title="回到今天"
          className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          今天
        </button>
      </div>

      {/* weekday headers */}
      <div className="grid grid-cols-7 px-1 py-1.5">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[11px] text-[var(--text-muted)] leading-6">{d}</div>
        ))}
      </div>

      {/* days grid */}
      <div className="grid grid-cols-7 px-1">
        {weeks.flat().map((day, i) => {
          if (day === null) return <div key={`e${i}`} className="aspect-square" />

          const ds = dateStr(day)
          const isToday = ds === today
          const isSelected = ds === selectedDate
          const hasData = dotDates.has(ds)
          const deadlineNum = deadlineCounts.get(ds) ?? 0

          return (
            <button
              key={ds}
              onClick={() => onSelectDate(ds)}
              className={`
                aspect-square flex flex-col items-center justify-center rounded text-[13px] relative transition-colors
                ${isSelected ? 'bg-[var(--accent)] text-white' : isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-primary)] hover:bg-[var(--input-bg)]'}
              `}
            >
              {day}
              {hasData && !isSelected && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-[var(--accent)]" />
              )}
              {deadlineNum > 0 && (
                <span className={`absolute bottom-0.5 right-0.5 text-[9px] font-bold leading-none ${isSelected ? 'text-white' : 'text-[var(--danger)]'}`}>
                  {deadlineNum}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
