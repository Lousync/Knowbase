import { useState, useEffect } from 'react'
import type { ScheduleTag } from '../../../types'
import { X } from 'lucide-react'

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
}

const QUADRANTS = [
  { value: 0, label: '🔥 紧急重要' },
  { value: 1, label: '📌 重要不紧急' },
  { value: 2, label: '⚡ 紧急不重要' },
  { value: 3, label: '💤 不重要不紧急' },
]

export function TodoEditModal({ open, initial, tags, onSave, onClose }: Props) {
  const [form, setForm] = useState<TodoForm>(initial)
  const [timeWarning, setTimeWarning] = useState('')

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
      <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg w-[500px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#3c3c3c]">
          <h3 className="text-[14px] font-medium text-[#cccccc]">{initial.title ? '编辑任务' : '新建任务'}</h3>
          <button onClick={onClose} className="p-1 text-[#6a6a6a] hover:text-[#cccccc]"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="标题">
            <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="任务标题"
              className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none"
            />
          </Field>

          <Field label="描述">
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="可选描述" rows={2}
              className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none resize-none"
            />
          </Field>

          <Field label="任务类型">
            <div className="flex gap-2">
              <button onClick={() => setForm(f => ({ ...f, taskType: 'daily' }))}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${form.taskType === 'daily' ? 'border-[#c5a332] bg-[#c5a33220] text-[#d4d4d4]' : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'}`}
              >⚡ 琐碎</button>
              <button onClick={() => setForm(f => ({ ...f, taskType: 'plan' }))}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${form.taskType === 'plan' ? 'border-[#007acc] bg-[#007acc20] text-[#d4d4d4]' : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'}`}
              >📋 计划类</button>
              <button onClick={() => {
                const n = new Date()
                const t = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`
                const dp = parseDeadline(t)
                setDStr({ year: String(dp.year), month: String(dp.month), day: String(dp.day), hour: String(dp.hour), minute: String(dp.minute) })
                setForm(f => ({ ...f, taskType: 'deadline', time: t }))
              }}
                className={`flex-1 py-2 text-[13px] rounded border transition-colors ${form.taskType === 'deadline' ? 'border-[#007acc] bg-[#007acc20] text-[#d4d4d4]' : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'}`}
              >⏰ 截止类</button>
            </div>
          </Field>

          {/* 截止时间 */}
          {form.taskType === 'deadline' && (
            <Field label="截止时间">
              <div className="bg-[#2d2d2d] rounded-lg p-4 border border-[#3c3c3c] space-y-3">
                {/* 日期 */}
                <div className="flex items-center gap-1.5">
                  <input type="text" inputMode="numeric" value={dStr.year}
                    onChange={e => onDeadlinePartChange('year', e.target.value)}
                    className="w-[72px] px-2 py-2 bg-[#3c3c3c] border border-[#555] rounded text-center text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none" />
                  <span className="text-[#6a6a6a] text-[13px] shrink-0">年</span>
                  <input type="text" inputMode="numeric" value={dStr.month}
                    onChange={e => onDeadlinePartChange('month', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[#3c3c3c] border border-[#555] rounded text-center text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none" />
                  <span className="text-[#6a6a6a] text-[13px] shrink-0">月</span>
                  <input type="text" inputMode="numeric" value={dStr.day}
                    onChange={e => onDeadlinePartChange('day', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[#3c3c3c] border border-[#555] rounded text-center text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none" />
                  <span className="text-[#6a6a6a] text-[13px] shrink-0">日</span>
                  <span className="text-[#555] text-[14px] shrink-0 ml-2 mr-1">·</span>
                  <input type="text" inputMode="numeric" value={dStr.hour}
                    onChange={e => onDeadlinePartChange('hour', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[#3c3c3c] border border-[#555] rounded text-center text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none" />
                  <span className="text-[#6a6a6a] text-[13px] shrink-0">时</span>
                  <input type="text" inputMode="numeric" value={dStr.minute}
                    onChange={e => onDeadlinePartChange('minute', e.target.value)}
                    className="w-[48px] px-2 py-2 bg-[#3c3c3c] border border-[#555] rounded text-center text-[14px] text-[#d4d4d4] focus:border-[#007acc] outline-none" />
                  <span className="text-[#6a6a6a] text-[13px] shrink-0">分</span>
                </div>
              </div>
              {timeWarning && (
                <p className={`text-[11px] mt-1 ${timeWarning.includes('早于') ? 'text-red-400' : 'text-yellow-400'}`}>⚠ {timeWarning}</p>
              )}
            </Field>
          )}

          {form.taskType === 'plan' && (
            <Field label="结束标准">
              <textarea value={form.endCriteria} onChange={e => setForm(f => ({ ...f, endCriteria: e.target.value }))}
                placeholder="如：完成3个项目、读完5本书..." rows={2}
                className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#555] rounded text-[13px] text-[#d4d4d4] focus:border-[#007acc] outline-none resize-none"
              />
            </Field>
          )}

          {form.taskType !== 'daily' && (
            <Field label="四象限">
              <div className="flex gap-2">
                {QUADRANTS.map(q => (
                  <button key={q.value} onClick={() => setForm(f => ({ ...f, quadrant: q.value }))}
                    className={`flex-1 py-1.5 text-[12px] rounded border transition-colors ${form.quadrant === q.value ? 'border-[#007acc] bg-[#007acc20] text-[#d4d4d4]' : 'border-[#3c3c3c] text-[#969696] hover:border-[#555]'}`}
                  >{q.label}</button>
                ))}
              </div>
            </Field>
          )}

          <Field label="标签">
            {tags.length === 0 ? (
              <p className="text-[12px] text-[#555] italic">暂无标签，使用右侧按钮创建</p>
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

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#3c3c3c]">
          <button onClick={onClose} className="px-4 py-1.5 text-[13px] text-[#969696] hover:text-[#cccccc]">取消</button>
          <button onClick={handleSave} disabled={!canSave}
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

function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
