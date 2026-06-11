import { useState, useEffect, useCallback } from 'react'
import { Plus } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag, CreateScheduleTodoDTO, UpdateScheduleTodoDTO } from '../../types'
import {
  getScheduleTodos, getScheduleDates, createScheduleTodo,
  updateScheduleTodo, deleteScheduleTodo, getScheduleTags, createScheduleTag
} from '../../lib/ipc'
import { CalendarView } from './views/CalendarView'
import { TodoItem } from './components/TodoItem'
import { TodoEditModal } from './components/TodoEditModal'

export function ScheduleModule() {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [todos, setTodos] = useState<ScheduleTodo[]>([])
  const [dotDates, setDotDates] = useState<Set<string>>(new Set())
  const [tags, setTags] = useState<ScheduleTag[]>([])

  // modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduleTodo | null>(null)

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
    } catch (e) { console.error(e) }
  }, [year, month])

  const loadTags = useCallback(async () => {
    try { setTags(await getScheduleTags()) }
    catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadTodos(selectedDate) }, [selectedDate, loadTodos])
  useEffect(() => { loadDotDates() }, [loadDotDates])
  useEffect(() => { loadTags() }, [loadTags])

  // ---- calendar navigation ----
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

  // ---- CRUD ----
  function openCreate() {
    setEditTarget(null); setModalOpen(true)
  }
  function openEdit(todo: ScheduleTodo) {
    setEditTarget(todo); setModalOpen(true)
  }

  async function handleSave(form: { title: string; description: string; date: string; time: string; quadrant: number; taskType: 'deadline' | 'plan'; tagId: string }) {
    const dto: CreateScheduleTodoDTO = {
      title: form.title,
      description: form.description,
      date: form.date,
      time: form.time || undefined,
      quadrant: form.quadrant,
      taskType: form.taskType,
      tagId: form.tagId || undefined
    }
    try {
      if (editTarget) {
        const upd: UpdateScheduleTodoDTO = { ...dto }
        await updateScheduleTodo(editTarget.id, upd)
      } else {
        await createScheduleTodo(dto)
      }
      setModalOpen(false); setEditTarget(null)
      loadTodos(selectedDate); loadDotDates()
      if (form.date !== selectedDate) setSelectedDate(form.date)
    } catch (e) { console.error(e) }
  }

  async function handleToggleDone(todo: ScheduleTodo) {
    try {
      await updateScheduleTodo(todo.id, { status: todo.status === 'done' ? 'pending' : 'done' })
      loadTodos(selectedDate)
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    try {
      await deleteScheduleTodo(id)
      loadTodos(selectedDate); loadDotDates()
    } catch (e) { console.error(e) }
  }

  async function handleCreateTag(name: string, color: string): Promise<ScheduleTag> {
    const tag = await createScheduleTag(name, color)
    loadTags()
    return tag
  }

  // ---- helpers ----
  const todosWithTags = todos.map(t => ({
    ...t,
    tag: t.tagId ? tags.find(tg => tg.id === t.tagId) ?? null : null
  }))

  const modalInitial = editTarget
    ? { title: editTarget.title, description: editTarget.description, date: editTarget.date,
        time: editTarget.time || '', quadrant: editTarget.quadrant,
        taskType: editTarget.taskType, tagId: editTarget.tagId || '' }
    : { title: '', description: '', date: selectedDate, time: '',
        quadrant: 1, taskType: 'plan' as const, tagId: '' }

  const dateLabel = selectedDate === today ? `${selectedDate} 今天` : selectedDate

  return (
    <div className="flex h-full bg-[#1e1e1e]">
      <CalendarView
        year={year} month={month}
        selectedDate={selectedDate}
        dotDates={dotDates}
        onSelectDate={setSelectedDate}
        onPrevMonth={goToPrevMonth}
        onNextMonth={goToNextMonth}
        onToday={goToToday}
      />

      {/* right panel: todo list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* date header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
          <h3 className="text-[15px] font-medium text-[#cccccc]">{dateLabel}</h3>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4] transition-colors"
          >
            <Plus size={15} /> 添加任务
          </button>
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
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  tag={todo.tag}
                  onClick={() => openEdit(todo)}
                  onToggleDone={() => handleToggleDone(todo)}
                  onDelete={() => handleDelete(todo.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* modal */}
      <TodoEditModal
        open={modalOpen}
        initial={modalInitial}
        tags={tags}
        onSave={handleSave}
        onClose={() => { setModalOpen(false); setEditTarget(null) }}
        onCreateTag={handleCreateTag}
      />
    </div>
  )
}
