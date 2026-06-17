import { useState, useMemo, useEffect, useRef } from 'react'
import { Entry } from '../../../types'
import { Edit3, ChevronRight, ChevronDown, FileText, Search } from 'lucide-react'
import { showToast } from '../../../lib/toast'

interface SidebarProps {
  entries: Entry[]
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
  onNewEntry: () => void
}

type DayNode = { date: string; hasContent: boolean }
type MonthMap = Record<string, DayNode[]>
type YearMap = Record<string, MonthMap>

const MONTH_NAMES: Record<string, string> = {
  '01': '一月', '02': '二月', '03': '三月', '04': '四月',
  '05': '五月', '06': '六月', '07': '七月', '08': '八月',
  '09': '九月', '10': '十月', '11': '十一月', '12': '十二月'
}

const EARLIEST_DATE = '2005-12-21'

function buildTree(entries: Entry[], today: string, thisYear: string, thisMonth: string): YearMap {
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

  // Fill empty days for current month (1 .. today)
  const todayDay = parseInt(today.slice(-2), 10)
  for (let d = 1; d <= todayDay; d++) {
    const date = `${thisYear}-${thisMonth}-${String(d).padStart(2, '0')}`
    if (seen.has(date)) continue
    if (!tree[thisYear]) tree[thisYear] = {}
    if (!tree[thisYear][thisMonth]) tree[thisYear][thisMonth] = []
    tree[thisYear][thisMonth].push({ date, hasContent: false })
  }

  for (const y of Object.values(tree)) {
    for (const m of Object.values(y)) m.sort((a, b) => b.date.localeCompare(a.date))
  }
  return tree
}

/** Parse search input — supports xxxx/xx/xx, xxxx-xx-xx, or partial */
function parseSearchDate(raw: string): { year?: string; month?: string; day?: string } | null {
  const s = raw.trim()
  if (!s) return null

  // Full date: 2025/06/17 or 2025-06-17
  const full = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
  if (full) return { year: full[1], month: full[2].padStart(2, '0'), day: full[3].padStart(2, '0') }

  // Year-Month: 2025/06 or 2025-06
  const ym = s.match(/^(\d{4})[\/\-](\d{1,2})$/)
  if (ym) return { year: ym[1], month: ym[2].padStart(2, '0') }

  // Year only: 2025
  const y = s.match(/^(\d{4})$/)
  if (y) return { year: y[1] }

  // Month-Day: 06/17 or 6/17
  const md = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/)
  if (md) return { month: md[1].padStart(2, '0'), day: md[2].padStart(2, '0') }

  // Just digits — substring match
  if (/^\d+$/.test(s)) return {}

  return {}
}

/** Given a partial search result and the tree, expand what's needed and build display items */
function computeSearchResults(
  tree: YearMap,
  parsed: ReturnType<typeof parseSearchDate>,
  existingYears: string[],
  searchRaw: string,
) {
  if (!parsed) return null

  const { year, month, day } = parsed

  // If we have a full date, show that specific day
  if (year && month && day) {
    const date = `${year}-${month}-${day}`
    return {
      years: [year],
      months: { [year]: [month] },
      days: { [`${year}-${month}`]: [{ date, hasContent: !!(tree[year]?.[month]?.find(d => d.date === date)) }] },
    }
  }

  // Year-Month: only if the year exists in tree
  if (year && month) {
    if (!tree[year]?.[month]) return null
    const mk = `${year}-${month}`
    return { years: [year], months: { [year]: [month] }, days: { [mk]: [...tree[year][month]] } }
  }

  // Year only: only if the year exists in tree
  if (year) {
    if (!tree[year]) return null
    const months = Object.keys(tree[year]).sort((a, b) => b.localeCompare(a))
    const days: Record<string, DayNode[]> = {}
    for (const m of months) days[`${year}-${m}`] = tree[year][m]
    return { years: [year], months: { [year]: months }, days }
  }

  // Just a substring — filter all dates in tree
  if (parsed && Object.keys(parsed).length === 0) {
    const matchedYears = new Set<string>()
    const monthsByYear: Record<string, string[]> = {}
    const daysByMonth: Record<string, DayNode[]> = {}

    for (const y of existingYears) {
      const ms = Object.keys(tree[y] || {})
      for (const m of ms) {
        const filtered = (tree[y]?.[m] || []).filter(d => d.date.includes(searchRaw))
        if (filtered.length > 0) {
          matchedYears.add(y)
          if (!monthsByYear[y]) monthsByYear[y] = []
          monthsByYear[y].push(m)
          daysByMonth[`${y}-${m}`] = filtered
        }
      }
    }
    if (matchedYears.size === 0) return null
    return {
      years: [...matchedYears].sort((a, b) => b.localeCompare(a)),
      months: monthsByYear,
      days: daysByMonth,
    }
  }

  return null
}

