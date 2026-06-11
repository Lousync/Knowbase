import { useState, useEffect } from 'react'
import type { ScheduleTag } from '../../../types'
import { X } from 'lucide-react'

interface TodoForm {
  title: string; description: string; date: string; time: string
  quadrant: number; taskType: 'deadline' | 'plan'; tagId: string
}

interface Props {
  open: boolean
  initial: TodoForm
  tags: ScheduleTag[]
  onSave: (data: TodoForm) => void
  onClose: () => void
  onCreateTag: (name: string, color: string) => Promise<ScheduleTag>
}

const QUADRANTS = [
  { value: 0, label: '🔥 紧急重要' },
  { value: 1, label: '📌 重要不紧急' },
  { value: 2, label: '⚡ 紧急不重要' },
  { value: 3, label: '💤 不重要不紧急' },
]

const TAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280']

export function TodoEditModal({ open, initial, tags, onSave, onClose, onCreateTag }: Props) {
  const [form, setForm] = useState<TodoForm>(initial)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])

  useEffect(() => { setForm(initial) }, [initial])

  if (!open) return null

  const canSave = form.title.trim().length > 0

  async function handleCreateTag() {
    if (!newTagName.trim()) return
    const tag = await onCreateTag(newTagName.trim(), newTagColor)
    setForm(f => ({ ...f, tagId: tag.id }))
    setNewTagName('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[#252526] border border-[#3c3c3c] rounded-lg w-[480px] shadow-2xl"
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
          {/* 标题 */}
          <Field label="标题">
            <input
              autoFocus
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="任务标题"
              className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
            />
          </Field>

          {/* 描述 */}
          <Field label="描述">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="可选描述"
              rows={2}
              className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none resize-none"
            />
          </Field>

          {/* 日期 + 类型 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期">
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
              />
            </Field>
            <Field label="任务类型">
              <select
                value={form.taskType}
                onChange={e => setForm(f => ({ ...f, taskType: e.target.value as 'deadline' | 'plan' }))}
                className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
              >
                <option value="plan">📋 计划类</option>
                <option value="deadline">⏰ 截止类</option>
              </select>
            </Field>
          </div>

          {/* 截止时间（仅 deadline 类显示） */}
          {form.taskType === 'deadline' && (
            <Field label="截止时间">
              <input
                type="text"
                value={form.time}
                onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                placeholder="如 18:00 或 2026-06-30"
                className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
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
                  className={`
                    flex-1 py-1.5 text-[12px] rounded border transition-colors
                    ${form.quadrant === q.value
                      ? 'border-[#007acc] bg-[#007acc20] text-[#d4d4d4]'
                      : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'}
                  `}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </Field>

          {/* 标签 */}
          <Field label="标签">
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map(t => (
                <button
                  key={t.id}
                  onClick={() => setForm(f => ({ ...f, tagId: f.tagId === t.id ? '' : t.id }))}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors
                    ${form.tagId === t.id ? 'ring-1 ring-white/40' : ''}
                  `}
                  style={{ backgroundColor: t.color + '30', color: t.color, border: `1px solid ${t.color}50` }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <div className="flex gap-1">
                {TAG_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewTagColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-colors ${newTagColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <input
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder="新标签名"
                className="flex-1 px-2 py-1 bg-[#3c3c3c] border border-[#555] rounded text-[12px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
                onKeyDown={e => { if (e.key === 'Enter') handleCreateTag() }}
              />
              <button
                onClick={handleCreateTag}
                disabled={!newTagName.trim()}
                className="px-2.5 py-1 text-[12px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4] disabled:opacity-40"
              >
                创建
              </button>
            </div>
          </Field>
        </div>

        {/* footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#3c3c3c]">
          <button onClick={onClose} className="px-4 py-1.5 text-[13px] text-[#969696] hover:text-[#cccccc]">
            取消
          </button>
          <button
            onClick={() => canSave && onSave(form)}
            disabled={!canSave}
            className="px-4 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4] disabled:opacity-40"
          >
            保存
          </button>
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
