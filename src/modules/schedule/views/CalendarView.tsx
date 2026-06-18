import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid, Clock, CalendarDays, Layers } from 'lucide-react'

export type ViewMode = 'date' | 'deadline' | 'quadrant'

interface Props {
  year: number
  month: number
  selectedDate: string | null
  dotDates: Set<string>
  deadlineCounts: Map<string, number>
  viewMode: ViewMode
  onSelectDate: (date: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onViewModeChange: (mode: ViewMode) => void
  onQuadrantChart: () => void
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const VIEW_MODES: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'date', label: '按日期', icon: <CalendarDays size={13} /> },
  { id: 'deadline', label: '按截止', icon: <Clock size={13} /> },
  { id: 'quadrant', label: '按象限', icon: <Layers size={13} /> },
]

function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return ''
  const now = new Date()
  const td = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const diff = Math.round((target.getTime() - td.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  if (diff === 1) return '明天'
  if (diff < -1) return `${Math.abs(diff)}天前`
  return `${diff}天后`
}

export function CalendarView({ year, month, selectedDate, dotDates, deadlineCounts, viewMode, onSelectDate, onPrevMonth, onNextMonth, onToday, onViewModeChange, onQuadrantChart }: Props) {
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

  const timeLabel = selectedDate ? relativeTime(selectedDate) : ''

  return (
    <div className="w-full shrink-0 bg-[var(--bg-secondary)] flex flex-col select-none">
      {/* header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] space-y-2">
        <div className="flex items-center justify-between">
          <button onClick={onPrevMonth} className="p-1 hover:bg-[var(--input-bg)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ChevronLeft size={16} />
          </button>
          <span className="text-[14px] font-medium text-[var(--text-primary)]">{year}年 {MONTHS[month - 1]}</span>
          <button onClick={onNextMonth} className="p-1 hover:bg-[var(--input-bg)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          onClick={onToday}
          className="w-full text-[12px] py-1 bg-[var(--input-bg)] text-[var(--text-primary)] rounded hover:bg-[#4a4a4a] transition-colors"
        >
          今天
        </button>

        {/* relative time hint */}
        {timeLabel && (
          <div className="text-center text-[11px] text-[var(--text-muted)]">{timeLabel}</div>
        )}

        {/* view mode buttons */}
        <div className="flex gap-1">
          {VIEW_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => onViewModeChange(m.id)}
              title={m.label}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] transition-colors ${
                viewMode === m.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
              }`}
            >
              {m.icon}
            </button>
          ))}
        </div>

        {/* quadrant chart button */}
        <button
          onClick={onQuadrantChart}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] py-1.5 border border-dashed border-[#4a4a4a] text-[var(--text-secondary)] rounded hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
        >
          <LayoutGrid size={13} />
          查看象限图
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
                <span className={`absolute bottom-0.5 right-0.5 text-[9px] font-bold leading-none ${isSelected ? 'text-white' : 'text-[#d16969]'}`}>
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
