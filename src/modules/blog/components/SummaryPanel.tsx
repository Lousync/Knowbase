import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ScheduleTodo } from '../../../types'
import {
  getBlogPeriodStats,
  getScheduleTags, createScheduleTag, createScheduleTodo, getScheduleTodos,
} from '../../../lib/ipc'
import type { PeriodStats } from '../../../lib/ipc'
import { getSummaryWindow, type PeriodWindow, type MonthlyMode, SUMMARY_TAG_DEFS } from '../../../lib/summary'
import { useSettings } from '../../../lib/SettingsContext'

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 周/月总结附页 —— 以"文档最后一节"的姿态渲染在 Markdown 内容之后，
 * 排版与正文一致（同宽、同字号、分隔线分节），而非悬浮工具条。
 *
 * 总结窗口实时跟随设置:周期总结日/模式在设置里改动后,已打开的面板立即按新窗口
 * 重新计算并重拉统计,不存在"第一版写死"(stats 每次窗口变化都重新查询,绝不落库)。
 */
export function SummaryPanel({ date }: { date: string }) {
  const { s, ready: cfgLoaded } = useSettings()
  const weeklyDay = Number(s.summaryWeeklyDay ?? 0)
  const monthlyMode = (s.summaryMonthlyMode as MonthlyMode) || 'last'
  const monthlyFixedDay = Number(s.summaryMonthlyFixedDay ?? 1)

  const [stats, setStats] = useState<PeriodStats | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [tasks, setTasks] = useState<ScheduleTodo[]>([])
  const [adding, setAdding] = useState(false)

  // 计算当前日期命中的总结窗口(设置变更即重算)
  const win: PeriodWindow | null = useMemo(
    () => (cfgLoaded && date ? getSummaryWindow(date, weeklyDay, monthlyMode, monthlyFixedDay) : null),
    [cfgLoaded, date, weeklyDay, monthlyMode, monthlyFixedDay]
  )

  // 拉取区间统计(窗口变化即清空旧值,绝不展示上个窗口的数字)
  useEffect(() => {
    if (!win) { setStats(null); return }
    let alive = true
    setStats(null)
    void getBlogPeriodStats(win.start, win.end)
      .then(s => { if (alive) setStats(s) })
      .catch(console.error)
    return () => { alive = false }
  }, [win])

  // 确保联动标签（周任务/月任务）存在，并拉取下期日期已有的关联任务
  useEffect(() => {
    if (!win) return
    let alive = true
    const def = SUMMARY_TAG_DEFS[win.type]
    void (async () => {
      try {
        let tags = await getScheduleTags()
        let tag = tags.find(t => t.name === def.name)
        if (!tag) tag = await createScheduleTag(def.name, def.color)
        if (!alive || !tag) return
        const todos = await getScheduleTodos(win.nextDate)
        if (alive) setTasks(todos.filter(t => t.tagId === tag!.id))
      } catch (e) { console.error(e) }
    })()
    return () => { alive = false }
  }, [win])

  const addTask = useCallback(async () => {
    const title = taskTitle.trim()
    if (!title || !win || adding) return
    setAdding(true)
    try {
      const def = SUMMARY_TAG_DEFS[win.type]
      let tags = await getScheduleTags()
      let tag = tags.find(t => t.name === def.name)
      if (!tag) tag = await createScheduleTag(def.name, def.color)
      await createScheduleTodo({
        title,
        date: win.nextDate,
        taskType: 'plan',
        tagId: tag.id,
        description: `来自${win.type === 'week' ? '周' : '月'}总结（${date}），细节可在日程模块补充`,
      })
      setTaskTitle('')
      const todos = await getScheduleTodos(win.nextDate)
      setTasks(todos.filter(t => t.tagId === tag.id))
    } catch (e) {
      console.error(e)
    } finally {
      setAdding(false)
    }
  }, [taskTitle, win, adding, date])

  if (!win) return null

  const statRows: { label: string; value: string }[] = [
    { label: '坚持打卡', value: `${stats?.checkins ?? '…'} 次` },
    { label: '博客文章', value: `${stats?.blogEntries ?? '…'} 篇` },
    { label: '新建知识页', value: `${stats?.knowledgePages ?? '…'} 个` },
    { label: '番茄钟专注', value: `${stats?.pomodoroMinutes ?? '…'} 分钟` },
    { label: '完成日程任务', value: `${stats?.scheduleDone ?? '…'} 项` },
  ]

  return (
    <div className="mt-12 pt-8 border-t border-[var(--border-color)]">
      {/* 节标题（与正文 h2 同级观感） */}
      <h2 className="text-[22px] font-bold text-[var(--text-primary)]">
        📊 {win.label}
      </h2>

      {/* 统计：仿 markdown 两列表格 */}
      <div className="mt-4 border-y border-[var(--border-color)] divide-y divide-[var(--border-color)]">
        {statRows.map(r => (
          <div key={r.label} className="flex items-baseline justify-between py-2.5 text-[15px] leading-7">
            <span className="text-[var(--text-secondary)]">{r.label}</span>
            <span className="font-semibold text-[var(--text-primary)] tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>

      {/* 下期任务 */}
      <h3 className="mt-8 mb-1 text-[17px] font-semibold text-[var(--text-primary)]">
        下{win.type === 'week' ? '一周' : '一个月'}的任务
      </h3>
      <p className="text-[12px] text-[var(--text-muted)]">
        落在 {win.nextDate} · 自动同步到「日程」模块并带「{SUMMARY_TAG_DEFS[win.type].name}」标签，细节可在那边继续编辑
      </p>

      <ul className="mt-3 space-y-0.5">
        {tasks.map(t => (
          <li key={t.id} className="flex items-baseline gap-2.5 py-1.5 text-[15px] leading-7">
            <span className={'shrink-0 select-none ' + (t.status === 'done' ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
              {t.status === 'done' ? '☑' : '☐'}
            </span>
            <span className={'flex-1 min-w-0 break-words ' + (t.status === 'done' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]')}>
              {t.title}
            </span>
          </li>
        ))}
      </ul>

      {/* 内联添加：无框输入，像在文档里续写一行 */}
      <div className="flex items-center gap-2.5 py-1.5 mt-1 group">
        <span className="shrink-0 select-none text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition-colors">➕</span>
        <input
          value={taskTitle}
          onChange={e => setTaskTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void addTask() }}
          placeholder="添加一条下期任务，回车确认（只记大概即可）"
          maxLength={60}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[15px] leading-7 text-[var(--text-primary)] placeholder:text-[var(--text-disabled)]"
        />
        {taskTitle.trim() && (
          <button
            onClick={() => void addTask()}
            disabled={adding}
            className="shrink-0 px-2.5 py-1 rounded-md bg-[var(--accent)] text-white text-[11px] hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
          >
            添加
          </button>
        )}
      </div>
    </div>
  )
}
