import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GripHorizontal, X, Check, Pencil, Trash2, CalendarClock,
  Plus, ChevronRight, ChevronDown, ExternalLink,
  PanelRightClose, PanelRightOpen,
} from 'lucide-react'
import type { ScheduleTodo, Habit, HabitRecord } from '../types'
import { localToday, formatEntryDate } from '../lib/date'
import {
  getScheduleTodos, getScheduleOverdue, getScheduleSubtasks,
  createScheduleTodo, updateScheduleTodo, deleteScheduleTodo,
  habitGetAll, createHabit, toggleHabitCheck,
} from '../lib/ipc'
import { notifyDataChanged, useDataChanged } from '../lib/dataChanged'
import { showToast } from '../lib/toast'
import { parseQuickDate } from './parseQuickDate'
import { isPlannedOn, currentStreak, buildRecordIndex } from '../modules/toolbox/components/habit-tracker/dateUtils'

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 距次日 00:00:05 的毫秒数（用于跨零点刷新定时器） */
function msUntilTomorrow(): number {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
  return Math.max(1000, next.getTime() - now.getTime())
}

const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export interface DayPanelProps {
  /** embedded：主窗口内嵌面板（高度由父容器决定，h-full）；popout：独立 BrowserWindow（h-screen） */
  mode: 'embedded' | 'popout'
  /** 嵌入→脱离（内嵌模式顶部按钮触发）；主进程负责创建独立窗口 */
  onPopout?: () => void
  /** 脱离→嵌入（独立窗口顶部按钮触发 / Esc）；主进程负责销毁独立窗口 */
  onDockBack?: () => void
  /** 关闭（嵌入模式隐藏面板；脱离模式等同 dockBack） */
  onClose?: () => void
}

/**
 * 日程与打卡侧边栏组件（WeChat 模式：同一组件既渲染主窗口内嵌面板，也渲染独立脱离窗口）
 * 逾期置顶红分组 → 今日任务（子任务展开一级）→ 快速添加（轻量时间解析）→ 今日打卡
 */
