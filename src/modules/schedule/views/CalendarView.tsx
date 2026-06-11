import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react'

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
  onQuadrantChart: () => void
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

function relativeTime(dateStr: string): string {
  if (!dateStr) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  if (diff === 1) return '明天'
  if (diff < -1) return `${Math.abs(diff)}天前`
  return `${diff}天后`
}

export function CalendarView({ year, month, selectedDate, dotDates, deadlineCounts, onSelectDate, onPrevMonth, onNextMonth, onToday, onQuadrantChart }: Props) {
  const today = new Date().toISOString().split('T')[0]

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
    <div className="w-[280px] shrink-0 bg-[#252526] border-r border-[#3c3c3c] flex flex-col select-none">
      {/* header */}
      <div className="px-4 py-3 border-b border-[#3c3c3c] space-y-2">
        <div className="flex items-center justify-between">
          <button onClick={onPrevMonth} className="p-1 hover:bg-[#3c3c3c] rounded text-[#969696] hover:text-[#cccccc]">
            <ChevronLeft size={16} />
          </button>
          <span className="text-[14px] font-medium text-[#cccccc]">{year}年 {MONTHS[month - 1]}</span>
          <button onClick={onNextMonth} className="p-1 hover:bg-[#3c3c3c] rounded text-[#969696] hover:text-[#cccccc]">
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          onClick={onToday}
          className="w-full text-[12px] py-1 bg-[#3c3c3c] text-[#cccccc] rounded hover:bg-[#4a4a4a] transition-colors"
        >
          今天
        </button>

        {/* relative time hint */}
        {timeLabel && (
          <div className="text-center text-[11px] text-[#6a6a6a]">{timeLabel}</div>
        )}

        {/* quadrant chart button */}
        <button
          onClick={onQuadrantChart}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] py-1.5 border border-dashed border-[#4a4a4a] text-[#969696] rounded hover:border-[#007acc] hover:text-[#cccccc] transition-colors"
        >
          <LayoutGrid size={13} />
          查看象限图
        </button>
      </div>

      {/* weekday headers */}
      <div className="grid grid-cols-7 px-1 py-1.5">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[11px] text-[#6a6a6a] leading-6">{d}</div>
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
                ${isSelected ? 'bg-[#007acc] text-white' : isToday ? 'text-[#007acc] font-bold' : 'text-[#cccccc] hover:bg-[#3c3c3c]'}
              `}
            >
              {day}
              {hasData && !isSelected && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-[#007acc]" />
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
