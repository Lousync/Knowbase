import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GripHorizontal, X, Pin, PinOff, Check, Pencil, Trash2, CalendarClock,
  Plus, ChevronRight, ChevronDown, ExternalLink, CalendarDays, Clock, Magnet,
} from 'lucide-react'
import type { ScheduleTodo, Habit, HabitRecord } from '../types'
import { localToday, formatEntryDate } from '../lib/date'
import {
  getScheduleTodos, getScheduleMonthTodos, getScheduleSubtasks,
  createScheduleTodo, updateScheduleTodo, deleteScheduleTodo,
  habitGetAll, createHabit, toggleHabitCheck,
} from '../lib/ipc'
import { notifyDataChanged, useDataChanged } from '../lib/dataChanged'
import { parseQuickDate } from './parseQuickDate'
import { isPlannedOn, currentStreak, buildRecordIndex, formatLocalDate } from '../modules/toolbox/components/habit-tracker/dateUtils'

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 拖拽区域 inline style（Tailwind 无此工具类） */
const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * 日程与打卡小窗（独立 BrowserWindow，#/day-panel 路由）
 * 逾期置顶红分组 → 今日任务（子任务展开一级）→ 快速添加（轻量时间解析）→ 今日打卡
 */
export function DayPanel() {
  const todayStr = localToday()
  const todayDate = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [todayStr])

  const [todos, setTodos] = useState<ScheduleTodo[]>([])          // 今日（含子任务行）
  const [overdue, setOverdue] = useState<ScheduleTodo[]>([])      // 逾期未完成（顶层）
  const [habits, setHabits] = useState<Habit[]>([])
  const [records, setRecords] = useState<HabitRecord[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expandedRef = useRef<Set<string>>(new Set())
  const [subtasks, setSubtasks] = useState<Record<string, ScheduleTodo[]>>({})
  const [editing, setEditing] = useState<{ id: string; title: string; date: string; time: string } | null>(null)
  const [quick, setQuick] = useState('')
  const [newHabit, setNewHabit] = useState('')
  const [docked, setDocked] = useState(true)

  // ---- 磁吸气泡：自由摆放拖近主窗口 → 透明气泡提示；吸附完成 → 短暂「已吸附」反馈 ----
  const [snapNear, setSnapNear] = useState(false)
  const [snapDone, setSnapDone] = useState(false)
  useEffect(() => {
    const offHint = window.api?.onDayPanelSnapHint?.(({ near }) => setSnapNear(near))
    const offSnap = window.api?.onDayPanelSnapChanged?.(({ docked: d }) => {
      setDocked(d)
      setSnapNear(false)
      setSnapDone(true)
      setTimeout(() => setSnapDone(false), 900)
    })
    return () => { offHint?.(); offSnap?.() }
  }, [])

  const load = useCallback(async () => {
    const today = localToday()
    const ym = today.slice(0, 7)
    try {
      const [todayList, cur, prev, habitData] = await Promise.all([
        getScheduleTodos(today),
        getScheduleMonthTodos(ym),
        getScheduleMonthTodos(prevMonth(ym)),
        habitGetAll(),
      ])
      setTodos(todayList)
      const od = [...prev, ...cur]
        .filter(t => t.date < today && t.status === 'pending' && !t.parentId)
        .sort((a, b) => a.date.localeCompare(b.date))
      setOverdue(od)
      setHabits(habitData.habits ?? [])
      setRecords(habitData.records ?? [])
      // 已展开的父任务重新拉取子任务（数据可能已变化）
      for (const pid of expandedRef.current) {
        void getScheduleSubtasks(pid).then(subs => {
          setSubtasks(m => ({ ...m, [pid]: subs }))
        }).catch(() => { /* ignore */ })
      }
    } catch (e) {
      console.error('[DayPanel] 加载失败', e)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useDataChanged('schedule', load)
  useDataChanged('habit', load)

  // 主进程自动打卡（跨模块联动/定时）→ 小窗同步刷新打卡区
  useEffect(() => {
    window.api?.onHabitAutoChecked?.(() => { void load() })
  }, [load])

  // 小窗获得焦点时刷新吸附状态（用户拖离后自动解除，按钮图标需同步）
  useEffect(() => {
    const onFocus = () => {
      window.api?.dayPanelGetState?.().then(st => setDocked(!!st?.docked)).catch(() => {})
    }
    void onFocus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const topTodos = useMemo(() => todos.filter(t => !t.parentId), [todos])
  const pendingCount = topTodos.filter(t => t.status === 'pending').length
  const doneCount = topTodos.filter(t => t.status === 'done').length

  const parsed = useMemo(() => parseQuickDate(quick, todayDate), [quick, todayDate])

  // ---- 打卡派生数据 ----
  const habitIndex = useMemo(() => buildRecordIndex(records), [records])
  const plannedHabits = useMemo(
    () => habits.filter(h => !h.archived && isPlannedOn(h, todayDate)),
    [habits, todayDate],
  )
  const checkedToday = useMemo(
    () => plannedHabits.filter(h => habitIndex.get(h.id)?.has(todayStr)).length,
    [plannedHabits, habitIndex, todayStr],
  )

  // ---- 操作 ----
  const toggleStatus = useCallback(async (t: ScheduleTodo) => {
    const next = t.status === 'done' ? 'pending' : 'done'
    setTodos(cur => cur.map(x => (x.id === t.id ? { ...x, status: next } : x)))
    setOverdue(cur => cur.map(x => (x.id === t.id ? { ...x, status: next } : x)))
    try {
      await updateScheduleTodo(t.id, { status: next })
      notifyDataChanged('schedule')
    } finally {
      void load()
    }
  }, [load])

  const moveToToday = useCallback(async (id: string) => {
    await updateScheduleTodo(id, { date: localToday() })
    notifyDataChanged('schedule')
    void load()
  }, [load])

  const removeTodo = useCallback(async (t: ScheduleTodo) => {
    if (!window.confirm(`删除任务「${t.title}」？`)) return
    await deleteScheduleTodo(t.id)
    notifyDataChanged('schedule')
    void load()
  }, [load])

  const saveEdit = useCallback(async () => {
    if (!editing) return
    const title = editing.title.trim()
    if (!title) { setEditing(null); return }
    await updateScheduleTodo(editing.id, { title, date: editing.date, time: editing.time || null })
    setEditing(null)
    notifyDataChanged('schedule')
    void load()
  }, [editing, load])

  const toggleExpand = useCallback(async (pid: string) => {
    const next = new Set(expandedRef.current)
    if (next.has(pid)) next.delete(pid)
    else next.add(pid)
    expandedRef.current = next
    setExpanded(next)
    try {
      const subs = await getScheduleSubtasks(pid)
      setSubtasks(m => ({ ...m, [pid]: subs }))
    } catch { /* ignore */ }
  }, [])

  const addQuick = useCallback(async () => {
    const title = parsed.title.trim()
    if (!title) return
    try {
      await createScheduleTodo({ title, date: parsed.date, time: parsed.time ?? undefined, taskType: 'plan' })
      setQuick('')
      notifyDataChanged('schedule')
      void load()
    } catch (e) {
      console.error('[DayPanel] 快速添加失败', e)
    }
  }, [parsed, load])

  const addHabit = useCallback(async () => {
    const name = newHabit.trim()
    if (!name) return
    try {
      await createHabit({ name })
      setNewHabit('')
      notifyDataChanged('habit')
      void load()
    } catch (e) {
      console.error('[DayPanel] 新增习惯失败', e)
    }
  }, [newHabit, load])

  const checkHabit = useCallback(async (h: Habit) => {
    try {
      await toggleHabitCheck(h.id, todayStr)
      notifyDataChanged('habit')
      void load()
    } catch (e) {
      console.error('[DayPanel] 打卡失败', e)
    }
  }, [todayStr, load])

  const openInMain = useCallback((tab: string) => {
    window.api?.dayPanelOpenInMain?.(tab)
  }, [])

  // ---- 行渲染 ----
  function taskRow(t: ScheduleTodo, isOverdue: boolean) {
    const done = t.status === 'done'
    const isParent = !t.parentId
    const hasChevron = isParent
    const isEditing = editing?.id === t.id
    return (
      <div key={t.id}>
        <div className="group flex items-center gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-[var(--bg-hover)]">
          {hasChevron ? (
            <button
              onClick={() => void toggleExpand(t.id)}
              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="展开/收起子任务"
            >
              {expanded.has(t.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <button
            onClick={() => void toggleStatus(t)}
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
              done ? 'border-[var(--success)] bg-[var(--success)] text-white' : 'border-[var(--border-color)] hover:border-[var(--text-secondary)]'
            }`}
            title={done ? '标记未完成' : '标记完成'}
          >
            {done && <Check size={10} strokeWidth={3} />}
          </button>
          <span className={`flex-1 truncate text-xs ${done ? 'text-[var(--text-muted)] line-through' : ''} ${isOverdue && !done ? 'text-[var(--danger)]' : ''}`}>
            {t.title}
          </span>
          {isOverdue && !done && (
            <button
              onClick={() => void moveToToday(t.id)}
              className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] group-hover:block"
              title="改到今天"
            >
              <CalendarClock size={12} />
            </button>
          )}
          <button
            onClick={() => setEditing({ id: t.id, title: t.title, date: t.date, time: t.time ?? '' })}
            className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] group-hover:block"
            title="编辑"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => void removeTodo(t)}
            className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] group-hover:block"
            title="删除"
          >
            <Trash2 size={12} />
          </button>
          {t.time && <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{t.time}</span>}
          {t.tag && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.tag.color }} title={t.tag.name} />}
        </div>
        {isEditing && editing && (
          <div className="mx-1.5 mb-1 space-y-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <input
              autoFocus
              value={editing.title}
              onChange={e => setEditing({ ...editing, title: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null) }}
              className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
              placeholder="任务标题"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={editing.date}
                onChange={e => setEditing({ ...editing, date: e.target.value })}
                className="min-w-0 flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
              />
              <input
                type="time"
                value={editing.time}
                onChange={e => setEditing({ ...editing, time: e.target.value })}
                className="min-w-0 w-24 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
              />
              <button onClick={() => void saveEdit()} className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:opacity-90">保存</button>
              <button onClick={() => setEditing(null)} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">取消</button>
            </div>
          </div>
        )}
        {hasChevron && expanded.has(t.id) && (
          <div className="ml-6 border-l border-[var(--border-color)] pl-1.5">
            {(subtasks[t.id] ?? []).map(sub => (
              <div key={sub.id} className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-[var(--bg-hover)]">
                <button
                  onClick={() => void toggleStatus(sub)}
                  className={`flex h-3 w-3 shrink-0 items-center justify-center rounded border transition-colors ${
                    sub.status === 'done' ? 'border-[var(--success)] bg-[var(--success)] text-white' : 'border-[var(--border-color)]'
                  }`}
                >
                  {sub.status === 'done' && <Check size={8} strokeWidth={3} />}
                </button>
                <span className={`flex-1 truncate text-[11px] ${sub.status === 'done' ? 'text-[var(--text-muted)] line-through' : ''}`}>
                  {sub.title}
                </span>
                <button
                  onClick={() => void removeTodo(sub)}
                  className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] group-hover:block"
                  title="删除"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {(subtasks[t.id] ?? []).length === 0 && (
              <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">无子任务</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] select-none">
      {/* 磁吸气泡（贴左缘中间，半透明 + 毛玻璃；拖近主窗口时出现，吸附完成短暂展示） */}
      <div
        className="pointer-events-none absolute left-1 top-1/2 z-50 flex items-center gap-1.5 rounded-xl border border-[var(--accent)]/40 px-2.5 py-1.5 text-xs"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg-primary) 74%, transparent)',
          backdropFilter: 'blur(6px)',
          color: snapNear ? 'var(--accent)' : 'var(--text-primary)',
          opacity: snapNear || snapDone ? 1 : 0,
          transform: `translateY(-50%) translateX(${snapNear || snapDone ? 6 : 0}px) scale(${snapNear || snapDone ? 1 : 0.9})`,
          transition: 'opacity 0.18s ease, transform 0.18s ease',
        }}
      >
        {snapNear ? <Magnet size={13} /> : <Check size={13} className="text-[var(--success)]" />}
        {snapNear ? '松手吸附到主窗口' : '已吸附'}
      </div>
      {/* 表头：拖拽区（按住移动窗口） */}
      <div
        className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3"
        style={dragRegion}
      >
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <GripHorizontal size={14} className="text-[var(--text-muted)]" />
          日程与打卡
        </div>
        <div className="flex items-center gap-0.5" style={noDrag}>
          <button
            onClick={() => { void window.api?.dayPanelDock?.(); setDocked(true) }}
            className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title={docked ? '已吸附主窗口右缘（拖动表头可移开）' : '吸附回主窗口右缘'}
          >
            {docked ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button
            onClick={() => { void window.api?.dayPanelClose?.() }}
            className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="关闭（Ctrl+Alt+S 重新打开）"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3">
        {/* 逾期 */}
        {overdue.length > 0 && (
          <section>
            <p className="mb-1 px-1 text-xs font-medium text-[var(--danger)]">⏰ 逾期（{overdue.length}）</p>
            <div className="space-y-0.5">{overdue.map(t => taskRow(t, true))}</div>
          </section>
        )}

        {/* 今日任务 */}
        <section>
          <p className="mb-1 px-1 text-xs font-medium text-[var(--text-primary)]">
            今天 · {todayDate.getMonth() + 1}月{todayDate.getDate()}日 {WEEKDAY_LABELS[todayDate.getDay()]}
            <span className="ml-1 font-normal text-[var(--text-muted)]">（{pendingCount} 待办 / {doneCount} 完成）</span>
          </p>
          <div className="space-y-0.5">{topTodos.map(t => taskRow(t, false))}</div>
          {topTodos.length === 0 && (
            <p className="px-1 py-2 text-xs text-[var(--text-muted)]">今天暂无任务，下方快速添加一条吧</p>
          )}
          {/* 快速添加 */}
          <div className="mt-2 px-0.5">
            <div className="flex items-center gap-1.5">
              <input
                value={quick}
                onChange={e => setQuick(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void addQuick() }}
                placeholder="快速添加：周五 14:00 复习计网"
                className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={() => void addQuick()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-white hover:opacity-90"
                title="添加（回车）"
              >
                <Plus size={14} />
              </button>
            </div>
            {quick.trim() && (
              <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-0.5 rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[var(--accent)]">
                  <CalendarDays size={10} />{formatEntryDate(parsed.date)}
                </span>
                {parsed.time && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[var(--accent)]">
                    <Clock size={10} />{parsed.time}
                  </span>
                )}
                <span>标题：{parsed.title || '（空）'}</span>
              </div>
            )}
          </div>
        </section>

        <div className="border-t border-[var(--border-color)]" />

        {/* 今日打卡 */}
        <section>
          <div className="mb-1 flex items-center justify-between px-1">
            <p className="text-xs font-medium">
              今日打卡
              <span className="ml-1 font-normal text-[var(--text-muted)]">（{checkedToday}/{plannedHabits.length}）</span>
            </p>
            <button
              onClick={() => openInMain('toolbox')}
              className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)]"
              title="在主窗口工具箱中管理习惯"
            >
              完整配置<ExternalLink size={10} />
            </button>
          </div>
          <div className="space-y-0.5">
            {plannedHabits.map(h => {
              const checked = habitIndex.get(h.id)?.has(todayStr) ?? false
              const streak = currentStreak(h, habitIndex.get(h.id) ?? new Set(), todayDate)
              return (
                <div key={h.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-[var(--bg-hover)]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: h.color }} />
                  <span className="flex-1 truncate text-xs">{h.name}</span>
                  {streak > 0 && <span className="shrink-0 text-[11px] text-[var(--text-muted)]">连续 {streak} 天</span>}
                  <button
                    onClick={() => void checkHabit(h)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      checked ? 'border-[var(--success)] bg-[var(--success)] text-white' : 'border-[var(--border-color)] hover:border-[var(--text-secondary)]'
                    }`}
                    title={checked ? '取消打卡' : '打卡'}
                  >
                    {checked && <Check size={12} strokeWidth={3} />}
                  </button>
                </div>
              )
            })}
            {plannedHabits.length === 0 && (
              <p className="px-1 py-1 text-xs text-[var(--text-muted)]">今天没有计划中的习惯</p>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1.5 px-0.5">
            <input
              value={newHabit}
              onChange={e => setNewHabit(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addHabit() }}
              placeholder="新增习惯（规则默认每日）"
              className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => void addHabit()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              title="添加习惯"
            >
              <Plus size={14} />
            </button>
          </div>
        </section>
      </div>

      <div className="shrink-0 border-t border-[var(--border-color)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
        Ctrl+Alt+S 开关 · 拖动表头移动窗口 · 「完整配置」跳转主窗口工具箱
      </div>
    </div>
  )
}
