import { useState, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag } from '../../../types'
import { QuadrantIconGlyph, QUADRANT_TEXT_CLASS, quadrantMeta, type QuadrantIcon } from '../../../lib/scheduleQuadrant'

/** 完成反馈强度（设置项 scheduleFeedbackLevel） */
export type TaskFeedbackLevel = 'light' | 'medium' | 'heavy'

/**
 * 完成动效的「落位延迟」：点勾后先让动效播完，再通知父组件更新列表。
 * 否则父组件一刷新，条目就从待办区消失了，动画根本来不及看 —— 这正是原先"点了没反应"的根因。
 * light 只播勾选/划线/涟漪（约 500ms）；medium/heavy 还要播退场位移（620ms 动效 + 300ms 退场）。
 */
const SETTLE_MS: Record<TaskFeedbackLevel, number> = { light: 520, medium: 920, heavy: 920 }

// ---- 完成音效（heavy 档：Web Audio 合成，无需音频资源文件）----
let audioCtx: AudioContext | null = null

/** 播放完成音（final=true 为全部完成的上行三音） */
export function playDoneSound(final = false): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const ctx = audioCtx
    const t0 = ctx.currentTime
    const notes = final ? [784, 988, 1319] : [988, 1319]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const at = t0 + i * 0.055
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.linearRampToValueAtTime(0.05, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(at); osc.stop(at + 0.2)
    })
  } catch { /* 音频不可用（无输出设备/被策略拒绝）时静默降级 */ }
}

/** 全清庆祝：屏幕顶部飘落彩纸（heavy 档），一次性 DOM 层，播完自清 */
export function celebrateAllDone(): void {
  if (typeof document === 'undefined') return
  const colors = ['var(--danger)', 'var(--accent)', 'var(--success)', 'var(--warning)', '#8e44ad']
  const layer = document.createElement('div')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden'
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i')
    const size = 6 + Math.random() * 5
    p.style.cssText = `position:absolute;top:-14px;left:${(Math.random() * 100).toFixed(2)}vw;`
      + `width:${size}px;height:${size}px;border-radius:${Math.random() > 0.6 ? '50%' : '2px'};`
      + `background:${colors[i % colors.length]};`
      + `animation:kb-task-confetti ${(1.1 + Math.random() * 0.8).toFixed(2)}s linear ${(Math.random() * 0.3).toFixed(2)}s forwards`
    layer.appendChild(p)
  }
  document.body.appendChild(layer)
  window.setTimeout(() => layer.remove(), 2600)
}

interface Props {
  todo: ScheduleTodo
  tag?: ScheduleTag | null
  showRemaining?: boolean
  iconSize?: 'sm' | 'md' | 'lg'
  /** 完成反馈强度（设置项 scheduleFeedbackLevel，默认 medium） */
  feedbackLevel?: TaskFeedbackLevel
  /** 四象限图标方案（设置项 scheduleQuadrantIcon，默认 bars） */
  quadrantIcon?: QuadrantIcon
  /** 是否显示象限文字（设置项 scheduleQuadrantText，默认 show） */
  quadrantText?: 'show' | 'hide'
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
  md: { check: 24, checkIcon: 15, title: 'text-[15px]', meta: 'text-[12px]', desc: 'text-[12px]', tagBar: 'h-5', trash: 17, padX: 'px-3', padY: 'py-2', gap: 'gap-3', mTop: 'mt-0.5' },
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
  if (diff < -1) return `已过期 ${Math.abs(diff)} 天`
  if (diff === -1) return '昨天截止'
  if (diff === 0) return '今天截止！'
  if (diff === 1) return '明天截止！'
  if (diff === 2) return '后天截止！'
  if (diff <= 7) return `${diff} 天后截止`
  if (diff <= 30) return `还有 ${diff} 天`
  return `⏰ ${time}`
}

function formatDeadlineTime(time: string): string {
  if (!time) return ''
  const m = time.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return time
  const mo = m[2], d = m[3], hh = m[4], mm = m[5]
  if (hh !== undefined && mm !== undefined) {
    return `${Number(mo)}月${Number(d)}日 ${hh}:${mm}`
  }
  return `${Number(mo)}月${Number(d)}日`
}

/** Quick urgency class for deadline labels */
function urgencyClass(time: string): string {
  if (!time) return ''
  const match = time.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return 'text-[var(--danger)]'
  if (diff === 0) return 'text-[var(--danger)] font-semibold'
  if (diff === 1) return 'text-[var(--warning)] font-semibold'
  if (diff <= 3) return 'text-[var(--warning)]'
  return ''
}

