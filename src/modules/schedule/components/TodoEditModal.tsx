import { useState, useEffect } from 'react'
import type { ScheduleTag, ScheduleTodo } from '../../../types'
import { X, Plus, Trash2, Check } from 'lucide-react'

interface TodoForm {
  title: string; description: string; time: string
  quadrant: number; taskType: 'deadline' | 'plan' | 'daily'; tagId: string
  endCriteria: string
}

interface Props {
  open: boolean
  initial: TodoForm
  tags: ScheduleTag[]
  onSave: (data: TodoForm) => void
  onClose: () => void
  subtasks?: ScheduleTodo[]
  onToggleSubtask?: (id: string) => void
  onDeleteSubtask?: (id: string) => void
  onCreateSubtask?: (data: { title: string; date: string; taskType: 'daily' }) => void
}

const QUADRANTS = [
  { value: 0, label: '🔥 紧急重要' },
  { value: 1, label: '📌 重要不紧急' },
  { value: 2, label: '⚡ 紧急不重要' },
  { value: 3, label: '💤 不重要不紧急' },
]

export function TodoEditModal({ open, initial, tags, onSave, onClose, subtasks, onToggleSubtask, onDeleteSubtask, onCreateSubtask }: Props) {
  const [form, setForm] = useState<TodoForm>(initial)
  const [timeWarning, setTimeWarning] = useState('')

  // Sub-task inline form
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskOpen, setSubtaskOpen] = useState(false)

  function handleAddSubtask() {
    if (!subtaskTitle.trim() || !onCreateSubtask) return
    onCreateSubtask({
      title: subtaskTitle.trim(),
      date: new Date().toISOString().slice(0, 10),
      taskType: 'daily',
    })
    setSubtaskTitle('')
    setSubtaskOpen(false)
  }

  // Raw string state for each deadline part (independent of form.time parsing)
  const dp0 = parseDeadline(form.time)
  const [dStr, setDStr] = useState({
    year: String(dp0.year),
    month: String(dp0.month),
    day: String(dp0.day),
    hour: String(dp0.hour),
    minute: String(dp0.minute),
  })

  useEffect(() => { setForm(initial); const dp = parseDeadline(initial.time); setDStr({ year: String(dp.year), month: String(dp.month), day: String(dp.day), hour: String(dp.hour), minute: String(dp.minute) }); setTimeWarning('') }, [initial])

  // Escape key closes modal
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const canSave = form.title.trim().length > 0

  function buildDeadlineTime(p: typeof dStr): string {
    const y = String(parseInt(p.year, 10) || new Date().getFullYear()).padStart(4, '0')
    const mo = String(Math.max(1, Math.min(12, parseInt(p.month, 10) || 1))).padStart(2, '0')
    const d = String(Math.max(1, Math.min(31, parseInt(p.day, 10) || 1))).padStart(2, '0')
    const h = String(Math.max(0, Math.min(23, parseInt(p.hour, 10) || 0))).padStart(2, '0')
    const mi = String(Math.max(0, Math.min(59, parseInt(p.minute, 10) || 0))).padStart(2, '0')
    return `${y}-${mo}-${d} ${h}:${mi}`
  }

  function syncDeadline(p: typeof dStr) {
    setDStr(p)
    setForm(f => ({ ...f, time: buildDeadlineTime(p) }))
  }

  function fixInput(val: string, maxLen: number): string {
    return val.replace(/\D/g, '').slice(0, maxLen)
  }

  /** 规范化 + 验证截止时间 */
  function validateAndCorrect(): { corrected: string; warning: string } {
    const parts = { ...dStr }
    // clamp values
    let y = parseInt(parts.year, 10) || new Date().getFullYear()
    let mo = Math.max(1, Math.min(12, parseInt(parts.month, 10) || 1))
    const dim = new Date(y, mo, 0).getDate()
    let d = Math.max(1, Math.min(dim, parseInt(parts.day, 10) || 1))
    const h = Math.max(0, Math.min(23, parseInt(parts.hour, 10) || 0))
    const mi = Math.max(0, Math.min(59, parseInt(parts.minute, 10) || 0))

    const corrected = `${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`

    // Check: deadline must not be before today
    const targetDate = `${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const td = localToday()
    if (targetDate < td) {
      return { corrected, warning: `截止日期不能早于今天（${td}）` }
    }

    if (corrected !== form.time) {
      return { corrected, warning: '时间已自动修正为有效值' }
    }
    return { corrected, warning: '' }
  }

  function handleSave() {
    if (!canSave) return
    const { corrected, warning } = validateAndCorrect()
    const updated = { ...form, time: corrected }
    setForm(updated)
    // update dStr to match corrected
    const dp = parseDeadline(corrected)
    setDStr({ year: String(dp.year), month: String(dp.month), day: String(dp.day), hour: String(dp.hour), minute: String(dp.minute) })
    if (warning) {
      setTimeWarning(warning)
      if (warning.includes('早于')) return // block save for past dates
      setTimeout(() => setTimeWarning(''), 2500)
    }
    onSave(updated)
  }

  function onDeadlinePartChange(field: keyof typeof dStr, raw: string) {
    const clean = fixInput(raw, field === 'year' ? 4 : 2)
    const next = { ...dStr, [field]: clean }
    syncDeadline(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg w-[500px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-[14px] font-medium text-[var(--text-primary)]">{initial.title ? '编辑任务' : '新建任务'}</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="标题">
            <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="任务标题"
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[14px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
            />
          </Field>

          <Field label="描述">
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="可选描述" rows={2}
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none resize-none"
            />
          </Field>

          <Field label="任务类型">
            <div className="flex gap-2">
              <button onClick={() => setForm(f => ({ ...f, taskType: 'daily' }))}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${form.taskType === 'daily' ? 'border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-color)]'}`}
              >⚡ 琐碎</button>
              <button onClick={() => setForm(f => ({ ...f, taskType: 'plan' }))}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${form.taskType === 'plan' ? 'border-[var(--accent)] bg-[#007acc20] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-color)]'}`}
              >📋 计划类</button>
              <button onClick={() => {
                const n = new Date()
                const t = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`
                const dp = parseDeadline(t)
                setDStr({ year: String(dp.year), month: String(dp.month), day: String(dp.day), hour: String(dp.hour), minute: String(dp.minute) })
                setForm(f => ({ ...f, taskType: 'deadline', time: t }))
              }}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${form.taskType === 'deadline' ? 'border-[var(--accent)] bg-[#007acc20] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-color)]'}`}
              >⏰ 截止类</button>
            </div>
          </Field>

          {/* 截止时间 */}
          {form.taskType === 'deadline' && (
            <Field label="截止时间">
              <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 border border-[var(--border-color)] space-y-3">
                {/* 日期 */}
                <div className="flex items-center gap-1.5">
                  <input type="text" inputMode="numeric" value={dStr.year}
                    onChange={e => onDeadlinePartChange('year', e.target.value)}
                    className="w-[72px] px-2 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-center text-[14px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none" />
                  <span className="text-[var(--text-muted)] text-[13px] shrink-0">年</span>
                  <input type="text" inputMode="numeric" value={dStr.month}
                    onChange={e => onDeadlinePartChange('month', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-center text-[14px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none" />
                  <span className="text-[var(--text-muted)] text-[13px] shrink-0">月</span>
                  <input type="text" inputMode="numeric" value={dStr.day}
                    onChange={e => onDeadlinePartChange('day', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-center text-[14px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none" />
                  <span className="text-[var(--text-muted)] text-[13px] shrink-0">日</span>
                  <span className="text-[var(--text-disabled)] text-[14px] shrink-0 ml-2 mr-1">·</span>
                  <input type="text" inputMode="numeric" value={dStr.hour}
                    onChange={e => onDeadlinePartChange('hour', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-center text-[14px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none" />
                  <span className="text-[var(--text-muted)] text-[13px] shrink-0">时</span>
                  <input type="text" inputMode="numeric" value={dStr.minute}
                    onChange={e => onDeadlinePartChange('minute', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-center text-[14px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none" />
                  <span className="text-[var(--text-muted)] text-[13px] shrink-0">分</span>
                </div>
              </div>
              {timeWarning && (
                <p className={`text-[11px] mt-1 ${timeWarning.includes('早于') ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`}>⚠ {timeWarning}</p>
              )}
            </Field>
          )}

          {form.taskType === 'plan' && (
            <Field label="结束标准">
              <textarea value={form.endCriteria} onChange={e => setForm(f => ({ ...f, endCriteria: e.target.value }))}
                placeholder="如：完成3个项目、读完5本书..." rows={2}
                className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none resize-none"
              />
            </Field>
          )}

          {/* Sub-tasks (plan & deadline tasks only, when editing existing task) */}
          {form.taskType !== 'daily' && initial.title && (
            <Field label={`子任务${subtasks ? ` (${subtasks.length})` : ''}`}>
              <div className="bg-[var(--bg-tertiary)] rounded-lg p-3 border border-[var(--border-color)] space-y-1.5 max-h-[200px] overflow-y-auto">
                {subtasks && subtasks.length > 0 ? (
                  subtasks.map(st => {
                    const isDone = st.status === 'done'
                    return (
                      <div key={st.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-[12px] group ${isDone ? 'opacity-50' : ''}`}>
                        <button
                          onClick={() => onToggleSubtask?.(st.id)}
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isDone ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[#5a5a5a] hover:border-[var(--accent)]'}`}
                          title="切换完成状态"
                        >
                          {isDone && <Check size={10} strokeWidth={3} className="text-white" />}
                        </button>
                        <span className={`flex-1 truncate ${isDone ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{st.title}</span>
                        <button
                          onClick={() => onDeleteSubtask?.(st.id)}
                          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-all"
                          title="删除子任务"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-[11px] text-[var(--text-disabled)] italic text-center py-1">暂无子任务</p>
                )}

                {/* Add subtask inline — simple title-only, like daily tasks */}
                {subtaskOpen ? (
                  <div className="flex items-center gap-1.5 pt-1.5 border-t border-[var(--border-color)]">
                    <input
                      autoFocus
                      value={subtaskTitle}
                      onChange={e => setSubtaskTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddSubtask(); if (e.key === 'Escape') { setSubtaskOpen(false); setSubtaskTitle('') } }}
                      placeholder="子任务标题..."
                      className="flex-1 px-2 py-1.5 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[12px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                    />
                    <button onClick={handleAddSubtask} disabled={!subtaskTitle.trim()}
                      className="px-3 py-1.5 text-[11px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
                    >确认</button>
                    <button onClick={() => { setSubtaskOpen(false); setSubtaskTitle('') }}
                      className="px-2 py-1.5 text-[11px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                    >取消</button>
                  </div>
                ) : (
                  onCreateSubtask && (
                    <button onClick={() => setSubtaskOpen(true)}
                      className="flex items-center gap-1 w-full py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors justify-center"
                    >
                      <Plus size={12} />添加子任务
                    </button>
                  )
                )}
              </div>
            </Field>
          )}

          {form.taskType !== 'daily' && (
            <Field label="四象限">
              <div className="flex gap-2">
                {QUADRANTS.map(q => (
                  <button key={q.value} onClick={() => setForm(f => ({ ...f, quadrant: q.value }))}
                    className={`flex-1 py-1.5 text-[12px] rounded border transition-colors ${form.quadrant === q.value ? 'border-[var(--accent)] bg-[#007acc20] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-color)]'}`}
                  >{q.label}</button>
                ))}
              </div>
            </Field>
          )}

          <Field label="标签">
            {tags.length === 0 ? (
              <p className="text-[12px] text-[var(--text-disabled)] italic">暂无标签，使用右侧按钮创建</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map(t => (
                  <button key={t.id} onClick={() => setForm(f => ({ ...f, tagId: f.tagId === t.id ? '' : t.id }))}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors ${form.tagId === t.id ? 'ring-1 ring-white/40' : ''}`}
                    style={{ backgroundColor: t.color + '30', color: t.color, border: `1px solid ${t.color}50` }}
                  >{t.name}</button>
                ))}
              </div>
            )}
          </Field>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)]">
          <button onClick={onClose} className="px-4 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">取消</button>
          <button onClick={handleSave} disabled={!canSave}
            className="px-4 py-1.5 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >保存</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-[var(--text-muted)] mb-1 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function parseDeadline(time: string | null | undefined) {
  const now = new Date()
  const d = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: 18, minute: 0 }
  if (!time) return d
  const m = time.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  if (!m) return d
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) }
}

function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
