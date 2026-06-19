import { useState } from 'react'
import { Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag } from '../../../types'

const QUADRANT_LABELS: Record<number, string> = { 0: '🔥 紧急重要', 1: '📌 重要', 2: '⚡ 紧急', 3: '💤 消遣' }
const QUADRANT_COLORS: Record<number, string> = {
  0: 'text-red-400', 1: 'text-blue-400', 2: 'text-yellow-400', 3: 'text-gray-500'
}

interface Props {
  todo: ScheduleTodo
  tag?: ScheduleTag | null
  showRemaining?: boolean
  iconSize?: 'sm' | 'md' | 'lg'
  onClick: () => void
  onToggleDone: () => void
  onDelete: () => void
  onRestore?: () => void
  onToggleSubtask?: (id: string) => void
  onDeleteSubtask?: (id: string) => void
}

// 三档比例：check 约为 title 的 1.6x，间距同步缩放
const SZ: Record<string, { check: number; checkIcon: number; title: string; meta: string; desc: string; tagBar: string; trash: number; padX: string; padY: string; gap: string; mTop: string }> = {
  sm: { check: 18, checkIcon: 11, title: 'text-[13px]', meta: 'text-[11px]', desc: 'text-[11px]', tagBar: 'h-4', trash: 14, padX: 'px-3', padY: 'py-2', gap: 'gap-2', mTop: '' },
  md: { check: 24, checkIcon: 15, title: 'text-[15px]', meta: 'text-[12px]', desc: 'text-[12px]', tagBar: 'h-5', trash: 17, padX: 'px-4', padY: 'py-3', gap: 'gap-3', mTop: 'mt-0.5' },
  lg: { check: 30, checkIcon: 19, title: 'text-[18px]', meta: 'text-[13px]', desc: 'text-[14px]', tagBar: 'h-6', trash: 20, padX: 'px-5', padY: 'py-3.5', gap: 'gap-4', mTop: 'mt-1' },
}

function remainingLabel(time: string): string {
  if (!time) return ''
  const match = time.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return `已过期${Math.abs(diff)}天`
  if (diff === 0) return '今天截止'
  if (diff === 1) return '明天截止'
  return `剩余${diff}天`
}

export function TodoItem({ todo, tag, showRemaining, iconSize = 'sm', onClick, onToggleDone, onDelete, onRestore, onToggleSubtask, onDeleteSubtask }: Props) {
  const [subOpen, setSubOpen] = useState(false)
  const isDone = todo.status === 'done'
  const deadline = todo.taskType === 'deadline'
  const s = SZ[iconSize]
  const isDaily = todo.taskType === 'daily'
  const hasSubs = (todo.subtasks?.length ?? 0) > 0
  const subtasks = todo.subtasks || []
  const subDone = subtasks.filter(st => st.status === 'done').length

  return (
    <div>
      <div
        className={`
          flex items-center ${s.gap} ${s.padX} ${s.padY} bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-md
          cursor-pointer hover:border-[var(--accent)] transition-all group
          ${isDone ? 'opacity-60 hover:opacity-90' : ''}
        `}
      >
        {/* 完成/恢复按钮 */}
        <button
          onClick={e => { e.stopPropagation(); isDone && onRestore ? onRestore() : onToggleDone() }}
          style={{ width: s.check, height: s.check }}
          className={`
            rounded border-2 flex items-center justify-center shrink-0 transition-colors
            ${isDone ? 'bg-[var(--accent)] border-[var(--accent)] hover:bg-[var(--accent-hover)]' : 'border-[#5a5a5a] hover:border-[var(--accent)]'}
          `}
          title={isDone ? '恢复任务' : '完成任务'}
        >
          {isDone && <Check size={s.checkIcon} strokeWidth={3} className="text-white" />}
        </button>

        {/* 主内容 */}
        <div className="flex-1 min-w-0" onClick={onClick}>
          <div className="flex items-center gap-1.5">
            {/* 标签颜色条 */}
            {tag && (
              <span className={`${s.tagBar} w-1 rounded shrink-0`} style={{ backgroundColor: tag.color }} />
            )}
            {/* 象限 / 标签 */}
            <span className={`${s.meta} ${QUADRANT_COLORS[todo.quadrant] ?? 'text-gray-400'}`}>
              {QUADRANT_LABELS[todo.quadrant] ?? ''}
            </span>
            {tag && <span className={`${s.meta} text-[var(--text-muted)]`}>{tag.name}</span>}
          </div>
          <p className={`${s.title} ${s.mTop} leading-snug font-medium ${isDone ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
            {todo.title}
          </p>
          {todo.description && (
            <p className={`${s.desc} text-[var(--text-muted)] mt-0.5 truncate`}>{todo.description}</p>
          )}
          {/* Sub-task progress (plan & deadline tasks) */}
          {!isDaily && hasSubs && (
            <button
              onClick={e => { e.stopPropagation(); setSubOpen(v => !v) }}
              className="flex items-center gap-1 mt-1.5 text-[11px] text-[var(--accent)] hover:text-[#4fc1ff] transition-colors"
            >
              {subOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              子任务 {subDone}/{subtasks.length} 完成
            </button>
          )}
        </div>

        {/* 截止时间 / 结束标准 */}
        <div className="shrink-0 flex flex-col items-end gap-0.5 self-stretch justify-between">
          {deadline && todo.time ? (
            <span className={`${s.meta} ${showRemaining ? 'text-[#d16969] font-medium' : 'text-[#569cd6]'}`}>
              {showRemaining ? remainingLabel(todo.time) : `⏰ ${todo.time}`}
            </span>
          ) : !deadline && todo.endCriteria ? (
            <span className={`${s.meta} text-[var(--text-muted)] max-w-[100px] truncate`} title={todo.endCriteria}>
              🎯 {todo.endCriteria}
            </span>
          ) : <span />}
          {showRemaining && (
            <span className={`${s.meta} text-[var(--text-muted)]`}>{todo.date}</span>
          )}
        </div>

        {/* 删除 */}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-all"
          title="删除"
        >
          <Trash2 size={s.trash} />
        </button>
      </div>

      {/* Expanded sub-task list */}
      {!isDaily && hasSubs && subOpen && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {subtasks.map(st => {
            const stDone = st.status === 'done'
            return (
              <div key={st.id} className={`flex items-center gap-2 px-3 py-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded group ${stDone ? 'opacity-50' : ''}`}>
                <button
                  onClick={e => { e.stopPropagation(); onToggleSubtask?.(st.id) }}
                  style={{ width: s.check, height: s.check }}
                  className={`rounded border flex items-center justify-center shrink-0 transition-colors ${stDone ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[#5a5a5a] hover:border-[var(--accent)]'}`}
                  title="切换完成状态"
                >
                  {stDone && <Check size={s.checkIcon} strokeWidth={3} className="text-white" />}
                </button>
                <span className={`flex-1 ${s.title} truncate ${stDone ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{st.title}</span>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteSubtask?.(st.id) }}
                  className="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-all"
                  title="删除"
                >
                  <Trash2 size={s.trash} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
