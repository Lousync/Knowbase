import { Check, Trash2, RotateCcw } from 'lucide-react'
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
}

const SIZE_MAP: Record<string, { check: number; checkIcon: number; text: string; title: string; desc: string; sub: string; padding: string; gap: string }> = {
  sm: { check: 18, checkIcon: 11, text: 'text-[10px]', title: 'text-[12px]', desc: 'text-[11px]', sub: 'text-[10px]', padding: 'py-2', gap: 'gap-2' },
  md: { check: 26, checkIcon: 16, text: 'text-[13px]', title: 'text-[16px]', desc: 'text-[13px]', sub: 'text-[11px]', padding: 'py-3', gap: 'gap-3' },
  lg: { check: 36, checkIcon: 22, text: 'text-[16px]', title: 'text-[20px]', desc: 'text-[16px]', sub: 'text-[13px]', padding: 'py-4', gap: 'gap-4' },
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

export function TodoItem({ todo, tag, showRemaining, iconSize = 'sm', onClick, onToggleDone, onDelete, onRestore }: Props) {
  const isDone = todo.status === 'done'
  const deadline = todo.taskType === 'deadline'
  const sz = SIZE_MAP[iconSize]

  return (
    <div
      className={`
        flex items-center ${sz.gap} ${sz.padding} bg-[#2d2d2d] border border-[#3c3c3c] rounded-md
        cursor-pointer hover:border-[#007acc] transition-all group
        ${isDone ? 'opacity-60 hover:opacity-90' : ''}
      `}
    >
      {/* 完成/恢复按钮 */}
      <button
        onClick={e => { e.stopPropagation(); isDone && onRestore ? onRestore() : onToggleDone() }}
        style={{ width: sz.check, height: sz.check }}
        className={`
          rounded border-2 flex items-center justify-center shrink-0 transition-colors
          ${isDone ? 'bg-[#007acc] border-[#007acc] hover:bg-[#1a8ad4]' : 'border-[#5a5a5a] hover:border-[#007acc]'}
        `}
        title={isDone ? '恢复任务' : '完成任务'}
      >
        {isDone && <Check size={sz.checkIcon} strokeWidth={3} className="text-white" />}
      </button>

      {/* 主内容 */}
      <div className="flex-1 min-w-0" onClick={onClick}>
        <div className="flex items-center gap-2 mb-0.5">
          {/* 标签颜色条 */}
          {tag && (
            <span
              style={{ width: 4, height: sz.check, backgroundColor: tag.color }}
              className="rounded shrink-0"
            />
          )}
          {/* 象限标记 */}
          <span className={`${sz.text} ${QUADRANT_COLORS[todo.quadrant] ?? 'text-gray-400'}`}>
            {QUADRANT_LABELS[todo.quadrant] ?? ''}
          </span>
          {/* 标签名 */}
          {tag && <span className={`${sz.text} text-[#6a6a6a]`}>{tag.name}</span>}
        </div>
        <p className={`${sz.title} leading-snug ${isDone ? 'line-through text-[#6a6a6a]' : 'text-[#d4d4d4]'}`}>
          {todo.title}
        </p>
        {todo.description && (
          <p className={`${sz.desc} text-[#6a6a6a] mt-0.5 truncate`}>{todo.description}</p>
        )}
      </div>

      {/* 右下角：截止 / 计划结束标准 */}
      {deadline && todo.time ? (
        <span className={`${sz.text} shrink-0 self-end ${showRemaining ? 'text-[#d16969] font-medium' : 'text-[#569cd6]'}`}>
          {showRemaining ? remainingLabel(todo.time) : `⏰ ${todo.time}`}
        </span>
      ) : !deadline && todo.endCriteria ? (
        <span className={`${sz.text} text-[#6a6a6a] shrink-0 self-end max-w-[120px] truncate`} title={todo.endCriteria}>
          🎯 {todo.endCriteria}
        </span>
      ) : null}

      {/* date label for non-date-grouped views */}
      {showRemaining && (
        <span className={`${sz.sub} text-[#6a6a6a] shrink-0 self-end ml-1`}>{todo.date}</span>
      )}

      {/* 删除 */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="shrink-0 p-1 text-[#6a6a6a] hover:text-[#e81123] opacity-0 group-hover:opacity-100 transition-all"
        title="删除"
      >
        <Trash2 size={sz.checkIcon + 2} />
      </button>
    </div>
  )
}