export function DayPanel({ mode, onPopout, onDockBack, onClose }: DayPanelProps) {
  const [todayStr, setTodayStr] = useState(() => localToday())
  const todayDate = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [todayStr])

  const [todos, setTodos] = useState<ScheduleTodo[]>([])
  const [overdue, setOverdue] = useState<ScheduleTodo[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [records, setRecords] = useState<HabitRecord[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expandedRef = useRef<Set<string>>(new Set())
  const [subtasks, setSubtasks] = useState<Record<string, ScheduleTodo[]>>({})
  const [editing, setEditing] = useState<{ id: string; title: string; date: string; time: string } | null>(null)
  const [quick, setQuick] = useState('')
  const [manualDate, setManualDate] = useState<string | null>(null)
  const [manualTime, setManualTime] = useState<string | null>(null)
  const [newHabit, setNewHabit] = useState('')

  // 跨零点自动翻页
  useEffect(() => {
    let timer: number | undefined
    const tick = () => {
      timer = window.setTimeout(() => { setTodayStr(localToday()); tick() }, msUntilTomorrow())
    }
    tick()
    return () => { if (timer) window.clearTimeout(timer) }
  }, [])

  const load = useCallback(async () => {
    try {
      const [todayList, od, habitData] = await Promise.all([
        getScheduleTodos(todayStr),
        getScheduleOverdue(todayStr),
        habitGetAll(),
      ])
      setTodos(todayList)
      setOverdue(od)
      setHabits(habitData.habits ?? [])
      setRecords(habitData.records ?? [])
      for (const pid of expandedRef.current) {
        void getScheduleSubtasks(pid).then(subs => {
          setSubtasks(m => ({ ...m, [pid]: subs }))
        }).catch(() => { /* ignore */ })
      }
    } catch (e) {
      console.error('[DayPanel] 加载失败', e)
    }
  }, [todayStr])

  useEffect(() => { void load() }, [load])
  useDataChanged('schedule', load)
  useDataChanged('habit', load)

  // 主进程自动打卡 → 同步刷新
  useEffect(() => {
    window.api?.onHabitAutoChecked?.(() => { void load() })
  }, [load])

  // Esc：嵌入式关闭内嵌面板；脱离式吸附回内嵌
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement) { el.blur(); return }
      if (mode === 'popout') onDockBack?.()
      else onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onClose, onDockBack])

  const topTodos = useMemo(() => todos.filter(t => !t.parentId), [todos])
  const pendingCount = topTodos.filter(t => t.status === 'pending').length
  const doneCount = topTodos.filter(t => t.status === 'done').length

  const parsed = useMemo(() => parseQuickDate(quick, todayDate), [quick, todayDate])
  const finalDate = manualDate ?? parsed.date
  const finalTime = manualTime !== null ? manualTime : parsed.time

  const habitIndex = useMemo(() => buildRecordIndex(records), [records])
  const plannedHabits = useMemo(
    () => habits.filter(h => !h.archived && isPlannedOn(h, todayDate)),
    [habits, todayDate],
  )
  const checkedToday = useMemo(
    () => plannedHabits.filter(h => habitIndex.get(h.id)?.has(todayStr)).length,
    [plannedHabits, habitIndex, todayStr],
  )

  const toggleStatus = useCallback(async (t: ScheduleTodo) => {
    const next = t.status === 'done' ? 'pending' : 'done'
    setTodos(cur => cur.map(x => (x.id === t.id ? { ...x, status: next } : x)))
    setOverdue(cur => cur.map(x => (x.id === t.id ? { ...x, status: next } : x)))
    try {
      await updateScheduleTodo(t.id, { status: next })
      notifyDataChanged('schedule')
    } catch (e) {
      console.error('[DayPanel] 更新状态失败', e)
      void load()
    }
  }, [load])

  const moveToToday = useCallback(async (id: string) => {
    try {
      await updateScheduleTodo(id, { date: todayStr })
      notifyDataChanged('schedule')
      showToast({ type: 'info', message: '已改到今天' })
    } catch (e) {
      console.error('[DayPanel] 迁移失败', e)
      void load()
    }
  }, [todayStr, load])

  const removeTodo = useCallback(async (t: ScheduleTodo) => {
    if (!window.confirm(`删除任务「${t.title}」？`)) return
    try {
      await deleteScheduleTodo(t.id)
      notifyDataChanged('schedule')
    } catch (e) {
      console.error('[DayPanel] 删除失败', e)
      void load()
    }
  }, [load])

  const saveEdit = useCallback(async () => {
    if (!editing) return
    const title = editing.title.trim()
    if (!title) { setEditing(null); return }
    try {
      await updateScheduleTodo(editing.id, { title, date: editing.date, time: editing.time || null })
      setEditing(null)
      notifyDataChanged('schedule')
    } catch (e) {
      console.error('[DayPanel] 保存失败', e)
      void load()
    }
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
      await createScheduleTodo({ title, date: finalDate, time: finalTime || undefined, taskType: 'plan' })
      setQuick('')
      setManualDate(null)
      setManualTime(null)
      notifyDataChanged('schedule')
      showToast({
        type: 'info',
        message: finalDate === todayStr ? `已添加到今天：${title}` : `已添加到 ${formatEntryDate(finalDate)}：${title}`,
      })
    } catch (e) {
      console.error('[DayPanel] 快速添加失败', e)
      showToast({ type: 'error', message: '添加失败，请重试' })
    }
  }, [parsed, finalDate, finalTime, todayStr])

  const addHabit = useCallback(async () => {
    const name = newHabit.trim()
    if (!name) return
    try {
      await createHabit({ name })
      setNewHabit('')
      notifyDataChanged('habit')
      showToast({ type: 'info', message: `已新增习惯：${name}（规则默认每日，可在工具箱调整）` })
    } catch (e) {
      console.error('[DayPanel] 新增习惯失败', e)
      showToast({ type: 'error', message: '新增习惯失败，请重试' })
    }
  }, [newHabit])

  const checkHabit = useCallback(async (h: Habit) => {
    const willCheck = !(habitIndex.get(h.id)?.has(todayStr) ?? false)
    setRecords(cur => willCheck
      ? [...cur, { id: `${h.id}:${todayStr}`, habitId: h.id, date: todayStr } as HabitRecord]
      : cur.filter(r => !(r.habitId === h.id && r.date === todayStr)))
    try {
      await toggleHabitCheck(h.id, todayStr)
      notifyDataChanged('habit')
    } catch (e) {
      console.error('[DayPanel] 打卡失败', e)
      void load()
    }
  }, [todayStr, habitIndex, load])

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
            <button onClick={() => void toggleExpand(t.id)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="展开/收起子任务">
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
          <span className={`flex-1 truncate text-xs ${done ? 'text-[var(--text-muted)] line-through' : ''} ${isOverdue && !done ? 'text-[var(--danger)]' : ''}`}>{t.title}</span>
          {isOverdue && !done && (
            <button onClick={() => void moveToToday(t.id)} className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] group-hover:block" title="改到今天">
              <CalendarClock size={12} />
            </button>
          )}
          <button onClick={() => setEditing({ id: t.id, title: t.title, date: t.date, time: t.time ?? '' })} className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] group-hover:block" title="编辑">
            <Pencil size={12} />
          </button>
          <button onClick={() => void removeTodo(t)} className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] group-hover:block" title="删除">
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
              <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className="min-w-0 flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]" />
              <input type="time" value={editing.time} onChange={e => setEditing({ ...editing, time: e.target.value })} className="min-w-0 w-24 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]" />
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
                <span className={`flex-1 truncate text-[11px] ${sub.status === 'done' ? 'text-[var(--text-muted)] line-through' : ''}`}>{sub.title}</span>
                <button onClick={() => void removeTodo(sub)} className="hidden shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] group-hover:block" title="删除">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {(subtasks[t.id] ?? []).length === 0 && <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">无子任务</p>}
          </div>
        )}
      </div>
    )
  }

  // 容器高度：嵌入式由外层卡片壳 flex 提供（flex-1）；独立窗口自己 h-screen
  const containerCls = mode === 'embedded'
    ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] select-none'
    : 'relative flex h-screen flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] select-none'

  return (
    <div className={containerCls}>
      {/* 表头：嵌入式下用 WebkitAppRegion: drag 让用户能拖出脱离，独立窗口由 BrowserWindow 自身拖动 */}
      <div
        className="flex h-10 shrink-0 select-none items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3"
        style={mode === 'popout' ? dragRegion : undefined}
      >
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          {mode === 'popout' && <GripHorizontal size={14} className="text-[var(--text-muted)]" />}
          日程与打卡
        </div>
        <div className="flex items-center gap-0.5" style={mode === 'popout' ? noDrag : undefined}>
          {mode === 'embedded' && (
            <button
              onClick={onPopout}
              className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              title="脱离为独立窗口（拖到主窗口外任意位置摆放）"
            >
              <PanelRightClose size={14} strokeWidth={1.5} />
            </button>
          )}
          {mode === 'popout' && (
            <button
              onClick={onDockBack}
              className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              title="回到主窗口内嵌"
            >
              <PanelRightOpen size={14} strokeWidth={1.5} />
            </button>
          )}
          <button
            onClick={mode === 'popout' ? onDockBack : onClose}
            className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title={mode === 'popout' ? '回到主窗口内嵌' : '关闭面板（Ctrl+Alt+S 重新打开）'}
          >
            <X size={14} strokeWidth={1.5} />
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
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <p className="min-w-0 truncate text-xs font-medium text-[var(--text-primary)]">
              今天 · {todayDate.getMonth() + 1}月{todayDate.getDate()}日 {WEEKDAY_LABELS[todayDate.getDay()]}
              <span className="ml-1 font-normal text-[var(--text-muted)]">（{pendingCount} 待办 / {doneCount} 完成）</span>
            </p>
            <button
              onClick={() => openInMain('schedule')}
              className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)]"
              title="在主窗口任务模块中管理"
            >
              任务模块<ExternalLink size={10} />
            </button>
          </div>
          <div className="space-y-0.5">{topTodos.map(t => taskRow(t, false))}</div>
          {topTodos.length === 0 && (
            <p className="px-1 py-2 text-xs text-[var(--text-muted)]">今天暂无任务，下方快速添加一条吧</p>
          )}
          {/* 快速添加 */}
          <div className="mt-2 px-0.5">
            <div className="flex items-center gap-1.5">
              <input
                value={quick}
                onChange={e => { setQuick(e.target.value); setManualDate(null); setManualTime(null) }}
                onKeyDown={e => { if (e.key === 'Enter') void addQuick() }}
                placeholder="添加任务，周五 14:00 复习计网"
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
              <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
                <input
                  type="date"
                  value={finalDate}
                  onChange={e => setManualDate(e.target.value || null)}
                  title="日期（可修改）"
                  className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[11px] text-[var(--accent)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  type="time"
                  value={finalTime ?? ''}
                  onChange={e => setManualTime(e.target.value || null)}
                  title="时间（可填写 / 修改）"
                  className="w-[74px] rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[11px] text-[var(--accent)] outline-none focus:border-[var(--accent)]"
                />
                {(manualDate || manualTime !== null) && (
                  <button
                    onClick={() => { setManualDate(null); setManualTime(null) }}
                    className="rounded px-1 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
                    title="恢复自动解析结果"
                  >
                    重解析
                  </button>
                )}
                <span className="min-w-0 flex-1 truncate" title={parsed.title}>标题：{parsed.title || '（空）'}</span>
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
            {plannedHabits.length === 0 && <p className="px-1 py-1 text-xs text-[var(--text-muted)]">今天没有计划中的习惯</p>}
          </div>
          <div className="mt-2 flex items-center gap-1.5 px-0.5">
            <input
              value={newHabit}
              onChange={e => setNewHabit(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addHabit() }}
              placeholder="新增习惯（规则默认每日）"
              className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
            <button onClick={() => void addHabit()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" title="添加习惯">
              <Plus size={14} />
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}