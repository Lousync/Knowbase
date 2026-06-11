import { useState, useEffect } from 'react'
import type { ScheduleTag } from '../../../types'
import { X } from 'lucide-react'

interface TodoForm {
  title: string; description: string; time: string
  quadrant: number; taskType: 'deadline' | 'plan'; tagId: string
  endCriteria: string
}

interface Props {
  open: boolean
  initial: TodoForm
  tags: ScheduleTag[]
  onSave: (data: TodoForm) => void
  onClose: () => void
}

const QUADRANTS = [
  { value: 0, label: '🔥 紧急重要' },
  { value: 1, label: '📌 重要不紧急' },
  { value: 2, label: '⚡ 紧急不重要' },
  { value: 3, label: '💤 不重要不紧急' },
]

export function TodoEditModal({ open, initial, tags, onSave, onClose }: Props) {
  const [form, setForm] = useState<TodoForm>(initial)

  // deadline datetime parts — derived once on open / type switch
  const dp = parseDeadline(form.time)

  useEffect(() => { setForm(initial) }, [initial])

  if (!open) return null

  const canSave = form.title.trim().length > 0

  function setDeadline(part: 'year' | 'month' | 'day' | 'hour' | 'minute', val: string) {
    const d = { ...dp,
      year: dp.year, month: dp.month, day: dp.day, hour: dp.hour, minute: dp.minute,
      [part]: parseInt(val, 10) || 0
    }
    const y = String(d.year).padStart(4, '0')
    const m = String(d.month).padStart(2, '0')
    const day = String(d.day).padStart(2, '0')
    const h = String(d.hour).padStart(2, '0')
    const mi = String(d.minute).padStart(2, '0')
    setForm(f => ({ ...f, time: `${y}-${m}-${day} ${h}:${mi}` }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[#252526] border border-[#3c3c3c] rounded-lg w-[500px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#3c3c3c]">
          <h3 className="text-[14px] font-medium text-[#cccccc]">
            {initial.title ? '编辑任务' : '新建任务'}
          </h3>
          <button onClick={onClose} className="p-1 text-[#6a6a6a] hover:text-[#cccccc]">
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="px-5 py-4 space-y-4">
          <Field label="标题">
            <input
              autoFocus
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="任务标题"
              className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
            />
          </Field>

          <Field label="描述">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="可选描述"
              rows={2}
              className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none resize-none"
            />
          </Field>

          {/* 任务类型 */}
          <Field label="任务类型">
            <div className="flex gap-2">
              <button
                onClick={() => setForm(f => ({ ...f, taskType: 'plan' }))}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${
                  form.taskType === 'plan'
                    ? 'border-[#007acc] bg-[#007acc20] text-[#d4d4d4]'
                    : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'
                }`}
              >
                📋 计划类
              </button>
              <button
                onClick={() => {
                  const now = new Date()
                  const t = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
                  setForm(f => ({ ...f, taskType: 'deadline', time: t }))
                }}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${
                  form.taskType === 'deadline'
                    ? 'border-[#007acc] bg-[#007acc20] text-[#d4d4d4]'
                    : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'
                }`}
              >
                ⏰ 截止类
              </button>
            </div>
          </Field>

          {/* 截止时间（仅 deadline） */}
          {form.taskType === 'deadline' && (
            <Field label="截止时间">
              <div className="flex items-center gap-2 bg-[#2d2d2d] rounded-lg p-3 border border-[#3c3c3c]">
                <input
                  type="number" min={2024} max={2035}
                  value={dp.year}
                  onChange={e => setDeadline('year', e.target.value)}
                  className="w-16 px-2 py-1.5 bg-[#3c3c3c] border border-[#555] rounded text-center text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
                  placeholder="年"
                />
                <span className="text-[#6a6a6a]">/</span>
                <input
                  type="number" min={1} max={12}
                  value={dp.month}
                  onChange={e => setDeadline('month', e.target.value)}
                  className="w-12 px-2 py-1.5 bg-[#3c3c3c] border border-[#555] rounded text-center text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
                  placeholder="月"
                />
                <span className="text-[#6a6a6a]">/</span>
                <input
                  type="number" min={1} max={31}
                  value={dp.day}
                  onChange={e => setDeadline('day', e.target.value)}
                  className="w-12 px-2 py-1.5 bg-[#3c3c3c] border border-[#555] rounded text-center text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
                  placeholder="日"
                />
                <span className="text-[#6a6a6a] mx-1">—</span>
                <input
                  type="number" min={0} max={23}
                  value={dp.hour}
                  onChange={e => setDeadline('hour', e.target.value)}
                  className="w-12 px-2 py-1.5 bg-[#3c3c3c] border border-[#555] rounded text-center text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
                  placeholder="时"
                />
                <span className="text-[#6a6a6a]">:</span>
                <input
                  type="number" min={0} max={59}
                  value={dp.minute}
                  onChange={e => setDeadline('minute', e.target.value)}
                  className="w-12 px-2 py-1.5 bg-[#3c3c3c] border border-[#555] rounded text-center text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
                  placeholder="分"
                />
              </div>
            </Field>
          )}

          {/* 结束标准（仅计划类） */}
          {form.taskType === 'plan' && (
            <Field label="结束标准">
              <textarea
                value={form.endCriteria}
                onChange={e => setForm(f => ({ ...f, endCriteria: e.target.value }))}
                placeholder="如：完成3个项目、读完5本书..."
                rows={2}
                className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none resize-none"
              />
            </Field>
          )}

          {/* 四象限 */}
          <Field label="四象限">
            <div className="flex gap-2">
              {QUADRANTS.map(q => (
                <button
                  key={q.value}
                  onClick={() => setForm(f => ({ ...f, quadrant: q.value }))}
                  className={`flex-1 py-1.5 text-[12px] rounded border transition-colors ${
                    form.quadrant === q.value
                      ? 'border-[#007acc] bg-[#007acc20] text-[#d4d4d4]'
                      : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </Field>

          {/* 标签（仅选择，创建移到外部） */}
          <Field label="标签">
            {tags.length === 0 ? (
              <p className="text-[12px] text-[#555] italic">暂无标签，使用右侧按钮创建</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setForm(f => ({ ...f, tagId: f.tagId === t.id ? '' : t.id }))}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors ${
                      form.tagId === t.id ? 'ring-1 ring-white/40' : ''
                    }`}
                    style={{ backgroundColor: t.color + '30', color: t.color, border: `1px solid ${t.color}50` }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </Field>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#3c3c3c]">
          <button onClick={onClose} className="px-4 py-1.5 text-[13px] text-[#969696] hover:text-[#cccccc]">取消</button>
          <button
            onClick={() => canSave && onSave(form)}
            disabled={!canSave}
            className="px-4 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4] disabled:opacity-40"
          >保存</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-[#6a6a6a] mb-1 uppercase tracking-wider">{label}</label>
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