export function Sidebar({ entries, selectedDate, onSelectDate, onNewEntry }: SidebarProps) {
  const today = new Date().toISOString().split('T')[0]
  const thisYear = new Date().getFullYear().toString()
  const thisMonth = (new Date().getMonth() + 1).toString().padStart(2, '0')
  const hasToday = entries.some(e => e.date === today)

  const [searchQuery, setSearchQuery] = useState('')
  const activeSearch = searchQuery.trim().length > 0

  const tree = useMemo(() => buildTree(entries, today, thisYear, thisMonth), [entries, today])

  const existingYears = Object.keys(tree).sort((a, b) => b.localeCompare(a))

  const parsed = useMemo(() => parseSearchDate(searchQuery.trim()), [searchQuery])
  const searchResults = useMemo(
    () => activeSearch ? computeSearchResults(tree, parsed, existingYears, searchQuery.trim()) : null,
    [activeSearch, tree, parsed, existingYears, searchQuery],
  )

  const effectiveYears = searchResults ? searchResults.years : existingYears

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>()
    s.add(thisYear)
    s.add(`${thisYear}-${thisMonth}`)
    return s
  })

  const toggle = (key: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // When search just activates (idle → active), auto-expand matching years/months ONCE.
  // Subsequent keystrokes leave expand/collapse control to the user.
  const expandedOnceRef = useRef(false)
  useEffect(() => {
    if (!activeSearch) {
      expandedOnceRef.current = false
      return
    }
    if (expandedOnceRef.current || !searchResults) return
    expandedOnceRef.current = true
    setExpanded(prev => {
      const n = new Set(prev)
      for (const y of searchResults.years) {
        n.add(y)
        const ms = searchResults.months[y] || []
        for (const m of ms) n.add(`${y}-${m}`)
      }
      return n
    })
  }, [activeSearch, searchResults])

  const handleSelectDateSafe = (date: string) => {
    if (date < EARLIEST_DATE) {
      showToast({
        type: 'warning',
        message: '日期太早，暂不支持此日期之前的日志补写。',
        detail: 'shortcuts',
      })
      return
    }
    // Allow future dates that already have an entry (even if empty),
    // only block empty future dates that would trigger auto-creation.
    const exists = entries.some(e => e.date === date)
    if (date > today && !exists) {
      showToast({
        type: 'warning',
        message: '不能创建未来日期的日志。',
        detail: 'shortcuts',
      })
      return
    }
    onSelectDate(date === selectedDate ? null : date)
  }

  return (
    <aside className="w-full bg-[var(--bg-secondary)] flex flex-col h-full shrink-0 overflow-x-hidden">
      <div className="px-4 py-4 border-b border-[var(--border-color)]">
        <h1 className="text-sm font-semibold text-[var(--text-primary)] select-none">📝 博客</h1>
      </div>

      {/* 今日按钮 */}
      <div className="px-3 py-3">
        <button
          onClick={onNewEntry}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-[var(--accent)] text-white text-sm rounded hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Edit3 size={15} />
          {hasToday ? '继续编写' : '今日文章编写'}
        </button>
      </div>

      {/* 树状归档 */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 flex flex-col">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            文章归档
          </span>
          {activeSearch && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)]"
            >清除</button>
          )}
        </div>

        {/* 日期搜索 */}
        <div className="px-2 pb-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索日期 (xxxx/xx/xx)"
              className="w-full pl-7 pr-2 py-1 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
            />
          </div>
        </div>

        {effectiveYears.length === 0 && !activeSearch && (
          <p className="px-3 py-4 text-[12px] text-[var(--text-muted)] text-center">暂无文章</p>
        )}
        {activeSearch && searchResults === null && (
          <p className="px-3 py-4 text-[12px] text-[var(--text-muted)] text-center">未找到匹配的日期</p>
        )}

        {effectiveYears.map(year => {
          const yearOpen = expanded.has(year)
          const months =
            searchResults?.months[year]
            ?? Object.keys(tree[year] || {}).sort((a, b) => b.localeCompare(a))

          if (!months || months.length === 0) return null

          return (
            <div key={year}>
              <button onClick={() => toggle(year)}
                className="w-full flex items-center gap-1 px-2 py-1.5 text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
                {yearOpen
                  ? <ChevronDown size={18} className="text-[#888] shrink-0" />
                  : <ChevronRight size={18} className="text-[#888] shrink-0" />}
                <span className="font-semibold">{year} 年</span>
                <span className="text-[10px] text-[var(--text-disabled)] ml-1">
                  {searchResults ? '搜索' : ''}
                </span>
              </button>

              {yearOpen && months.map(month => {
                const mk = `${year}-${month}`
                const mOpen = expanded.has(mk)
                const days = searchResults?.days[mk] ?? tree[year]?.[month] ?? []

                return (
                  <div key={mk} className="ml-3">
                    <button onClick={() => toggle(mk)}
                      className="w-full flex items-center gap-1 px-2 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
                      {mOpen
                        ? <ChevronDown size={18} className="text-[#888] shrink-0" />
                        : <ChevronRight size={18} className="text-[#888] shrink-0" />}
                      <span>{MONTH_NAMES[month] || `${month}月`}</span>
                      <span className="text-[10px] text-[var(--text-muted)] ml-1">
                        {days.filter(d => d.hasContent).length || ''}
                      </span>
                    </button>

                    {mOpen && days.map(day => (
                      <button key={day.date}
                        onClick={() => handleSelectDateSafe(day.date)}
                        className={`w-full flex items-center gap-2 ml-5 px-2 py-1 text-[13px] rounded transition-colors ${
                          selectedDate === day.date
                            ? 'bg-[#37373d] text-white'
                            : day.hasContent
                              ? 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                              : 'text-[var(--text-disabled)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                        }`}>
                        <FileText size={14} className={`shrink-0 ${day.hasContent ? 'text-[#888]' : 'text-[#444]'}`} />
                        <span>{day.date.slice(-2)} 日</span>
                        {!day.hasContent && (
                          <span className="text-[9px] text-[var(--text-disabled)] ml-auto">+</span>
                        )}
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
