import { useState, useEffect, useCallback } from 'react'
import { Plus } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag, CreateScheduleTodoDTO, UpdateScheduleTodoDTO } from '../../types'
import {
  getScheduleTodos, getScheduleDates, getScheduleMonthTodos, getScheduleDeadlineCounts,
  createScheduleTodo, updateScheduleTodo, deleteScheduleTodo, getScheduleTags,
  createScheduleTag, deleteScheduleTag
} from '../../lib/ipc'
import { CalendarView } from './views/CalendarView'
import { TodoItem } from './components/TodoItem'
import { TodoEditModal } from './components/TodoEditModal'
import { QuadrantChart } from './components/QuadrantChart'
import { TagManageModal } from './components/TagManageModal'

export function ScheduleModule({ sidebarOpen = true }: { sidebarOpen?: boolean }) {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [todos, setTodos] = useState<ScheduleTodo[]>([])
  const [dotDates, setDotDates] = useState<Set<string>>(new Set())
  const [deadlineCounts, setDeadlineCounts] = useState<Map<string, number>>(new Map())
  const [tags, setTags] = useState<ScheduleTag[]>([])

  // modals
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduleTodo | null>(null)
  const [quadrantOpen, setQuadrantOpen] = useState(false)
  const [tagManageOpen, setTagManageOpen] = useState(false)
  const [monthTodos, setMonthTodos] = useState<ScheduleTodo[]>([])

  // ---- data loading ----
  const loadTodos = useCallback(async (date: string) => {
    try { setTodos(await getScheduleTodos(date)) }
    catch (e) { console.error(e) }
  }, [])

  const loadDotDates = useCallback(async () => {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    try {
      const dates = await getScheduleDates(ym)
      setDotDates(new Set(dates))
      const counts = await getScheduleDeadlineCounts(ym)
      setDeadlineCounts(new Map(Object.entries(counts)))
    } catch (e) { console.error(e) }
  }, [year, month])

  const loadTags = useCallback(async () => {
    try { setTags(await getScheduleTags()) }
    catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadTodos(selectedDate) }, [selectedDate, loadTodos])
  useEffect(() => { loadDotDates() }, [loadDotDates])
  useEffect(() => { loadTags() }, [loadTags])

  // ---- calendar ----
  function goToPrevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function goToNextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }
  function goToToday() {
    const n = new Date()
    setYear(n.getFullYear()); setMonth(n.getMonth() + 1); setSelectedDate(today)
  }

  async function openQuadrantChart() {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    try {
      setMonthTodos(await getScheduleMonthTodos(ym))
      setQuadrantOpen(true)
    } catch (e) { console.error(e) }
  }

  // ---- tag management ----
  async function handleCreateTag(name: string, color: string): Promise<ScheduleTag> {
    const tag = await createScheduleTag(name, color)
    await loadTags()
    return tag
  }

  async function handleDeleteTag(id: string) {
    await deleteScheduleTag(id)
    await loadTags()
  }

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
        const upd: UpdateScheduleTodoDTO = {
          title: form.title, description: form.description,
          time: form.taskType === 'deadline' ? form.time : null,
          quadrant: form.quadrant, taskType: form.taskType,
          tagId: form.tagId || null,
          endCriteria: form.taskType === 'plan' ? form.endCriteria : ''
        }
        await updateScheduleTodo(editTarget.id, upd)
      } else {
        await createScheduleTodo(dto)
      }
      setModalOpen(false); setEditTarget(null)
      loadTodos(selectedDate); loadDotDates()
    } catch (e) { console.error(e) }
  }

  async function handleToggleDone(todo: ScheduleTodo) {
    await updateScheduleTodo(todo.id, { status: todo.status === 'done' ? 'pending' : 'done' })
    loadTodos(selectedDate)
  }

  async function handleDelete(id: string) {
    await deleteScheduleTodo(id)
    loadTodos(selectedDate); loadDotDates()
  }

  // ---- helpers ----
  const todosWithTags = todos.map(t => ({
    ...t,
    tag: t.tagId ? tags.find(tg => tg.id === t.tagId) ?? null : null
  }))

  const modalInitial = editTarget
    ? { title: editTarget.title, description: editTarget.description,
        time: editTarget.time || '', quadrant: editTarget.quadrant,
        taskType: editTarget.taskType, tagId: editTarget.tagId || '',
        endCriteria: editTarget.endCriteria || '' }
    : { title: '', description: '',
        time: '', quadrant: 1, taskType: 'plan' as const, tagId: '',
        endCriteria: '' }

  const dateLabel = selectedDate === today ? `${selectedDate} 今天` : selectedDate

  return (
    <div className="flex h-full bg-[#1e1e1e]">
      {sidebarOpen && (
        <CalendarView
          year={year} month={month} selectedDate={selectedDate}
          dotDates={dotDates} deadlineCounts={deadlineCounts}
          onSelectDate={setSelectedDate}
          onPrevMonth={goToPrevMonth} onNextMonth={goToNextMonth}
          onToday={goToToday} onQuadrantChart={openQuadrantChart}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* header bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
          <h3 className="text-[15px] font-medium text-[#cccccc]">{dateLabel}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTagManageOpen(true)}
              className="px-3 py-1.5 text-[12px] border border-[#4a4a4a] text-[#969696] rounded hover:border-[#007acc] hover:text-[#cccccc] transition-colors"
            >
              管理标签
            </button>
            <button
              onClick={() => { setEditTarget(null); setModalOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4] transition-colors"
            >
              <Plus size={15} /> 添加任务
            </button>
          </div>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {todosWithTags.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#6a6a6a]">
              <div className="text-4xl mb-3">📅</div>
              <p className="text-[13px]">暂无任务</p>
              <p className="text-[11px] mt-1">点击"添加任务"创建第一个待办</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todosWithTags.map(todo => (
                <TodoItem key={todo.id} todo={todo} tag={todo.tag}
                  onClick={() => openEdit(todo)}
                  onToggleDone={() => handleToggleDone(todo)}
                  onDelete={() => handleDelete(todo.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TodoEditModal
        open={modalOpen} initial={modalInitial} tags={tags}
        onSave={handleSave}
        onClose={() => { setModalOpen(false); setEditTarget(null) }}
      />

      <QuadrantChart
        open={quadrantOpen} todos={monthTodos} tags={tags}
        onClose={() => setQuadrantOpen(false)}
      />

      <TagManageModal
        open={tagManageOpen} tags={tags}
        onClose={() => setTagManageOpen(false)}
        onCreateTag={handleCreateTag}
        onDeleteTag={handleDeleteTag}
      />
    </div>
  )
}
