import { Check, Trash2 } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag } from '../../../types'

const QUADRANT_LABELS: Record<number, string> = { 0: '🔥 紧急重要', 1: '📌 重要', 2: '⚡ 紧急', 3: '💤 消遣' }
const QUADRANT_COLORS: Record<number, string> = {
  0: 'text-red-400', 1: 'text-blue-400', 2: 'text-yellow-400', 3: 'text-gray-500'
}

interface Props {
  todo: ScheduleTodo
  tag?: ScheduleTag | null
  showRemaining?: boolean
  onClick: () => void
  onToggleDone: () => void
  onDelete: () => void
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

export function TodoItem({ todo, tag, showRemaining, onClick, onToggleDone, onDelete }: Props) {
  const isDone = todo.status === 'done'
  const deadline = todo.taskType === 'deadline'

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 bg-[#2d2d2d] border border-[#3c3c3c] rounded-md
        cursor-pointer hover:border-[#007acc] transition-all group
        ${isDone ? 'opacity-50' : ''}
      `}
    >
      {/* 完成按钮 */}
      <button
        onClick={e => { e.stopPropagation(); onToggleDone() }}
        className={`
          w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
          ${isDone ? 'bg-[#007acc] border-[#007acc]' : 'border-[#5a5a5a] hover:border-[#007acc]'}
        `}
      >
        {isDone && <Check size={12} strokeWidth={3} className="text-white" />}
      </button>

      {/* 主内容 */}
      <div className="flex-1 min-w-0" onClick={onClick}>
        <div className="flex items-center gap-2 mb-0.5">
          {/* 标签颜色条 */}
          {tag && (
            <span
              className="w-1 h-4 rounded shrink-0"
              style={{ backgroundColor: tag.color }}
            />
          )}
          {/* 象限标记 */}
          <span className={`text-[11px] ${QUADRANT_COLORS[todo.quadrant] ?? 'text-gray-400'}`}>
            {QUADRANT_LABELS[todo.quadrant] ?? ''}
          </span>
          {/* 标签名 */}
          {tag && <span className="text-[11px] text-[#6a6a6a]">{tag.name}</span>}
        </div>
        <p className={`text-[14px] leading-snug ${isDone ? 'line-through text-[#6a6a6a]' : 'text-[#d4d4d4]'}`}>
          {todo.title}
        </p>
        {todo.description && (
          <p className="text-[12px] text-[#6a6a6a] mt-0.5 truncate">{todo.description}</p>
        )}
      </div>

      {/* 右下角：截止时间 / 剩余时间 */}
      {deadline && todo.time && (
        <span className={`text-[11px] shrink-0 self-end ${showRemaining ? 'text-[#d16969] font-medium' : 'text-[#569cd6]'}`}>
          {showRemaining ? remainingLabel(todo.time) : `⏰ ${todo.time}`}
        </span>
      )}

      {/* date label for non-date-grouped views */}
      {showRemaining && (
        <span className="text-[10px] text-[#6a6a6a] shrink-0 self-end ml-1">{todo.date}</span>
      )}

      {/* 删除 */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="shrink-0 p-1 text-[#6a6a6a] hover:text-[#e81123] opacity-0 group-hover:opacity-100 transition-all"
        title="删除"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
