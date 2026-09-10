import type { ScheduleTodo } from '../../../types'
import {
  quadrantMeta, QUADRANT_TEXT_CLASS, QuadrantIconGlyph,
  type QuadrantIcon,
} from '../../../lib/scheduleQuadrant'
import { dragGuard, emitScheduleDragStart } from '../timetable'

/**
 * 日程表视图的「待安排」栏（侧栏）。
 *
 * 这里只放**没有排期时段**的未完成任务 —— 三类任务（计划 / 当日 / 截止）都可能出现，
 * 拖进右侧网格即完成排期；网格里拖回来则清空排期、回到这里。
 *
 * 拖拽用 pointer events：按下后位移超过阈值才真正「起拖」，
 * 事件交给 TimetableView 接管（它掌握网格几何，负责落点判定与提交）；
 * 本栏只负责把任务快照广播出去。落点区域用 `data-tray-drop` 标出来供对方识别。
 */
interface Props {
  todos: ScheduleTodo[]
  iconSize: 'sm' | 'md' | 'lg'
  quadrantIcon: QuadrantIcon
  quadrantText: 'show' | 'hide'
  onOpen: (todo: ScheduleTodo) => void
}

const TYPE_LABEL: Record<string, string> = { plan: '计划', daily: '当日', deadline: '截止' }

const SZ = {
  sm: { title: 'text-[11.5px]', meta: 'text-[10px]', icon: 12, pad: 'px-2 py-1.5', gap: 'mb-1' },
  md: { title: 'text-[12.5px]', meta: 'text-[10.5px]', icon: 14, pad: 'px-2.5 py-2', gap: 'mb-1.5' },
  lg: { title: 'text-[13.5px]', meta: 'text-[11px]', icon: 16, pad: 'px-3 py-2.5', gap: 'mb-2' },
}

export function TaskTray({ todos, iconSize, quadrantIcon, quadrantText, onOpen }: Props) {
  const s = SZ[iconSize]

  /** 按下后位移超过阈值才算起拖（否则是一次点击 → 打开编辑） */
  function handleCardPointerDown(todo: ScheduleTodo, e: React.PointerEvent) {
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let started = false

    const onMove = (ev: PointerEvent) => {
      if (started) return
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
      started = true
      cleanup()
      emitScheduleDragStart({
        todo: {
          id: todo.id, title: todo.title, date: todo.date, taskType: todo.taskType,
          tagId: todo.tagId, quadrant: todo.quadrant,
          scheduledStart: todo.scheduledStart, scheduledEnd: todo.scheduledEnd,
        },
        from: 'tray',
        // 待安排任务还没有时长，先按 1 小时落位，落点后可再拉伸
        duration: 60,
        grabOffset: 30,
      })
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
  }

  if (todos.length === 0) {
    return (
      <div data-tray-drop className="flex h-full flex-col">
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-[11.5px] text-[var(--text-disabled)] text-center leading-relaxed">
            全部任务都已排期<br />把网格里的卡片拖回来可取消排期
          </p>
        </div>
      </div>
    )
  }

  return (
    <div data-tray-drop className="flex h-full flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {todos.map(todo => {
          const tag = todo.tag ?? null
          const q = quadrantMeta(todo.quadrant)
          const colorCls = QUADRANT_TEXT_CLASS[todo.quadrant] ?? 'text-[var(--text-muted)]'
          return (
            <div
              key={todo.id}
              onPointerDown={e => handleCardPointerDown(todo, e)}
              onClick={() => {
                // 刚拖完的那一下会补发 click，忽略掉，避免顺手弹出编辑窗
                if (Date.now() - dragGuard.lastEnd < 250) return
                onOpen(todo)
              }}
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
