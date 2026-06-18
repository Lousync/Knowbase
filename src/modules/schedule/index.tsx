import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Maximize2, Zap, ChevronDown, RotateCcw, Trash2, Check } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag, CreateScheduleTodoDTO, UpdateScheduleTodoDTO } from '../../types'
import {
  getScheduleTodos, getScheduleDates, getScheduleMonthTodos, getScheduleDeadlineCounts,
  createScheduleTodo, updateScheduleTodo, deleteScheduleTodo, getScheduleTags, getScheduleSubtasks,
  createScheduleTag, deleteScheduleTag, getSetting, setSetting
} from '../../lib/ipc'
import { CalendarView, type ViewMode } from './views/CalendarView'
import { TodoItem } from './components/TodoItem'
import { TodoEditModal } from './components/TodoEditModal'
import { ResizablePanel } from '../../components/shared/ResizablePanel'
import { isEditingInput } from '../../lib/shortcuts'
import { QuadrantChart } from './components/QuadrantChart'
import { TagManageModal } from './components/TagManageModal'

const QUADRANT_LABELS: Record<number, string> = { 0: '🔥 紧急重要', 1: '📌 重要不紧急', 2: '⚡ 紧急不重要', 3: '💤 不重要不紧急' }
const QUADRANT_COLORS: Record<number, string> = { 0: 'text-red-400', 1: 'text-blue-400', 2: 'text-yellow-400', 3: 'text-gray-400' }

const INPUT_SZ: Record<string, { icon: number; text: string; padY: string; placeholder: string; meta: string; metaIcon: number; sectionTitle: string }> = {
  sm: { icon: 14, text: 'text-[11px]', padY: 'py-1.5', placeholder: '零碎任务...', meta: 'text-[11px]', metaIcon: 10, sectionTitle: 'text-[12px]' },
  md: { icon: 17, text: 'text-[13px]', padY: 'py-2', placeholder: '快速添加当日零碎任务...', meta: 'text-[12px]', metaIcon: 12, sectionTitle: 'text-[13px]' },
  lg: { icon: 21, text: 'text-[15px]', padY: 'py-2.5', placeholder: '快速添加当日零碎任务...', meta: 'text-[13px]', metaIcon: 14, sectionTitle: 'text-[14px]' },
}

