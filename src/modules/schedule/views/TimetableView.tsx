import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag } from '../../../types'
import { getScheduleWeekTodos, updateScheduleTodo } from '../../../lib/ipc'
import { localToday } from '../../../lib/date'
import { useSettings } from '../../../lib/SettingsContext'
import { showToast } from '../../../lib/toast'
import {
  quadrantMeta, QUADRANT_TEXT_CLASS, QuadrantIconGlyph, type QuadrantIcon,
} from '../../../lib/scheduleQuadrant'
import {
  DENSITY_PX, DENSITY_LABEL, DENSITY_VALUES, MIN_DURATION, MIN_RANGE_HOURS,
  GRANULARITY_VALUES, layoutDay, dueOfDay, dndMeta,
  clamp, dayFromMonday, fmtMin, mondayOfWeek, snapMin, shortDate, toDateStr,
  WEEKDAY_LABELS, type DensityId, type Granularity,
} from '../timetable'

/**
 * 日程表（周视图）。
 *
 * 形态：左侧「待安排」栏 ↔ 右侧 7 天时间网格，双向拖拽完成排期。
 * - 待安排 → 网格 = 排期；网格 → 待安排 = 取消排期
 * - 卡片上下边缘可拖拽改时长（最小 15 分钟，与粒度解耦）；不跨天
 * - 卡片整体拖动 = 改时间 / 改天；空白处拖框 = 新建（带时段预填）
 * - 截止类任务额外画一条虚线红线（不占时段）
 * - 未完成的排期任务自动延后：原日期让位，今天同一时段显示为虚线幽灵
 *
 * 跨栏拖拽用 HTML5 DnD（跨组件最省事），边缘拉伸与空白拖框用 pointer events
 * （同一元素内完成，不必跨组件传坐标）。
 */

interface Props {
  isActive: boolean
  tags: ScheduleTag[]
  iconSize: 'sm' | 'md' | 'lg'
  quadrantIcon: QuadrantIcon
  quadrantText: 'show' | 'hide'
  /** 外部数据变更信号（待安排栏增删、跨窗口同步等）→ 重新拉取本周 */
  refreshSignal: number
  onOpenTodo: (todo: ScheduleTodo) => void
  onToggleDone: (todo: ScheduleTodo) => void
  /** 空白处拖框新建：交给上层打开编辑弹窗（预填日期与时段） */
  onRequestCreate: (dateStr: string, start: number, end: number) => void
  /** 排期/改时长落盘成功后通知上层刷新（待安排栏、月历打点） */
  onChanged: () => void
}

