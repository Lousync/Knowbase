import { useState } from 'react'
import { Entry } from '../../../types'
import { Edit3, ChevronRight, ChevronDown, FileText, Plus } from 'lucide-react'

interface SidebarProps {
  entries: Entry[]
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
  onNewEntry: () => void
  onCustomDate: (date: string) => void
}

type DayNode = { date: string; hasContent: boolean }
type MonthMap = Record<string, DayNode[]>
type YearMap = Record<string, MonthMap>

const MONTH_NAMES: Record<string, string> = {
  '01': '一月', '02': '二月', '03': '三月', '04': '四月',
  '05': '五月', '06': '六月', '07': '七月', '08': '八月',
  '09': '九月', '10': '十月', '11': '十一月', '12': '十二月'
}

function buildTree(entries: Entry[]): YearMap {
  const tree: YearMap = {}
  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.date)) continue
    seen.add(e.date)
    const [y, m] = e.date.split('-')
    if (!tree[y]) tree[y] = {}
    if (!tree[y][m]) tree[y][m] = []
    tree[y][m].push({ date: e.date, hasContent: e.contentMd.length > 0 })
  }
  for (const y of Object.values(tree)) {
    for (const m of Object.values(y)) m.sort((a, b) => b.date.localeCompare(a.date))
  }
  return tree
}

export function Sidebar({ entries, selectedDate, onSelectDate, onNewEntry, onCustomDate }: SidebarProps) {
  const tree = buildTree(entries)
  const years = Object.keys(tree).sort((a, b) => b.localeCompare(a))
  const today = new Date().toISOString().split('T')[0]
  const hasToday = entries.some(e => e.date === today)

  const thisYear = new Date().getFullYear().toString()
  const thisMonth = (new Date().getMonth() + 1).toString().padStart(2, '0')

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>()
    s.add(thisYear)
    s.add(`${thisYear}-${thisMonth}`)
    return s
  })

  const toggle = (key: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  return (
    <aside className="w-full bg-[var(--bg-secondary)] flex flex-col h-full shrink-0 overflow-x-hidden">
      <div className="px-4 py-4 border-b border-[var(--border-color)]">
        <h1 className="text-sm font-semibold text-[var(--text-primary)] select-none">📝 博客</h1>
      </div>

      {/* 今日按钮：文案按是否有文章切换 */}
      <div className="px-3 py-3 space-y-2">
        <button
          onClick={onNewEntry}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-[var(--accent)] text-white text-sm rounded hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Edit3 size={15} />
          {hasToday ? '继续编写' : '今日文章编写'}
        </button>

        {/* 指定日期创建 / 打开 */}
        <div className="flex items-center gap-1">
          <input
            type="date"
            value=""
            onChange={e => { if (e.target.value) onCustomDate(e.target.value) }}
            className="flex-1 bg-[var(--input-bg)] border border-[var(--border-color)] rounded px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <span className="text-[10px] text-[var(--text-muted)] shrink-0">补写</span>
        </div>
      </div>

      {/* 树状归档 */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1">
        <div className="px-3 py-2 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          文章归档
        </div>

        {years.length === 0 && (
          <p className="px-3 py-4 text-[12px] text-[var(--text-muted)] text-center">暂无文章</p>
        )}

        {years.map(year => {
          const yearOpen = expanded.has(year)
          const months = Object.keys(tree[year]).sort((a, b) => b.localeCompare(a))

          return (
            <div key={year}>
              <button onClick={() => toggle(year)}
                className="w-full flex items-center gap-1 px-2 py-1.5 text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
                {yearOpen
                  ? <ChevronDown size={18} className="text-[#888] shrink-0" />
                  : <ChevronRight size={18} className="text-[#888] shrink-0" />}
                <span className="font-semibold">{year} 年</span>
              </button>

              {yearOpen && months.map(month => {
                const mk = `${year}-${month}`
                const mOpen = expanded.has(mk)
                const days = tree[year][month]

                return (
                  <div key={mk} className="ml-3">
                    <button onClick={() => toggle(mk)}
                      className="w-full flex items-center gap-1 px-2 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
                      {mOpen
                        ? <ChevronDown size={18} className="text-[#888] shrink-0" />
                        : <ChevronRight size={18} className="text-[#888] shrink-0" />}
                      <span>{MONTH_NAMES[month] || `${month}月`}</span>
                    </button>

                    {mOpen && days.map(day => (
                      <button key={day.date}
                        onClick={() => onSelectDate(day.date === selectedDate ? null : day.date)}
                        className={`w-full flex items-center gap-2 ml-5 px-2 py-1 text-[13px] rounded transition-colors ${
                          selectedDate === day.date
                            ? 'bg-[#37373d] text-white'
                            : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}>
                        <FileText size={14} className={`shrink-0 ${day.hasContent ? 'text-[#888]' : 'text-[#444]'}`} />
                        <span>{day.date.slice(-2)} 日</span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