function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function ScheduleModule({ sidebarOpen = true, sidebarWidths = {} as Record<string, number> }: { sidebarOpen?: boolean; sidebarWidths?: Record<string, number> }) {
  const now = new Date()
  const today = localToday()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [dotDates, setDotDates] = useState<Set<string>>(new Set())
  const [deadlineCounts, setDeadlineCounts] = useState<Map<string, number>>(new Map())
  const [tags, setTags] = useState<ScheduleTag[]>([])

  const [viewMode, setViewMode] = useState<ViewMode>('date')
  const [monthTodos, setMonthTodos] = useState<ScheduleTodo[]>([])
  const [subtasksMap, setSubtasksMap] = useState<Record<string, ScheduleTodo[]>>({})

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduleTodo | null>(null)
  const [quadrantOpen, setQuadrantOpen] = useState(false)
  const [tagManageOpen, setTagManageOpen] = useState(false)
  const [iconSize, setIconSize] = useState<'sm' | 'md' | 'lg'>('sm')
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false)
  const sizeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSetting('scheduleIconSize').then(v => {
      if (v === 'sm' || v === 'md' || v === 'lg') setIconSize(v)
    })
  }, [])

  const setSize = (s: 'sm' | 'md' | 'lg') => {
    setIconSize(s)
    setSetting('scheduleIconSize', s)
    setSizeMenuOpen(false)
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (sizeMenuRef.current && !sizeMenuRef.current.contains(e.target as Node)) setSizeMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const iconSizeLabel = iconSize === 'sm' ? '小' : iconSize === 'md' ? '中' : '大'

  const ym = `${year}-${String(month).padStart(2, '0')}`

  // ---- data loading ----
  async function refreshDotDates() {
    try {
      const dates = await getScheduleDates(ym)
      setDotDates(new Set(dates))
      const counts = await getScheduleDeadlineCounts(ym)
      setDeadlineCounts(new Map(Object.entries(counts)))
    } catch (e) { console.error(e) }
  }

  async function refreshMonthTodos() {
    try {
      const todos = await getScheduleMonthTodos(ym)
      setMonthTodos(todos)
      // Load subtasks for all plan-type tasks
      const planTasks = todos.filter(t => t.taskType === 'plan')
      if (planTasks.length > 0) {
        const map: Record<string, ScheduleTodo[]> = {}
        await Promise.all(planTasks.map(async t => {
          map[t.id] = await getScheduleSubtasks(t.id)
        }))
        setSubtasksMap(map)
      } else {
        setSubtasksMap({})
      }
    } catch (e) { console.error(e) }
  }

  async function refreshAll() { await Promise.all([refreshDotDates(), refreshMonthTodos()]) }

  const loadTags = useCallback(async () => {
    try { setTags(await getScheduleTags()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { refreshAll() }, [ym])
  useEffect(() => { loadTags() }, [loadTags])

  // 监听数据导入事件 — 导入完成后刷新日程数据
  const refreshAllRef = useRef(refreshAll)
  const loadTagsRef = useRef(loadTags)
  useEffect(() => { refreshAllRef.current = refreshAll }, [refreshAll])
  useEffect(() => { loadTagsRef.current = loadTags }, [loadTags])
  useEffect(() => {
    const handler = () => { refreshAllRef.current(); loadTagsRef.current() }
    window.addEventListener('data-imported', handler)
    return () => window.removeEventListener('data-imported', handler)
  }, [])

  // ---- calendar navigation ----
  function goToPrevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1)
  }
  function goToNextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1)
  }
  function goToToday() {
    const n = new Date()
    setYear(n.getFullYear()); setMonth(n.getMonth() + 1); setSelectedDate(today)
  }

  function handleViewModeChange(mode: ViewMode) { setViewMode(mode) }

  async function openQuadrantChart() { await refreshMonthTodos(); setQuadrantOpen(true) }

  // ---- tag management ----
  async function handleCreateTag(name: string, color: string): Promise<ScheduleTag> {
    const tag = await createScheduleTag(name, color); await loadTags(); return tag
  }
  async function handleDeleteTag(id: string) { await deleteScheduleTag(id); await loadTags() }

  // ---- CRUD ----
  function openEdit(todo: ScheduleTodo) { setEditTarget(todo); setModalOpen(true) }

  async function handleSave(form: { title: string; description: string; time: string; quadrant: number; taskType: 'deadline' | 'plan' | 'daily'; tagId: string; endCriteria: string }) {
    const dto: CreateScheduleTodoDTO = {
      title: form.title, description: form.description,
      date: editTarget ? editTarget.date : today,
      time: form.taskType === 'deadline' ? form.time : undefined,
      quadrant: form.quadrant, taskType: form.taskType,
      tagId: form.tagId || undefined,
      endCriteria: form.taskType === 'plan' ? form.endCriteria : undefined
    }
    try {
      if (editTarget) {
        await updateScheduleTodo(editTarget.id, {
          title: form.title, description: form.description,
          time: form.taskType === 'deadline' ? form.time : null,
          quadrant: form.quadrant, taskType: form.taskType,
          tagId: form.tagId || null,
          endCriteria: form.taskType === 'plan' ? form.endCriteria : ''
        })
      } else { await createScheduleTodo(dto) }
      setModalOpen(false); setEditTarget(null); await refreshAll()
    } catch (e) { console.error(e) }
  }

  async function handleToggleDone(todo: ScheduleTodo) {
    await updateScheduleTodo(todo.id, { status: todo.status === 'done' ? 'pending' : 'done' })
    await refreshAll()
  }

  async function handleRestoreDone(id: string) {
    await updateScheduleTodo(id, { status: 'pending' })
    await refreshAll()
  }

  const [showDone, setShowDone] = useState(false)

  async function handleDelete(id: string) { await deleteScheduleTodo(id); await refreshAll() }

  // ---- 当日任务 ----
  const [dailyInput, setDailyInput] = useState('')

  async function handleAddDaily() {
    if (!dailyInput.trim()) return
    try {
      await createScheduleTodo({ title: dailyInput.trim(), date: today, taskType: 'daily', quadrant: 3 })
      setDailyInput('')
      await refreshAll()
    } catch (e) { console.error(e) }
  }

  async function handleToggleSubtaskAny(id: string) {
    // Find subtask in subtasksMap
    for (const subs of Object.values(subtasksMap)) {
      const st = subs.find(s => s.id === id)
      if (st) {
        await updateScheduleTodo(id, { status: st.status === 'done' ? 'pending' : 'done' })
        await refreshAll()
        return
      }
    }
  }

  async function handleDeleteSubtaskAny(id: string) {
    await deleteScheduleTodo(id)
    await refreshAll()
  }

  async function handleMigrateDaily(id: string) { await updateScheduleTodo(id, { date: today }); await refreshAll() }

  // ---- derived data (ALL tasks, including done) ----
  const allWithTags = useMemo(() =>
    monthTodos.map(t => ({
      ...t,
      tag: t.tagId ? tags.find(tg => tg.id === t.tagId) ?? null : null,
      subtasks: subtasksMap[t.id] || undefined,
    })),
    [monthTodos, tags, subtasksMap]
  )

  const pendingTodos = useMemo(() => allWithTags.filter(t => t.status === 'pending'), [allWithTags])
  const doneTodos = useMemo(() => allWithTags.filter(t => t.status === 'done'), [allWithTags])

  // 已完成按日期分组
  const doneByDate = useMemo(() => {
    const groups: Record<string, typeof doneTodos> = {}
    for (const t of doneTodos) (groups[t.date] ??= []).push(t)
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [doneTodos])

  // Today's date string
  const todayDateStr = localToday()

  // 当日任务
  const dailyTasks = useMemo(() => pendingTodos.filter(t => t.taskType === 'daily'), [pendingTodos])
  const dailyToday = useMemo(() => dailyTasks.filter(t => t.date === todayDateStr), [dailyTasks, todayDateStr])
  const dailyExpired = useMemo(() => dailyTasks.filter(t => t.date < todayDateStr), [dailyTasks, todayDateStr])

  // deadline mode: split pending deadline tasks into overdue vs upcoming
  const deadlineUpcoming = useMemo(() =>
    pendingTodos
      .filter(t => t.taskType === 'deadline' && t.time)
      .filter(t => (t.time || '').slice(0, 10) >= todayDateStr)
      .sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [pendingTodos, todayDateStr]
  )

  const deadlineOverdue = useMemo(() =>
    pendingTodos
      .filter(t => t.taskType === 'deadline' && t.time)
      .filter(t => (t.time || '').slice(0, 10) < todayDateStr)
      .sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [pendingTodos, todayDateStr]
  )

  // deadline mode: done deadline tasks
  const deadlineDone = useMemo(() =>
    doneTodos
      .filter(t => t.taskType === 'deadline' && t.time)
      .sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [doneTodos]
  )

  // quadrant mode: pending only, grouped
  const quadrantGrouped = useMemo(() => {
    const groups: Record<number, typeof pendingTodos> = { 0: [], 1: [], 2: [], 3: [] }
    for (const t of pendingTodos) groups[t.quadrant].push(t)
    return groups
  }, [pendingTodos])

  // date mode: pending for selected date
  const dateTodos = useMemo(() =>
    pendingTodos.filter(t => t.date === selectedDate),
    [pendingTodos, selectedDate]
  )
  const dateRegular = useMemo(() => dateTodos.filter(t => t.taskType !== 'daily'), [dateTodos])
  const dateDaily = useMemo(() => dateTodos.filter(t => t.taskType === 'daily'), [dateTodos])

  const editSubtasks = editTarget ? (subtasksMap[editTarget.id] || []) : []

  // ---- helpers ----
  const modalInitial = editTarget
    ? { title: editTarget.title, description: editTarget.description,
        time: editTarget.time || '', quadrant: editTarget.quadrant,
        taskType: editTarget.taskType, tagId: editTarget.tagId || '',
        endCriteria: editTarget.endCriteria || '' }
    : { title: '', description: '', time: '', quadrant: 1, taskType: 'plan' as const, tagId: '', endCriteria: '' }

  // ---- subtask handlers ----
  async function handleToggleSubtask(id: string) {
    const st = editSubtasks.find(s => s.id === id)
    if (!st) return
    await updateScheduleTodo(id, { status: st.status === 'done' ? 'pending' : 'done' })
    await refreshAll()
  }

  async function handleDeleteSubtask(id: string) {
    await deleteScheduleTodo(id)
    await refreshAll()
  }

  async function handleCreateSubtask(data: { title: string; date: string; taskType: 'daily' }) {
    if (!editTarget) return
    const dto: CreateScheduleTodoDTO = {
      title: data.title, date: data.date, taskType: 'daily',
      parentId: editTarget.id,
    }
    await createScheduleTodo(dto)
    await refreshAll()
  }

  const viewTitle =
    viewMode === 'deadline' ? '截至时间线' :
    viewMode === 'quadrant' ? '四象限排列' :
    `${selectedDate === today ? `${selectedDate} 今天` : selectedDate}`

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditingInput(e)) return
      // Ctrl+N — open new task modal
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        setEditTarget(null)
        setModalOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      <ResizablePanel storageKey="sidebarWidth_schedule" defaultWidth={280} minWidth={220} maxWidth={450} visible={sidebarOpen} initialWidth={sidebarWidths.sidebarWidth_schedule}>
        <CalendarView
          year={year} month={month} selectedDate={selectedDate}
          dotDates={dotDates} deadlineCounts={deadlineCounts}
          viewMode={viewMode}
          onSelectDate={setSelectedDate}
          onPrevMonth={goToPrevMonth} onNextMonth={goToNextMonth}
          onToday={goToToday} onViewModeChange={handleViewModeChange}
          onQuadrantChart={openQuadrantChart}
        />
      </ResizablePanel>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
          <h3 className={`${INPUT_SZ[iconSize].sectionTitle} font-medium text-[var(--text-primary)]`}>{viewTitle}</h3>
          <div className="flex items-center gap-2">
            <div className="relative" ref={sizeMenuRef}>
              <button onClick={() => setSizeMenuOpen(v => !v)}
                className={`px-2 py-1.5 ${INPUT_SZ[iconSize].meta} border border-[#4a4a4a] text-[var(--text-secondary)] rounded hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1`}
                title="卡片大小">
                <Maximize2 size={INPUT_SZ[iconSize].metaIcon + 3} /> {iconSizeLabel}
              </button>
              {sizeMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-24 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-xl py-1 z-50" onClick={e => e.stopPropagation()}>
                  {(['sm', 'md', 'lg'] as const).map(s => (
                    <button key={s} onClick={() => setSize(s)}
                      className={`w-full text-left px-3 py-1.5 ${INPUT_SZ[iconSize].meta} hover:bg-[var(--bg-hover)] ${iconSize === s ? 'text-[var(--text-primary)] bg-[var(--bg-selected)]' : 'text-[var(--text-secondary)]'}`}>
                      {s === 'sm' ? '小' : s === 'md' ? '中' : '大'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setTagManageOpen(true)}
              className={`px-3 py-1.5 ${INPUT_SZ[iconSize].meta} border border-[#4a4a4a] text-[var(--text-secondary)] rounded hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors`}>
              管理标签
            </button>
            <button onClick={() => { setEditTarget(null); setModalOpen(true) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 ${INPUT_SZ[iconSize].meta} bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors`}>
              <Plus size={INPUT_SZ[iconSize].metaIcon + 5} /> 添加任务
            </button>
          </div>
        </div>

        {/* 当日任务快速添加条 */}
        <div className={`flex items-center gap-2 px-6 ${INPUT_SZ[iconSize].padY} border-b border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0`}>
          <Zap size={INPUT_SZ[iconSize].icon} className="text-[var(--warning)] shrink-0" />
          <input
            value={dailyInput}
            onChange={e => setDailyInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddDaily() }}
            placeholder={INPUT_SZ[iconSize].placeholder}
            className={`flex-1 bg-transparent ${INPUT_SZ[iconSize].text} text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]`}
          />
          {dailyInput && (
            <button onClick={handleAddDaily} className={`px-2.5 py-1 ${INPUT_SZ[iconSize].text} bg-[var(--warning)] text-[var(--bg-primary)] rounded font-medium`}>
              添加
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* ===== EXPIRED DAILY TASKS ===== */}
          {dailyExpired.length > 0 && (selectedDate === today || viewMode !== 'date') && (
            <div className="mb-4 p-3 bg-[#2a2a1e] border border-[var(--border-color)] rounded">
              <p className={`${INPUT_SZ[iconSize].meta} text-[var(--warning)] mb-2`}>📌 {dailyExpired.length} 项过期当日任务</p>
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto">
                {dailyExpired.map(t => (
                  <div key={t.id} className={`flex items-center gap-2 ${INPUT_SZ[iconSize].meta} text-[var(--text-secondary)]`}>
                    <span className="flex-1 truncate line-through">{t.title}</span>
                    <span className={`${INPUT_SZ[iconSize].meta} text-[var(--text-disabled)]`}>{t.date.slice(5)}</span>
                    <button onClick={() => handleMigrateDaily(t.id)}
                      className={`px-1.5 py-0.5 ${INPUT_SZ[iconSize].meta} text-[var(--accent)] hover:bg-[#007acc20] rounded flex items-center gap-0.5`}>
                      <RotateCcw size={INPUT_SZ[iconSize].metaIcon} /> 迁移
                    </button>
                    <button onClick={() => handleDelete(t.id)}
                      className={`px-1.5 py-0.5 ${INPUT_SZ[iconSize].meta} text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[#e8112320] rounded flex items-center gap-0.5`}>
                      <Trash2 size={INPUT_SZ[iconSize].metaIcon} /> 丢弃
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== DATE MODE ===== */}
          {viewMode === 'date' && (
            (dateRegular.length === 0 && dateDaily.length === 0) ? <EmptyHint /> : (
              <div className="space-y-4">
                {dateDaily.length > 0 && (
                  <div>
                    <h4 className={`${INPUT_SZ[iconSize].meta} font-medium text-[var(--warning)] mb-2 flex items-center gap-1.5`}>
                      <Zap size={INPUT_SZ[iconSize].metaIcon + 3} /> {selectedDate === today ? '今日零碎任务' : '当日任务'} · {dateDaily.length}
                    </h4>
                    <div className="space-y-1.5">
                      {dateDaily.map(todo => (
                        <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize}
                          onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} onToggleSubtask={handleToggleSubtaskAny} onDeleteSubtask={handleDeleteSubtaskAny} />
                      ))}
                    </div>
                  </div>
                )}
                {dateRegular.length > 0 && (
                  <div>
                    {dateDaily.length > 0 && <h4 className={`${INPUT_SZ[iconSize].meta} font-medium text-[#569cd6] mb-2`}>📋 正式任务 · {dateRegular.length}</h4>}
                    <div className="space-y-2">
                      {dateRegular.map(todo => (
                        <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize}
                          onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} onToggleSubtask={handleToggleSubtaskAny} onDeleteSubtask={handleDeleteSubtaskAny} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {/* ===== DEADLINE MODE ===== */}
          {viewMode === 'deadline' && (deadlineOverdue.length === 0 && deadlineUpcoming.length === 0 && deadlineDone.length === 0 ? (
            <EmptyHint text="本月无截止类任务" />
          ) : (
            <div className="space-y-4">
              {deadlineOverdue.length > 0 && (
                <div>
                  <h4 className={`${INPUT_SZ[iconSize].meta} font-medium text-red-400 mb-2`}>⚠ 超期未完成 ({deadlineOverdue.length})</h4>
                  <div className="space-y-2">
                    {deadlineOverdue.map(todo => (
                      <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize} showRemaining
                        onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} onToggleSubtask={handleToggleSubtaskAny} onDeleteSubtask={handleDeleteSubtaskAny} />
                    ))}
                  </div>
                </div>
              )}

              {/* 即将截止 */}
              {deadlineUpcoming.length > 0 && (
                <div>
                  <h4 className={`${INPUT_SZ[iconSize].meta} font-medium text-[#569cd6] mb-2`}>⏰ 即将截止 ({deadlineUpcoming.length})</h4>
                  <div className="space-y-2">
                    {deadlineUpcoming.map(todo => (
                      <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize} showRemaining
                        onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} onToggleSubtask={handleToggleSubtaskAny} onDeleteSubtask={handleDeleteSubtaskAny} />
                    ))}
                  </div>
                </div>
              )}

              {/* 已完成 */}
              {deadlineDone.length > 0 && (
                <div>
                  <h4 className={`${INPUT_SZ[iconSize].meta} font-medium text-[var(--text-muted)] mb-2`}>✅ 已完成 ({deadlineDone.length})</h4>
                  <div className="space-y-2">
                    {deadlineDone.map(todo => (
                      <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize} showRemaining
                        onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} onToggleSubtask={handleToggleSubtaskAny} onDeleteSubtask={handleDeleteSubtaskAny} />
                    ))}
                  </div>
                </div>
              )}

            </div>
          ))}

          {/* ===== QUADRANT MODE ===== */}
          {viewMode === 'quadrant' && (
            <div className="space-y-4">
              {([0, 1, 2, 3] as const).map(q => {
                const items = quadrantGrouped[q]
                return (
                  <div key={q}>
                    <h4 className={`${INPUT_SZ[iconSize].meta} font-medium ${QUADRANT_COLORS[q]} mb-2`}>{QUADRANT_LABELS[q]} ({items.length})</h4>
                    {items.length === 0 ? <p className={`${INPUT_SZ[iconSize].meta} text-[var(--text-disabled)] italic ml-1`}>暂无</p> : (
                      <div className="space-y-2">
                        {items.map(todo => (
                          <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize}
                            onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} onToggleSubtask={handleToggleSubtaskAny} onDeleteSubtask={handleDeleteSubtaskAny} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ===== COMPLETED TASKS ===== */}
        {doneTodos.length > 0 && (
          <div className="border-t border-[var(--border-color)] shrink-0">
            <button
              onClick={() => setShowDone(v => !v)}
              className={`flex items-center justify-between w-full px-6 py-2.5 ${INPUT_SZ[iconSize].meta} text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors`}
            >
              <span className="flex items-center gap-2">
                <Check size={INPUT_SZ[iconSize].metaIcon + 4} />
                已完成 · {doneTodos.length} 项
                <span className={`${INPUT_SZ[iconSize].meta} text-[var(--text-disabled)]`}>（7天后自动清空）</span>
              </span>
              <ChevronDown size={INPUT_SZ[iconSize].metaIcon + 4} className={`transition-transform ${showDone ? 'rotate-180' : ''}`} />
            </button>
            {showDone && (
              <div className="px-6 py-3 max-h-[260px] overflow-y-auto space-y-3">
                {doneByDate.map(([date, items]) => (
                  <div key={date}>
                    <h4 className={`${INPUT_SZ[iconSize].meta} font-medium text-[var(--text-disabled)] mb-1.5`}>{date} · {items.length} 项</h4>
                    <div className="space-y-1.5">
                      {items.map(todo => (
                        <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize}
                          onClick={() => openEdit(todo)}
                          onToggleDone={() => handleToggleDone(todo)}
                          onRestore={() => handleRestoreDone(todo.id)}
                          onDelete={() => handleDelete(todo.id)} onToggleSubtask={handleToggleSubtaskAny} onDeleteSubtask={handleDeleteSubtaskAny} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <TodoEditModal
        open={modalOpen} initial={modalInitial} tags={tags} onSave={handleSave}
        onClose={() => { setModalOpen(false); setEditTarget(null) }}
        subtasks={editSubtasks}
        onToggleSubtask={handleToggleSubtask}
        onDeleteSubtask={handleDeleteSubtask}
        onCreateSubtask={handleCreateSubtask}
      />
      <QuadrantChart open={quadrantOpen} todos={pendingTodos} tags={tags} onClose={() => setQuadrantOpen(false)} />
      <TagManageModal open={tagManageOpen} tags={tags} onClose={() => setTagManageOpen(false)} onCreateTag={handleCreateTag} onDeleteTag={handleDeleteTag} />
    </div>
  )
}

function EmptyHint({ text = '暂无任务' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
      <div className="text-4xl mb-3">📅</div>
      <p className="text-[13px]">{text}</p>
      <p className="text-[11px] mt-1">点击"添加任务"创建第一个待办</p>
    </div>
  )
}
