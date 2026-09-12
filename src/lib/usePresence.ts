import { useEffect, useRef, useState } from 'react'

/** 是否处于「减少动态效果」偏好下。CSS 已有统一兜底，JS 侧只用于决定是否等待退场时长。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 退场动画的存在性管理（docs/ui-animation-plan.md §二）。
 *
 * React 卸载是瞬时的，而 CSS 只能给「还在 DOM 里」的元素播退场动画。本 hook 把
 * `open` 的下降沿延后到动画播完再真正卸载：
 *
 *   const { mounted, closing } = usePresence(open, 160)
 *   if (!mounted) return null
 *   return (
 *     <div className={closing ? 'kb-overlay kb-overlay-out' : 'kb-overlay'}>
 *       <div className={closing ? 'kb-modal kb-modal-out' : 'kb-modal'}>…</div>
 *     </div>
 *   )
 *
 * 注意：不能用 transitionend 兜底——Tailwind v4 下部分属性的事件名与属性名不一致
 *（如 translate / rotate），本仓库既有做法（AssistantPanel 的 EXPAND_MS）就是定时器兜底，
 * 这里沿用同一策略。reduced-motion 下退场时长归零，立即卸载。
 */
export function usePresence(open: boolean, exitMs = 180): { mounted: boolean; closing: boolean } {
  const [state, setState] = useState<{ mounted: boolean; closing: boolean }>({
    mounted: open,
    closing: false
  })
  // 供卸载时清理，避免快速开关时旧定时器把新一轮的显示状态关掉
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (open) {
      setState({ mounted: true, closing: false })
      return
    }
    setState(prev => (prev.mounted ? { mounted: true, closing: true } : prev))
    timer.current = setTimeout(() => {
      timer.current = null
      setState({ mounted: false, closing: false })
    }, prefersReducedMotion() ? 0 : exitMs)
  }, [open, exitMs])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return state
}
