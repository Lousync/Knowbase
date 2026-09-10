import { useState } from 'react'
import type { ScheduleTodo } from '../../../types'
import {
  quadrantMeta, QUADRANT_TEXT_CLASS, QuadrantIconGlyph,
  type QuadrantIcon,
} from '../../../lib/scheduleQuadrant'
import { dndMeta } from '../timetable'

/**
 * 日程表视图的「待安排」栏（侧栏）。
 *
 * 这里只放**没有排期时段**的未完成任务 —— 三类任务（计划 / 当日 / 截止）都可能出现，
 * 拖进右侧网格即完成排期；网格里拖回来则清空排期、回到这里。
 *
 * 拖拽走 HTML5 DnD（跨组件最省事）：本组件只负责让卡片可拖 + 带上 id，
 * 落点判定与提交统一由 TimetableView 处理。
 */
interface Props {
  todos: ScheduleTodo[]
  iconSize: 'sm' | 'md' | 'lg'
  quadrantIcon: QuadrantIcon
  quadrantText: 'show' | 'hide'
  onOpen: (todo: ScheduleTodo) => void
  onDragStartTodo: (todo: ScheduleTodo, e: React.DragEvent) => void
  onDragEndTodo: () => void
  /** 从网格拖回本栏 = 取消排期 */
  onDropTodo: (id: string) => void
}

const TYPE_LABEL: Record<string, string> = { plan: '计划', daily: '当日', deadline: '截止' }

const SZ = {
  sm: { title: 'text-[11.5px]', meta: 'text-[10px]', icon: 12, pad: 'px-2 py-1.5', gap: 'mb-1' },
  md: { title: 'text-[12.5px]', meta: 'text-[10.5px]', icon: 14, pad: 'px-2.5 py-2', gap: 'mb-1.5' },
  lg: { title: 'text-[13.5px]', meta: 'text-[11px]', icon: 16, pad: 'px-3 py-2.5', gap: 'mb-2' },
}

export function TaskTray({ todos, iconSize, quadrantIcon, quadrantText, onOpen, onDragStartTodo, onDragEndTodo, onDropTodo }: Props) {
  const s = SZ[iconSize]
  const [over, setOver] = useState(false)

  /** 本栏作为落点：只接受「从网格拖回来」的卡片 —— 取消排期 */
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (dndMeta.from !== 'grid') return
      e.preventDefault()
      setOver(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (dndMeta.from !== 'grid') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const id = e.dataTransfer.getData('text/plain') || dndMeta.id
      if (id && dndMeta.from === 'grid') onDropTodo(id)
    },
  }

  if (todos.length === 0) {
    return (
      <div className="flex h-full flex-col" {...dropProps}>
        <div className={`flex-1 flex items-center justify-center px-4 transition-colors ${over ? 'bg-[var(--drop-bg)]' : ''}`}>
          <p className="text-[11.5px] text-[var(--text-disabled)] text-center leading-relaxed">
            全部任务都已排期<br />把网格里的卡片拖回来可取消排期
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" {...dropProps}>
      <div className={`flex-1 min-h-0 overflow-y-auto p-2 transition-colors ${over ? 'bg-[var(--drop-bg)]' : ''}`}>
        {todos.map(todo => {
          const tag = todo.tag ?? null
          const q = quadrantMeta(todo.quadrant)
          const colorCls = QUADRANT_TEXT_CLASS[todo.quadrant] ?? 'text-[var(--text-muted)]'
          return (
            <div
              key={todo.id}
              draggable
              onDragStart={e => onDragStartTodo(todo, e)}
              onDragEnd={onDragEndTodo}
              onClick={() => onOpen(todo)}
              className={`group relative flex items-center gap-2 ${s.pad} ${s.gap} bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md cursor-grab active:cursor-grabbing hover:border-[var(--accent)] transition-colors`}
              title="拖到右侧日程表即可排期"
            >
              {/* 标签色条 */}
              <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md" style={{ background: tag?.color ?? 'var(--border-color)' }} />
              <div className="flex-1 min-w-0 pl-1">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center shrink-0 ${colorCls}`} title={`${q.label}（紧迫度 ${q.level}/4）`}>
                    <QuadrantIconGlyph icon={quadrantIcon} meta={q} size={Math.max(11, s.icon - 1)} />
                    {quadrantText === 'show' && <span className={s.meta}>{q.label}</span>}
                  </span>
                  <span className={`${s.meta} text-[var(--text-muted)] shrink-0`}>{TYPE_LABEL[todo.taskType] ?? todo.taskType}</span>
                  {tag && <span className={`${s.meta} text-[var(--text-muted)] truncate`}>{tag.name}</span>}
                </div>
                <p className={`${s.title} font-medium text-[var(--text-primary)] mt-0.5 leading-snug truncate`}>{todo.title}</p>
              </div>
            </div>
          )
        })}
      </div>
      <div className="shrink-0 px-2.5 py-2 border-t border-[var(--border-color)]">
        <p className="text-[10.5px] text-[var(--text-disabled)] leading-relaxed">
          拖到右侧日程表即可排期<br />网格里的卡片拖回这里可取消排期
        </p>
      </div>
    </div>
  )
}
