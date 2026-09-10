import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ViewMode } from '../types'

/**
 * 日程模块顶部的视图切换条（分段控件 + 滑动指示器）。
 *
 * 为什么放顶栏而不是侧栏：切到日程表时侧栏整体换成「待安排」栏，
 * 若入口还留在侧栏里，切换过去按钮就随之消失了，用户找不到回去的路；
 * 顶栏常驻则四个视图地位平等、随时可切。
 */

const ITEMS: { id: ViewMode; label: string }[] = [
  { id: 'week', label: '周日程' },
  { id: 'date', label: '按日期' },
  { id: 'deadline', label: '按截止' },
  { id: 'quadrant', label: '按象限' },
]

interface Props {
  value: ViewMode
  onChange: (v: ViewMode) => void
}

export function ViewSwitcher({ value, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState({ left: 0, width: 0 })
  const [ready, setReady] = useState(false)

  const sync = useCallback(() => {
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-v="${value}"]`)
    if (!el) return
    setPill({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value])

  useLayoutEffect(() => {
    sync()
    if (!ready) {
      const raf = requestAnimationFrame(() => setReady(true))
      return () => cancelAnimationFrame(raf)
    }
  }, [sync, ready])

  useEffect(() => {
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [sync])

  return (
    <div ref={wrapRef}
      className="relative flex items-center gap-0.5 rounded-lg bg-[var(--bg-secondary)] p-0.5 shrink-0 select-none">
      <span
        className="absolute top-0.5 bottom-0.5 rounded-md bg-[var(--bg-primary)] shadow-sm pointer-events-none"
        style={{
          left: pill.left,
          width: pill.width,
          transition: ready ? 'left 240ms cubic-bezier(.4,0,.2,1), width 240ms cubic-bezier(.4,0,.2,1)' : 'none',
        }}
      />
      {ITEMS.map(it => (
        <button
          key={it.id}
          data-v={it.id}
          onClick={() => onChange(it.id)}
          className={`relative z-[1] px-2.5 h-[24px] rounded-md text-[12px] whitespace-nowrap transition-colors ${
            value === it.id
              ? 'text-[var(--accent)] font-semibold'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
