import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Maximize2 } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag, CreateScheduleTodoDTO, UpdateScheduleTodoDTO } from '../../types'
import {
  getScheduleTodos, getScheduleDates, getScheduleMonthTodos, getScheduleDeadlineCounts,
  createScheduleTodo, updateScheduleTodo, deleteScheduleTodo, getScheduleTags,
  createScheduleTag, deleteScheduleTag, getSetting, setSetting
} from '../../lib/ipc'
import { CalendarView, type ViewMode } from './views/CalendarView'
import { TodoItem } from './components/TodoItem'
import { TodoEditModal } from './components/TodoEditModal'
import { QuadrantChart } from './components/QuadrantChart'
import { TagManageModal } from './components/TagManageModal'

const QUADRANT_LABELS: Record<number, string> = { 0: '🔥 紧急重要', 1: '📌 重要不紧急', 2: '⚡ 紧急不重要', 3: '💤 不重要不紧急' }
const QUADRANT_COLORS: Record<number, string> = { 0: 'text-red-400', 1: 'text-blue-400', 2: 'text-yellow-400', 3: 'text-gray-400' }

function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function ScheduleModule({ sidebarOpen = true }: { sidebarOpen?: boolean }) {
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

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduleTodo | null>(null)
  const [quadrantOpen, setQuadrantOpen] = useState(false)
  const [tagManageOpen, setTagManageOpen] = useState(false)
  const [iconSize, setIconSize] = useState<'sm' | 'md' | 'lg'>('sm')

  useEffect(() => {
    getSetting('scheduleIconSize').then(v => {
      if (v === 'sm' || v === 'md' || v === 'lg') setIconSize(v)
    })
  }, [])

  const cycleIconSize = () => {
    const next = iconSize === 'sm' ? 'md' : iconSize === 'md' ? 'lg' : 'sm'
    setIconSize(next)
    setSetting('scheduleIconSize', next)
  }

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
    try { setMonthTodos(await getScheduleMonthTodos(ym)) } catch (e) { console.error(e) }
  }

  async function refreshAll() { await Promise.all([refreshDotDates(), refreshMonthTodos()]) }

  const loadTags = useCallback(async () => {
    try { setTags(await getScheduleTags()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { refreshAll() }, [ym])
  useEffect(() => { loadTags() }, [loadTags])

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

  async function handleSave(form: { title: string; description: string; time: string; quadrant: number; taskType: 'deadline' | 'plan'; tagId: string; endCriteria: string }) {
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

  async function handleDelete(id: string) { await deleteScheduleTodo(id); await refreshAll() }

  // ---- derived data (ALL tasks, including done) ----
  const allWithTags = useMemo(() =>
    monthTodos.map(t => ({ ...t, tag: t.tagId ? tags.find(tg => tg.id === t.tagId) ?? null : null })),
    [monthTodos, tags]
  )

  const pendingTodos = useMemo(() => allWithTags.filter(t => t.status === 'pending'), [allWithTags])
  const doneTodos = useMemo(() => allWithTags.filter(t => t.status === 'done'), [allWithTags])

  // Today's date string
  const todayDateStr = localToday()

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

  // ---- helpers ----
  const modalInitial = editTarget
    ? { title: editTarget.title, description: editTarget.description,
        time: editTarget.time || '', quadrant: editTarget.quadrant,
        taskType: editTarget.taskType, tagId: editTarget.tagId || '',
        endCriteria: editTarget.endCriteria || '' }
    : { title: '', description: '', time: '', quadrant: 1, taskType: 'plan' as const, tagId: '', endCriteria: '' }

  const viewTitle =
    viewMode === 'deadline' ? '截至时间线' :
    viewMode === 'quadrant' ? '四象限排列' :
    `${selectedDate === today ? `${selectedDate} 今天` : selectedDate}`

  return (
    <div className="flex h-full bg-[#1e1e1e]">
      <div className={`shrink-0 transition-all duration-200 ease-out overflow-hidden ${sidebarOpen ? 'w-[280px]' : 'w-0'}`}>
        <CalendarView
          year={year} month={month} selectedDate={selectedDate}
          dotDates={dotDates} deadlineCounts={deadlineCounts}
          viewMode={viewMode}
          onSelectDate={setSelectedDate}
          onPrevMonth={goToPrevMonth} onNextMonth={goToNextMonth}
          onToday={goToToday} onViewModeChange={handleViewModeChange}
          onQuadrantChart={openQuadrantChart}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
          <h3 className="text-[15px] font-medium text-[#cccccc]">{viewTitle}</h3>
          <div className="flex items-center gap-2">
            <button onClick={cycleIconSize}
              className="px-2 py-1.5 text-[11px] border border-[#4a4a4a] text-[#969696] rounded hover:border-[#007acc] hover:text-[#cccccc] transition-colors flex items-center gap-1"
              title="卡片图标大小">
              <Maximize2 size={13} /> {iconSizeLabel}
            </button>
            <button onClick={() => setTagManageOpen(true)}
              className="px-3 py-1.5 text-[12px] border border-[#4a4a4a] text-[#969696] rounded hover:border-[#007acc] hover:text-[#cccccc] transition-colors">
              管理标签
            </button>
            <button onClick={() => { setEditTarget(null); setModalOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4] transition-colors">
              <Plus size={15} /> 添加任务
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* ===== DATE MODE ===== */}
          {viewMode === 'date' && (
            dateTodos.length === 0 ? <EmptyHint /> : (
              <div className="space-y-2">
                {dateTodos.map(todo => (
                  <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize}
                    onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} />
                ))}
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
                  <h4 className="text-[12px] font-medium text-red-400 mb-2">⚠ 超期未完成 ({deadlineOverdue.length})</h4>
                  <div className="space-y-2">
                    {deadlineOverdue.map(todo => (
                      <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize} showRemaining
                        onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} />
                    ))}
                  </div>
                </div>
              )}

              {/* 即将截止 */}
              {deadlineUpcoming.length > 0 && (
                <div>
                  <h4 className="text-[12px] font-medium text-[#569cd6] mb-2">⏰ 即将截止 ({deadlineUpcoming.length})</h4>
                  <div className="space-y-2">
                    {deadlineUpcoming.map(todo => (
                      <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize} showRemaining
                        onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} />
                    ))}
                  </div>
                </div>
              )}

              {/* 已完成 */}
              {deadlineDone.length > 0 && (
                <div>
                  <h4 className="text-[12px] font-medium text-[#6a6a6a] mb-2">✅ 已完成 ({deadlineDone.length})</h4>
                  <div className="space-y-2">
                    {deadlineDone.map(todo => (
                      <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize} showRemaining
                        onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} />
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
                    <h4 className={`text-[12px] font-medium ${QUADRANT_COLORS[q]} mb-2`}>{QUADRANT_LABELS[q]} ({items.length})</h4>
                    {items.length === 0 ? <p className="text-[11px] text-[#555] italic ml-1">暂无</p> : (
                      <div className="space-y-2">
                        {items.map(todo => (
                          <TodoItem key={todo.id} todo={todo} tag={todo.tag} iconSize={iconSize}
                            onClick={() => openEdit(todo)} onToggleDone={() => handleToggleDone(todo)} onDelete={() => handleDelete(todo.id)} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <TodoEditModal open={modalOpen} initial={modalInitial} tags={tags} onSave={handleSave} onClose={() => { setModalOpen(false); setEditTarget(null) }} />
      <QuadrantChart open={quadrantOpen} todos={pendingTodos} tags={tags} onClose={() => setQuadrantOpen(false)} />
      <TagManageModal open={tagManageOpen} tags={tags} onClose={() => setTagManageOpen(false)} onCreateTag={handleCreateTag} onDeleteTag={handleDeleteTag} />
    </div>
  )
}

function EmptyHint({ text = '暂无任务' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-[#6a6a6a]">
      <div className="text-4xl mb-3">📅</div>
      <p className="text-[13px]">{text}</p>
      <p className="text-[11px] mt-1">点击"添加任务"创建第一个待办</p>
    </div>
  )
}