export function TodoItem({
  todo, tag, showRemaining, iconSize = 'sm',
  feedbackLevel = 'medium', quadrantIcon = 'bars', quadrantText = 'show',
  onClick, onToggleDone, onDelete, onRestore, onToggleSubtask, onDeleteSubtask,
}: Props) {
  const [subOpen, setSubOpen] = useState(false)
  const s = SZ[iconSize]
  const deadline = todo.taskType === 'deadline'
  const isDaily = todo.taskType === 'daily'
  const hasSubs = (todo.subtasks?.length ?? 0) > 0
  const subtasks = todo.subtasks || []
  const subDone = subtasks.filter(st => st.status === 'done').length

  const propsDone = todo.status === 'done'
  /** 本地完成态覆盖：点击后立即可见，等 props 追平后再交还给 props 驱动 */
  const [localDone, setLocalDone] = useState<boolean | null>(null)
  const isDone = localDone ?? propsDone
  /** 正在播完成动效（控制 pop / 涟漪 / 泛绿闪的 class） */
  const [animating, setAnimating] = useState(false)
  /** 已进入退场位移（medium/heavy：条目右移淡出后再通知父组件移除） */
  const [leaving, setLeaving] = useState(false)
  const [sparks, setSparks] = useState<{ id: number; dx: string; dy: string; color: string }[]>([])
  const timers = useRef<number[]>([])

  // props 追上本地乐观值 → 交还控制权
  useEffect(() => {
    if (localDone !== null && propsDone === localDone) setLocalDone(null)
  }, [propsDone, localDone])

  useEffect(() => () => { timers.current.forEach(t => window.clearTimeout(t)) }, [])

  function spawnSparks() {
    const list = Array.from({ length: 8 }, (_, i) => {
      const ang = (Math.PI * 2 * i) / 8 + Math.random() * 0.5
      const dist = 14 + Math.random() * 16
      return {
        id: Date.now() + i,
        dx: `${(Math.cos(ang) * dist).toFixed(1)}px`,
        dy: `${(Math.sin(ang) * dist).toFixed(1)}px`,
        color: i % 3 === 1 ? 'var(--accent)' : i % 3 === 2 ? 'var(--warning)' : 'var(--success)',
      }
    })
    setSparks(list)
    timers.current.push(window.setTimeout(() => setSparks([]), 620))
  }

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    // 动效播放期间忽略重复点击（否则第一次的延迟回调会和第二次的状态翻转打架）
    if (leaving || animating) return

    // 已完成 → 恢复：立即生效（恢复不需要完成动效）
    if (isDone) {
      setLocalDone(false)
      if (onRestore) onRestore()
      else onToggleDone()
      return
    }

    // 未完成 → 完成：先播动效，播完再通知父组件更新列表（父组件移除条目时才不会打断动画）
    setLocalDone(true)
    setAnimating(true)
    if (feedbackLevel !== 'light') spawnSparks()
    if (feedbackLevel === 'heavy') playDoneSound()

    const settle = SETTLE_MS[feedbackLevel]
    if (feedbackLevel !== 'light') {
      timers.current.push(window.setTimeout(() => setLeaving(true), Math.max(0, settle - 300)))
    }
    timers.current.push(window.setTimeout(() => {
      setAnimating(false)
      onToggleDone()
    }, settle))
  }

  return (
    <div>
      <div
        className={`
          flex items-center ${s.gap} ${s.padX} ${s.padY} bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-md
          cursor-pointer hover:border-[var(--accent)] transition-all group relative
          ${isDone ? 'opacity-60 hover:opacity-90' : ''}
          ${leaving ? 'kb-task-exit' : ''}
        `}
      >
        {/* 整行泛绿闪（medium/heavy） */}
        {animating && feedbackLevel !== 'light' && (
          <span className="kb-task-flash absolute inset-0 rounded-md bg-[var(--success)] pointer-events-none" />
        )}

        {/* 完成/恢复按钮 */}
        <button
          onClick={handleToggle}
          style={{ width: s.check, height: s.check }}
          className={`
            relative rounded border-2 flex items-center justify-center shrink-0
            ${animating ? 'kb-task-pop' : ''}
            ${isDone
              ? 'bg-[var(--success)] border-[var(--success)] transition-colors'
              : 'border-[var(--border-color)] hover:border-[var(--accent)] transition-colors'}
          `}
          title={isDone ? '恢复任务' : '完成任务'}
        >
          {/* 勾号：描边绘制（stroke-dashoffset 过渡） */}
          <svg width={s.checkIcon} height={s.checkIcon} viewBox="0 0 24 24" className="text-white" style={{ overflow: 'visible' }}>
            <path
              d="M4 12.6l5.4 5.4L20 6.4"
              fill="none" stroke="currentColor" strokeWidth={3.2}
              strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray={26} strokeDashoffset={isDone ? 0 : 26}
              style={{ transition: 'stroke-dashoffset 200ms ease-out 60ms' }}
            />
          </svg>
          {/* 涟漪 */}
          {animating && (
            <span
              className="kb-task-ripple absolute left-1/2 top-1/2 -ml-2.5 -mt-2.5 w-5 h-5 rounded-full bg-[var(--success)] pointer-events-none"
            />
          )}
          {/* 粒子 */}
          {sparks.map(sp => (
            <span
              key={sp.id}
              className="kb-task-spark absolute left-1/2 top-1/2 w-[5px] h-[5px] rounded-full pointer-events-none"
              style={{ background: sp.color, '--dx': sp.dx, '--dy': sp.dy } as CSSProperties}
            />
          ))}
        </button>

        {/* 主内容 */}
        <div className="flex-1 min-w-0" onClick={onClick}>
          <div className="flex items-center gap-1.5">
            {/* 标签颜色条 */}
            {tag && (
              <span className={`${s.tagBar} w-1 rounded shrink-0`} style={{ backgroundColor: tag.color }} />
            )}
            {/* 象限：图标 + （可选）文字 */}
            {(() => {
              const q = quadrantMeta(todo.quadrant)
              const colorCls = QUADRANT_TEXT_CLASS[todo.quadrant] ?? 'text-[var(--text-muted)]'
              return (
                <span
                  className={`inline-flex items-center gap-1 shrink-0 ${colorCls}`}
                  title={quadrantText === 'hide' ? `${q.label}（紧迫度 ${q.level}/4）` : undefined}
                >
                  <QuadrantIconGlyph icon={quadrantIcon} meta={q} size={Math.max(13, Math.round(s.check * 0.8))} />
                  {quadrantText === 'show' && <span className={s.meta}>{q.label}</span>}
                </span>
              )
            })()}
            {tag && <span className={`${s.meta} text-[var(--text-muted)]`}>{tag.name}</span>}
          </div>
          <p className={`${s.title} ${s.mTop} leading-snug font-medium relative inline-block max-w-full ${isDone ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
            {todo.title}
            {/* 删除线：从左划出 */}
            <span
              className={`absolute left-0 top-1/2 h-[1.5px] bg-[var(--text-muted)] transition-[width] duration-200 ease-out ${isDone ? 'w-full' : 'w-0'}`}
            />
          </p>
          {todo.description && (
            <p className={`${s.desc} text-[var(--text-muted)] mt-0.5 truncate`}>{todo.description}</p>
          )}
          {/* Sub-task progress (plan & deadline tasks) */}
          {!isDaily && hasSubs && (
            <button
              onClick={e => { e.stopPropagation(); setSubOpen(v => !v) }}
              className="flex items-center gap-1 mt-1.5 text-[11px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
            >
              {subOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              子任务 {subDone}/{subtasks.length} 完成
            </button>
          )}
        </div>

        {/* 截止时间 */}
        <div className="shrink-0 flex flex-col items-end gap-0.5 self-stretch justify-between">
          {deadline && todo.time ? (
            <>
              <span className={`${s.meta} ${urgencyClass(todo.time)}`}>
                {remainingLabel(todo.time)}
              </span>
              <span className={`${s.meta} text-[var(--text-muted)]`}>{formatDeadlineTime(todo.time)}</span>
            </>
          ) : !deadline && todo.endCriteria ? (
            <span className={`${s.meta} text-[var(--text-muted)] max-w-[100px] truncate`} title={todo.endCriteria}>
              🎯 {todo.endCriteria}
            </span>
          ) : <span />}
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
                  className={`rounded border flex items-center justify-center shrink-0 transition-colors ${stDone ? 'bg-[var(--success)] border-[var(--success)]' : 'border-[var(--border-color)] hover:border-[var(--accent)]'}`}
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