export function TimetableView({
  isActive, tags, iconSize, quadrantIcon, quadrantText, refreshSignal,
  onOpenTodo, onToggleDone, onRequestCreate, onChanged,
}: Props) {
  const today = localToday()
  const { s: appSettings, update } = useSettings()

  // ---- 设置（设置页与这里双向联动）----
  const gran: Granularity = (GRANULARITY_VALUES as readonly number[]).includes(Number(appSettings.scheduleTimetableGranularity))
    ? (Number(appSettings.scheduleTimetableGranularity) as Granularity)
    : 30
  const density: DensityId = (DENSITY_VALUES as readonly string[]).includes(appSettings.scheduleTimetableRowHeight)
    ? (appSettings.scheduleTimetableRowHeight as DensityId)
    : 'normal'
  const startHour = clamp(Number(appSettings.scheduleTimetableStartHour) || 7, 0, 20)
  const endHour = clamp(Number(appSettings.scheduleTimetableEndHour) || 23, startHour + MIN_RANGE_HOURS, 24)
  const pxPerHour = DENSITY_PX[density]
  const pxPerMin = pxPerHour / 60
  const dayStartMin = startHour * 60
  const dayEndMin = endHour * 60
  const totalH = (endHour - startHour) * pxPerHour

  const [weekOffset, setWeekOffset] = useState(0)
  const [rows, setRows] = useState<ScheduleTodo[]>([])
  const [rangeOpen, setRangeOpen] = useState(false)
  const [drop, setDrop] = useState<{ day: number; start: number; duration: number } | null>(null)
  const [resize, setResize] = useState<{ id: string; start: number; end: number } | null>(null)
  const [blank, setBlank] = useState<{ day: number; start: number; end: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)

  const monday = useMemo(() => mondayOfWeek(today, weekOffset), [today, weekOffset])
  const weekStart = toDateStr(monday)
  const weekEnd = toDateStr(dayFromMonday(monday, 6))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => dayFromMonday(monday, i)), [monday])

  // ---- 取数 ----
  const load = useCallback(async () => {
    try {
      setRows(await getScheduleWeekTodos(weekStart, weekEnd))
    } catch (e) {
      console.error('[schedule] 读取本周任务失败', e)
    }
  }, [weekStart, weekEnd])

  useEffect(() => { void load() }, [load, refreshSignal])

  // 激活重读（模块保活，切回来时兜一次）
  const activatedRef = useRef(false)
  useEffect(() => {
    if (!isActive) return
    if (!activatedRef.current) { activatedRef.current = true; return }
    void load()
  }, [isActive, load])

  // 首次进入滚动到 08:30 附近
  const scrolledRef = useRef(false)
  useEffect(() => {
    if (scrolledRef.current) return
    const el = scrollRef.current
    if (!el) return
    scrolledRef.current = true
    el.scrollTop = Math.max(0, (8.5 * 60 - dayStartMin) * pxPerMin - 60)
  }, [dayStartMin, pxPerMin])

  // ---- 派生 ----
  const withTag = useMemo(
    () => rows.map(t => ({ ...t, tag: t.tagId ? tags.find(tg => tg.id === t.tagId) ?? null : null })),
    [rows, tags],
  )

  /** 已排期的任务（网格里的卡片） */
  const scheduled = useMemo(
    () => withTag.filter(t => t.scheduledStart != null && t.scheduledEnd != null),
    [withTag],
  )

  /** 未完成自动延后的候选：排期早于本周、仍未完成 —— 在今天同一时段画幽灵 */
  const isCurrentWeek = weekOffset === 0
  const deferredForToday = useMemo(() => {
    if (!isCurrentWeek) return []
    return withTag.filter(t =>
      t.status === 'pending' && t.scheduledStart != null && t.scheduledEnd != null && t.date < weekStart)
  }, [withTag, isCurrentWeek, weekStart])

  const weekStats = useMemo(() => {
    const inWeek = scheduled.filter(t => t.date >= weekStart && t.date <= weekEnd)
    const mins = inWeek.reduce((a, t) => a + ((t.scheduledEnd ?? 0) - (t.scheduledStart ?? 0)), 0)
    return { count: inWeek.length, hours: (mins / 60).toFixed(1).replace(/\.0$/, '') }
  }, [scheduled, weekStart, weekEnd])

  // ---- 提示浮标 ----
  const showHint = useCallback((x: number, y: number, text: string) => {
    const el = hintRef.current
    if (!el) return
    el.textContent = text
    el.style.display = 'block'
    el.style.left = `${x + 14}px`
    el.style.top = `${y - 28}px`
  }, [])
  const hideHint = useCallback(() => {
    const el = hintRef.current
    if (el) el.style.display = 'none'
  }, [])

  // ---- 提交排期 ----
  const commitSchedule = useCallback(async (todo: ScheduleTodo, dateStr: string, start: number, end: number) => {
    const patch = { date: dateStr, scheduledStart: start, scheduledEnd: end }
    const prevState = { date: todo.date, scheduledStart: todo.scheduledStart, scheduledEnd: todo.scheduledEnd }
    setRows(prev => prev.map(t => (t.id === todo.id ? { ...t, ...patch } : t)))
    try {
      await updateScheduleTodo(todo.id, patch)
      onChanged()
      void load()
    } catch (e) {
      setRows(prev => prev.map(t => (t.id === todo.id ? { ...t, ...prevState } : t)))
      showToast({ type: 'error', message: '排期保存失败，已还原' })
      console.error(e)
    }
  }, [onChanged, load])

  // ---- ① HTML5 DnD：跨栏拖拽 ----
  const onColumnDragOver = useCallback((dayIdx: number, e: React.DragEvent) => {
    if (!dndMeta.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const raw = dayStartMin + (e.clientY - rect.top) / pxPerMin - dndMeta.grabOffset
    const maxStart = dayEndMin - dndMeta.duration
    const start = clamp(snapMin(raw, gran), dayStartMin, Math.max(dayStartMin, maxStart))
    setDrop(prev => (prev && prev.day === dayIdx && prev.start === start && prev.duration === dndMeta.duration
      ? prev
      : { day: dayIdx, start, duration: dndMeta.duration }))
    showHint(e.clientX, e.clientY, `${fmtMin(start)}–${fmtMin(start + dndMeta.duration)} · ${dndMeta.duration} 分钟`)
  }, [dayStartMin, dayEndMin, pxPerMin, gran, showHint])

  const onColumnDrop = useCallback((dayIdx: number, e: React.DragEvent) => {
    e.preventDefault()
    const meta = { ...dndMeta }
    dndMeta.id = null; dndMeta.from = null
    setDrop(null)
    hideHint()
    if (!meta.id || !drop) return
    const dateStr = toDateStr(days[dayIdx])
    const todo = rows.find(t => t.id === meta.id)
    if (!todo) return
    const dur = meta.from === 'tray' ? meta.duration : Math.max(MIN_DURATION, (todo.scheduledEnd ?? 0) - (todo.scheduledStart ?? 0))
    void commitSchedule(todo, dateStr, drop.start, drop.start + dur)
  }, [drop, days, rows, commitSchedule, hideHint])

  // ---- ② 边缘拉伸（pointer events）----
  const onResizeDown = useCallback((todo: ScheduleTodo, edge: 'top' | 'bot', e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const s0 = todo.scheduledStart!
    const e0 = todo.scheduledEnd!
    const colEl = (e.currentTarget as HTMLElement).closest('[data-day-col]') as HTMLElement | null
    if (!colEl) return
    const rect = colEl.getBoundingClientRect()
    let latest = { start: s0, end: e0 }
    let moved = false

    const toMin = (clientY: number) => snapMin(dayStartMin + (clientY - rect.top) / pxPerMin, gran)

    const onMove = (ev: PointerEvent) => {
      moved = true
      const m = toMin(ev.clientY)
      if (edge === 'top') {
        latest = { start: clamp(m, dayStartMin, e0 - MIN_DURATION), end: e0 }
      } else {
        latest = { start: s0, end: clamp(m, s0 + MIN_DURATION, dayEndMin) }
      }
      setResize({ id: todo.id, ...latest })
      showHint(ev.clientX, ev.clientY, `${fmtMin(latest.start)}–${fmtMin(latest.end)} · ${latest.end - latest.start} 分钟`)
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResize(null)
      hideHint()
      if (!moved) return
      if (latest.start === s0 && latest.end === e0) return
      void commitSchedule(todo, todo.date, latest.start, latest.end)
    }

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [dayStartMin, dayEndMin, pxPerMin, gran, showHint, hideHint, commitSchedule])

  // ---- ③ 空白拖框新建（pointer events）----
  const onColumnPointerDown = useCallback((dayIdx: number, e: React.PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-block]')) return
    const colEl = e.currentTarget as HTMLElement
    const rect = colEl.getBoundingClientRect()
    const origin = clamp(snapMin(dayStartMin + (e.clientY - rect.top) / pxPerMin, gran), dayStartMin, dayEndMin - MIN_DURATION)
    let latest = { start: origin, end: origin + 60 }
    let moved = false

    const onMove = (ev: PointerEvent) => {
      const m = clamp(snapMin(dayStartMin + (ev.clientY - rect.top) / pxPerMin, gran), dayStartMin, dayEndMin)
      if (Math.abs(m - origin) < gran) return
      moved = true
      document.body.style.userSelect = 'none'
      latest = { start: Math.min(origin, m), end: Math.max(origin, m) }
      if (latest.end - latest.start < MIN_DURATION) latest.end = latest.start + MIN_DURATION
      setBlank({ day: dayIdx, ...latest })
      showHint(ev.clientX, ev.clientY, `${fmtMin(latest.start)}–${fmtMin(latest.end)} · ${latest.end - latest.start} 分钟`)
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      setBlank(null)
      hideHint()
      if (!moved) return
      onRequestCreate(toDateStr(days[dayIdx]), latest.start, latest.end)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [dayStartMin, dayEndMin, pxPerMin, gran, days, showHint, hideHint, onRequestCreate])

  // ---- 任务块拖动（HTML5）----
  const onBlockDragStart = useCallback((todo: ScheduleTodo, e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dur = Math.max(MIN_DURATION, (todo.scheduledEnd ?? 0) - (todo.scheduledStart ?? 0))
    dndMeta.id = todo.id
    dndMeta.from = 'grid'
    dndMeta.duration = dur
    dndMeta.grabOffset = clamp((e.clientY - rect.top) / pxPerMin, 0, dur)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', todo.id)
  }, [pxPerMin])

  const onBlockDragEnd = useCallback(() => {
    dndMeta.id = null
    dndMeta.from = null
    setDrop(null)
    hideHint()
  }, [hideHint])

  // ---- 渲染 ----
  const todayIdx = days.findIndex(d => toDateStr(d) === today)

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      {/* 工具行 */}
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-1.5 shrink-0 select-none">
        <button onClick={() => setWeekOffset(v => v - 1)} title="上一周"
          className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronLeft size={14} />
        </button>
        <span className="text-[12px] font-medium text-[var(--text-primary)] whitespace-nowrap">
          {monday.getFullYear()}年{monday.getMonth() + 1}月 · {monday.getDate()}–{dayFromMonday(monday, 6).getDate()}日
        </span>
        <button onClick={() => setWeekOffset(v => v + 1)} title="下一周"
          className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronRight size={14} />
        </button>
        <button onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}
          className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent">
          今天
        </button>

        <span className="ml-2 text-[11px] text-[var(--text-muted)] whitespace-nowrap">
          本周 {weekStats.count} 项 · 约 {weekStats.hours} h
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {/* 粒度 */}
          <div className="flex items-center gap-0.5 rounded-md bg-[var(--bg-secondary)] p-0.5">
            {GRANULARITY_VALUES.map(g => (
              <button key={g} onClick={() => update('scheduleTimetableGranularity', String(g))}
                title={`刻度与吸附步长：${g} 分钟`}
                className={`px-1.5 py-0.5 rounded text-[11px] transition-colors ${gran === g ? 'bg-[var(--bg-primary)] text-[var(--accent)] font-semibold shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                {g === 60 ? '1时' : `${g}分`}
              </button>
            ))}
          </div>
          {/* 行高 */}
          <button onClick={() => {
            const i = DENSITY_VALUES.indexOf(density)
            update('scheduleTimetableRowHeight', DENSITY_VALUES[(i + 1) % DENSITY_VALUES.length])
          }} title="行高（紧凑 / 舒适 / 宽松）"
            className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
            {DENSITY_LABEL[density]}
          </button>
          {/* 显示范围 */}
          <div className="relative">
            <button onClick={() => setRangeOpen(v => !v)} title="时间轴显示范围"
              className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors tabular-nums">
              {fmtMin(dayStartMin)}–{fmtMin(dayEndMin)}
            </button>
            {rangeOpen && (
              <RangePop
                startHour={startHour} endHour={endHour}
                onChange={(kind, h) => {
                  if (kind === 'start') {
                    if (endHour - h < MIN_RANGE_HOURS) return
                    update('scheduleTimetableStartHour', String(h))
                  } else {
                    if (h - startHour < MIN_RANGE_HOURS) return
                    update('scheduleTimetableEndHour', String(h))
                  }
                }}
                onClose={() => setRangeOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* 表头 */}
      <div className="flex shrink-0 border-b border-[var(--border-color)]">
        <div className="w-[52px] shrink-0 border-r border-[var(--border-color)]" />
        {days.map((d, i) => {
          const isToday = i === todayIdx
          const count = scheduled.filter(t => t.date === toDateStr(d)).length
          return (
            <div key={i}
              className={`flex-1 min-w-0 px-2 py-1.5 border-r border-[var(--border-color)] last:border-r-0 flex items-baseline gap-1.5 ${isToday ? 'bg-[var(--input-bg)]' : ''}`}>
              <span className={`text-[11.5px] font-semibold ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {WEEKDAY_LABELS[i]}{isToday ? ' · 今天' : ''}
              </span>
              <span className={`text-[10.5px] ${isToday ? 'text-[var(--accent)]/70' : 'text-[var(--text-disabled)]'}`}>{shortDate(d)}</span>
              {count > 0 && <span className="ml-auto text-[10px] text-[var(--text-disabled)]">{count} 项</span>}
            </div>
          )
        })}
      </div>

      {/* 网格 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="flex min-w-full">
          {/* 时间刻度 */}
          <div className="w-[52px] shrink-0 border-r border-[var(--border-color)] relative sticky left-0 bg-[var(--bg-primary)] z-[2]"
            style={{ height: totalH }}>
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
              <span key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-[var(--text-disabled)] tabular-nums"
                style={{ top: i * pxPerHour }}>
                {fmtMin((startHour + i) * 60)}
              </span>
            ))}
          </div>

          {/* 7 天列 */}
          {days.map((d, dayIdx) => {
            const ds = toDateStr(d)
            const isToday = dayIdx === todayIdx
            const dayAll = scheduled.filter(t => t.date === ds)
            // 与显示范围完全不相交的任务不画（部分重叠的保留，由列的 overflow-hidden 裁边）
            const ordinary = dayAll.filter(t =>
              (t.scheduledEnd ?? 0) > dayStartMin && (t.scheduledStart ?? 0) < dayEndMin)
            const laid = layoutDay(ordinary)
            const dues = dueOfDay(dayAll.filter(t => t.status === 'pending'), ds)
            const ghosts = isToday ? deferredForToday : []
            const isDropTarget = drop?.day === dayIdx

            return (
              <div
                key={dayIdx}
                data-day-col
                onDragOver={e => onColumnDragOver(dayIdx, e)}
                onDragLeave={() => setDrop(prev => (prev?.day === dayIdx ? null : prev))}
                onDrop={e => onColumnDrop(dayIdx, e)}
                onPointerDown={e => onColumnPointerDown(dayIdx, e)}
                className={`flex-1 min-w-0 relative overflow-hidden border-r border-[var(--border-color)] last:border-r-0 ${isToday ? 'bg-[var(--input-bg)]' : ''} ${isDropTarget ? 'bg-[var(--drop-bg)]' : ''}`}
                style={{ height: totalH }}
              >
                {/* 网格线 */}
                {Array.from({ length: endHour - startHour }, (_, i) => (
                  <div key={`h${i}`}>
                    <div className="absolute left-0 right-0 h-px bg-[var(--border-color)] opacity-70" style={{ top: i * pxPerHour }} />
                    {Array.from({ length: Math.max(0, 60 / gran - 1) }, (_, k) => (
                      <div key={`m${k}`} className="absolute left-0 right-0 h-px bg-[var(--border-color)] opacity-25"
                        style={{ top: i * pxPerHour + ((k + 1) * gran / 60) * pxPerHour }} />
                    ))}
                  </div>
                ))}

                {/* 截止红线 */}
                {dues.map((min, i) => (
                  <div key={`due${i}`} className="absolute left-0 right-0 z-[4] pointer-events-none"
                    style={{ top: (min - dayStartMin) * pxPerMin }}>
                    <div className="border-t border-dashed border-[var(--danger)]" />
                    <span className="absolute right-1 -top-2 px-1 leading-[14px] rounded-[3px] text-[9.5px] font-semibold text-white bg-[var(--danger)]">
                      截止 {fmtMin(min)}
                    </span>
                  </div>
                ))}

                {/* 当前时刻线 */}
                {isToday && (() => {
                  const now = new Date()
                  const nm = now.getHours() * 60 + now.getMinutes()
                  if (nm < dayStartMin || nm > dayEndMin) return null
                  return (
                    <div className="absolute left-0 right-0 z-[3] pointer-events-none" style={{ top: (nm - dayStartMin) * pxPerMin }}>
                      <div className="border-t-[1.5px] border-[var(--danger)]" />
                      <span className="absolute left-0.5 -top-[3px] w-1.5 h-1.5 rounded-full bg-[var(--danger)]" />
                    </div>
                  )
                })()}

                {/* 落点预览 */}
                {drop?.day === dayIdx && (
                  <div className="absolute left-0.5 right-0.5 z-[5] rounded-md pointer-events-none border-[1.5px] border-dashed border-[var(--accent)] bg-[var(--accent)]/12"
                    style={{ top: (drop.start - dayStartMin) * pxPerMin, height: Math.max(20, drop.duration * pxPerMin - 2) }} />
                )}

                {/* 空白拖框新建 */}
                {blank?.day === dayIdx && (
                  <div className="absolute left-0.5 right-0.5 z-[5] rounded-md pointer-events-none border-[1.5px] border-dashed border-[var(--accent)] bg-[var(--accent)]/16"
                    style={{ top: (blank.start - dayStartMin) * pxPerMin, height: Math.max(20, (blank.end - blank.start) * pxPerMin - 2) }} />
                )}

                {/* 延后幽灵（未完成的排期任务滚到今天） */}
                {ghosts.map(t => (
                  <Block key={`ghost-${t.id}`} todo={t} pxPerMin={pxPerMin} dayStartMin={dayStartMin}
                    lane={0} lanes={1} ghost iconSize={iconSize} quadrantIcon={quadrantIcon} quadrantText={quadrantText}
                    onOpen={onOpenTodo} onToggleDone={onToggleDone}
                    onDragStart={onBlockDragStart} onDragEnd={onBlockDragEnd}
                    onResizeDown={onResizeDown} resize={null} />
                ))}

                {/* 任务卡片 */}
                {laid.map(({ item, lane, lanes }) => {
                  const live = resize?.id === item.id ? resize : null
                  return (
                    <Block key={item.id} todo={item} pxPerMin={pxPerMin} dayStartMin={dayStartMin}
                      lane={lane} lanes={lanes} iconSize={iconSize} quadrantIcon={quadrantIcon} quadrantText={quadrantText}
                      onOpen={onOpenTodo} onToggleDone={onToggleDone}
                      onDragStart={onBlockDragStart} onDragEnd={onBlockDragEnd}
                      onResizeDown={onResizeDown} resize={live} />
                  )
                })}

                {dayAll.length === 0 && !ghosts.length && (
                  <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[10.5px] text-[var(--text-disabled)] pointer-events-none whitespace-nowrap">
                    拖任务到这里
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div ref={hintRef}
        className="fixed z-[9000] hidden px-1.5 py-0.5 rounded text-[10.5px] font-semibold text-white bg-black/85 tabular-nums pointer-events-none whitespace-nowrap"
        style={{ letterSpacing: '.2px' }} />
    </div>
  )
}

/* ===================== 任务块 ===================== */

function Block({
  todo, pxPerMin, dayStartMin, lane, lanes, ghost = false, iconSize, quadrantIcon, quadrantText,
  onOpen, onToggleDone, onDragStart, onDragEnd, onResizeDown, resize,
}: {
  todo: ScheduleTodo & { tag?: ScheduleTag | null }
  pxPerMin: number
  dayStartMin: number
  lane: number
  lanes: number
  ghost?: boolean
  iconSize: 'sm' | 'md' | 'lg'
  quadrantIcon: QuadrantIcon
  quadrantText: 'show' | 'hide'
  onOpen: (t: ScheduleTodo) => void
  onToggleDone: (t: ScheduleTodo) => void
  onDragStart: (t: ScheduleTodo, e: React.DragEvent) => void
  onDragEnd: () => void
  onResizeDown: (t: ScheduleTodo, edge: 'top' | 'bot', e: React.PointerEvent) => void
  resize: { start: number; end: number } | null
}) {
  const start = resize ? resize.start : todo.scheduledStart!
  const end = resize ? resize.end : todo.scheduledEnd!
  const top = (start - dayStartMin) * pxPerMin
  const height = Math.max(20, (end - start) * pxPerMin - 2)
  const tiny = height < 34
  const compact = height < 52
  const tag = todo.tag ?? null
  const color = tag?.color ?? 'var(--accent)'
  const q = quadrantMeta(todo.quadrant)
  const isDone = todo.status === 'done'
  const widthPct = 100 / lanes
  const leftPct = lane * widthPct
  const fz = iconSize === 'lg' ? 12 : iconSize === 'md' ? 11.5 : 11

  return (
    <div
      data-block
      draggable={!ghost && !resize}
      onDragStart={e => onDragStart(todo, e)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(todo)}
      className={`absolute rounded-md overflow-hidden transition-shadow z-[2] hover:z-[6] hover:shadow-[0_3px_10px_rgba(0,0,0,.16)] ${ghost ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} ${isDone ? 'opacity-50' : ''}`}
      style={{
        top, height,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        background: ghost ? 'transparent' : `color-mix(in srgb, ${color} 11%, var(--bg-primary))`,
        border: ghost ? `1.5px dashed color-mix(in srgb, ${color} 55%, transparent)` : `1px solid color-mix(in srgb, ${color} 26%, transparent)`,
        borderLeft: ghost ? `3px dashed ${color}` : `3px solid ${color}`,
        padding: tiny ? '2px 5px' : '3px 5px 4px 6px',
      }}
      title={ghost ? `未完成，已从 ${todo.date} 延后` : '拖动改时间 · 拖上下边缘改时长 · 双击编辑'}
    >
      {/* 完成按钮 */}
      {!ghost && !tiny && (
        <button
          onClick={e => { e.stopPropagation(); onToggleDone(todo) }}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
          title={isDone ? '恢复未完成' : '标记完成'}
          className={`absolute right-1 top-1 z-[3] w-[13px] h-[13px] rounded-[3px] border flex items-center justify-center transition-colors ${isDone ? 'bg-[var(--success)] border-[var(--success)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)]/70 hover:border-[var(--success)]'}`}
        >
          {isDone && <Check size={9} strokeWidth={3.5} className="text-white" />}
        </button>
      )}

      {/* 边缘拉伸把手 */}
      {!ghost && (
        <>
          <div className="absolute left-0 right-0 top-0 h-[7px] z-[3] cursor-ns-resize group/rz"
            onPointerDown={e => onResizeDown(todo, 'top', e)}>
            <span className="absolute left-1/2 -translate-x-1/2 top-[2px] w-4 h-[3px] rounded-full opacity-0 group-hover/rz:opacity-100 transition-opacity" style={{ background: color }} />
          </div>
          <div className="absolute left-0 right-0 bottom-0 h-[7px] z-[3] cursor-ns-resize group/rz"
            onPointerDown={e => onResizeDown(todo, 'bot', e)}>
            <span className="absolute left-1/2 -translate-x-1/2 bottom-[2px] w-4 h-[3px] rounded-full opacity-0 group-hover/rz:opacity-100 transition-opacity" style={{ background: color }} />
          </div>
        </>
      )}

      <div className="pointer-events-none">
        {!tiny && (
          <div className="text-[9.5px] leading-tight tabular-nums" style={{ color: `color-mix(in srgb, ${color} 70%, var(--text-primary))` }}>
            {fmtMin(start)}–{fmtMin(end)}
          </div>
        )}
        <div className={`font-semibold leading-snug text-[var(--text-primary)] ${tiny ? 'truncate' : ''} ${isDone ? 'line-through' : ''}`}
          style={{ fontSize: fz }}>
          {todo.title}
        </div>
        {!compact && (
          <div className="flex items-center gap-1 mt-0.5 text-[9.5px] text-[var(--text-muted)]">
            <span className={QUADRANT_TEXT_CLASS[todo.quadrant] ?? 'text-[var(--text-muted)]'}>
              <QuadrantIconGlyph icon={quadrantIcon} meta={q} size={11} />
            </span>
            {tag && <span className="truncate">{tag.name}</span>}
            {todo.taskType === 'deadline' && <span className="shrink-0 text-[var(--danger)]">· 截止</span>}
          </div>
        )}
      </div>

      {ghost && (
        <span className="absolute right-1 top-[3px] px-1 rounded-[3px] text-[9px] font-semibold leading-[13px]"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color: `color-mix(in srgb, ${color} 80%, var(--text-primary))` }}>
          延后
        </span>
      )}
    </div>
  )
}

/* ===================== 范围弹层 ===================== */

function RangePop({ startHour, endHour, onChange, onClose }: {
  startHour: number
  endHour: number
  onChange: (kind: 'start' | 'end', h: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // 延后一拍注册，避开打开这次点击本身
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => { window.clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [onClose])

  return (
    <div ref={ref}
      className="absolute right-0 top-full mt-1.5 z-50 w-[248px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl p-3">
      <div className="text-[10.5px] text-[var(--text-muted)] mb-2.5">时间轴显示范围</div>
      {(['start', 'end'] as const).map(kind => (
        <div key={kind} className="flex items-center gap-2 mb-2.5">
          <span className="w-[26px] shrink-0 text-[11px] text-[var(--text-secondary)]">{kind === 'start' ? '起始' : '终止'}</span>
          <div className="flex-1 grid grid-cols-6 gap-[3px]">
            {Array.from({ length: kind === 'start' ? 8 : 9 }, (_, i) => kind === 'start' ? i + 5 : i + 16).map(h => {
              const cur = kind === 'start' ? startHour : endHour
              const disabled = kind === 'start' ? endHour - h < MIN_RANGE_HOURS : h - startHour < MIN_RANGE_HOURS
              return (
                <button key={h} disabled={disabled}
                  onClick={() => onChange(kind, h)}
                  className={`h-5 rounded text-[10.5px] tabular-nums transition-colors ${h === cur ? 'bg-[var(--accent)] text-white font-semibold' : disabled ? 'opacity-30 cursor-not-allowed text-[var(--text-secondary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
                  {kind === 'start' ? String(h).padStart(2, '0') : h}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="pt-2 border-t border-[var(--border-color)] text-[10px] text-[var(--text-disabled)] leading-relaxed">
        范围外的时段不占纵向空间；至少保留 {MIN_RANGE_HOURS} 小时。
      </div>
    </div>
  )
}
