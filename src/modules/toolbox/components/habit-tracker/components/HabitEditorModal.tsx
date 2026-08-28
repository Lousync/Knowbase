import { useState } from 'react'
import { X, Trash2, Zap } from 'lucide-react'
import type { Habit, HabitRuleType, HabitLinkSource } from '../../../../../types'
import { createHabit, updateHabit, deleteHabit, habitLinkSave } from '../../../../../lib/ipc'
import { showToast } from '../../../../../lib/toast'
import { ConfirmDialog } from '../../../../../components/shared'

interface Props {
  mode: 'create' | 'edit'
  habit?: Habit
  onClose: () => void
  onSaved: () => void
}

const COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899', '#78716C',
]

const RULE_OPTIONS: { id: HabitRuleType; label: string }[] = [
  { id: 'daily', label: '每天' },
  { id: 'weekdays', label: '每周指定' },
  { id: 'flexible', label: '每周 N 次' },
]

const WEEKDAYS = [
  { value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' },
  { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' }, { value: 0, label: '日' },
]

/** 联动来源:指标现值由主进程从对应源表按业务日期反查 */
const LINK_SOURCES: { id: HabitLinkSource; label: string; unit: string; hint: string }[] = [
  { id: 'blog', label: '写博客日志', unit: '字', hint: '当天日志去空白字数达到阈值' },
  { id: 'pomodoro', label: '完成番茄专注', unit: '次', hint: '当天完成的专注场次达到阈值' },
  { id: 'schedule', label: '完成日程任务', unit: '个', hint: '当天完成的任务数达到阈值' },
  { id: 'knowledge', label: '新建知识页面', unit: '个', hint: '当天新建的页面数达到阈值' },
]

export function HabitEditorModal({ mode, habit, onClose, onSaved }: Props) {
  const [name, setName] = useState(habit?.name ?? '')
  const [color, setColor] = useState(habit?.color ?? COLORS[6])
  const [ruleType, setRuleType] = useState<HabitRuleType>(habit?.ruleType ?? 'daily')
  const [ruleDays, setRuleDays] = useState<number[]>(habit?.ruleDays ?? [1, 2, 3, 4, 5])
  const [weeklyTarget, setWeeklyTarget] = useState<number>(habit?.weeklyTarget ?? 3)
  // 自动完成联动
  const [linkOn, setLinkOn] = useState<boolean>(habit?.link?.enabled === true)
  const [linkSource, setLinkSource] = useState<HabitLinkSource>(habit?.link?.source ?? 'blog')
  const [linkThreshold, setLinkThreshold] = useState<number>(habit?.link?.threshold ?? 100)
  const [saving, setSaving] = useState(false)
  // 删除确认用应用内 ConfirmDialog — Electron 的 window.confirm 会破坏渲染进程键盘焦点,
  // 确认后全应用输入框都无法输入,只能重启(历史 bug),禁止再引入原生对话框
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const canSave = name.trim().length > 0 && (ruleType !== 'weekdays' || ruleDays.length > 0)

  const toggleDay = (d: number) => {
    setRuleDays(days => days.includes(d) ? days.filter(x => x !== d) : [...days, d])
  }

  const handleSave = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      let habitId = habit?.id
      if (mode === 'create') {
        const created = await createHabit({ name: name.trim(), color, ruleType, ruleDays, weeklyTarget })
        habitId = created.id
        showToast({ type: 'info', message: `习惯「${name.trim()}」已创建` })
      } else if (habit) {
        await updateHabit(habit.id, { name: name.trim(), color, ruleType, ruleDays, weeklyTarget })
      }
      // 联动规则随习惯一并保存:关掉开关即解除绑定
      if (habitId) {
        await habitLinkSave(habitId, linkOn ? { source: linkSource, threshold: Math.max(1, Math.round(linkThreshold || 1)), enabled: true } : null)
      }
      onSaved()
    } catch (e) {
      console.error('保存习惯失败', e)
      showToast({ type: 'error', message: '保存失败，请重试' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!habit) return
    try {
      await deleteHabit(habit.id)
      setConfirmDeleteOpen(false)
      onSaved()
    } catch (e) {
      console.error('删除习惯失败', e)
      showToast({ type: 'error', message: '删除失败，请重试' })
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg w-[420px] shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-[14px] font-medium text-[var(--text-primary)]">{mode === 'create' ? '新建习惯' : '编辑习惯'}</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1.5">名称</label>
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}26` }}>
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              </span>
              <input autoFocus value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSave() }}
                placeholder="例如：阅读 30 分钟"
                className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
              />
            </div>
          </div>

          {/* 颜色选择 */}
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1.5">颜色</label>
            <div className="flex gap-1.5 flex-wrap">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 scale-110 ring-[var(--accent)]' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c, ['--tw-ring-offset-color' as never]: 'var(--bg-secondary)' }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* 周期规则 */}
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1.5">打卡规则</label>
            <div className="grid grid-cols-3 gap-1.5 mb-2.5">
              {RULE_OPTIONS.map(o => (
                <button key={o.id} onClick={() => setRuleType(o.id)}
                  className={`py-1.5 text-[12px] rounded border transition-colors ${
                    ruleType === o.id
                      ? 'border-[var(--accent)] bg-[#007acc20] text-[var(--text-primary)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>

            {ruleType === 'weekdays' && (
              <div className="flex gap-1.5">
                {WEEKDAYS.map(w => (
                  <button key={w.value} onClick={() => toggleDay(w.value)}
                    className={`w-8 h-8 rounded-full text-[12px] border transition-colors ${
                      ruleDays.includes(w.value)
                        ? 'border-transparent text-white'
                        : 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                    }`}
                    style={ruleDays.includes(w.value) ? { backgroundColor: color } : undefined}>
                    {w.label}
                  </button>
                ))}
              </div>
            )}

            {ruleType === 'flexible' && (
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-[var(--text-secondary)]">每周至少</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setWeeklyTarget(n => Math.max(1, n - 1))}
                    className="w-7 h-7 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">−</button>
                  <span className="w-10 text-center text-[14px] font-semibold tabular-nums">{weeklyTarget}</span>
                  <button onClick={() => setWeeklyTarget(n => Math.min(7, n + 1))}
                    className="w-7 h-7 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">+</button>
                </div>
                <span className="text-[12px] text-[var(--text-secondary)]">次</span>
              </div>
            )}
          </div>

          {/* 自动完成（跨模块联动） */}
          <div>
            <label className="flex items-center justify-between mb-1.5 cursor-pointer select-none"
              onClick={() => setLinkOn(v => !v)}>
              <span className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
                <Zap size={12} className={linkOn ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />自动完成
              </span>
              <span className={`relative w-8 h-[18px] rounded-full transition-colors ${linkOn ? 'bg-[var(--accent)]' : 'bg-[var(--bg-hover)] border border-[var(--border-color)]'}`}>
                <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white transition-all ${linkOn ? 'left-[14px]' : 'left-[2px]'}`} />
              </span>
            </label>
            {linkOn && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {LINK_SOURCES.map(o => (
                    <button key={o.id} onClick={() => setLinkSource(o.id)} title={o.hint}
                      className={`py-1.5 text-[12px] rounded border transition-colors ${
                        linkSource === o.id
                          ? 'border-[var(--accent)] bg-[#007acc20] text-[var(--text-primary)]'
                          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                      }`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-[var(--text-secondary)] shrink-0">
                    {linkSource === 'blog' ? '当天字数达到' : '当天达到'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setLinkThreshold(n => Math.max(1, n - (linkSource === 'blog' ? 50 : 1)))}
                      className="w-7 h-7 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">−</button>
                    <span className="w-12 text-center text-[14px] font-semibold tabular-nums">{linkThreshold}</span>
                    <button onClick={() => setLinkThreshold(n => n + (linkSource === 'blog' ? 50 : 1))}
                      className="w-7 h-7 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">+</button>
                  </div>
                  <span className="text-[12px] text-[var(--text-secondary)]">
                    {LINK_SOURCES.find(o => o.id === linkSource)?.unit}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  {LINK_SOURCES.find(o => o.id === linkSource)?.hint}，即自动打卡并推送远程监督（不弹窗、可手动撤销）
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center px-5 py-3 border-t border-[var(--border-color)]">
          {mode === 'edit' ? (
            <button onClick={() => setConfirmDeleteOpen(true)}
              className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
              title="删除习惯">
              <Trash2 size={15} />
            </button>
          ) : <span />}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-[12px] rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
              取消
            </button>
            <button onClick={() => void handleSave()} disabled={!canSave || saving}
              className="px-4 py-1.5 text-[12px] rounded bg-[var(--accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={confirmDeleteOpen}
      title="删除习惯"
      message={`确定删除习惯「${habit?.name ?? ''}」？其所有打卡记录将一并删除。`}
      confirmLabel="删除"
      showCheckbox={false}
      onConfirm={() => void handleDelete()}
      onCancel={() => setConfirmDeleteOpen(false)}
    />
    </>
  )
}
