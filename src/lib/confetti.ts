/**
 * 打卡完成时的轻量视觉反馈：
 * - burstConfetti(x, y, colors)：在指定屏幕坐标炸开一簇彩纸（WAAPI 动画，自动清理）
 * - ensureFeedbackStyles：注入对勾圆圈 pop 动画的样式（懒加载一次）
 */

let stylesInjected = false

const DEFAULT_PALETTE = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

export function ensureFeedbackStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.id = 'checkin-fx-style'
  style.textContent = `
@keyframes ck-pop {
  0% { transform: scale(0.5); }
  55% { transform: scale(1.28); }
  100% { transform: scale(1); }
}
.ck-pop { animation: ck-pop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes ck-rise {
  0% { opacity: 0; transform: translateY(6px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.ck-rise { animation: ck-rise 0.22s ease-out; }
`
  document.head.appendChild(style)
  stylesInjected = true
}

interface Particle {
  dx: number; dy: number; rot: number; size: number; round: boolean; delay: number
}

/** 在屏幕坐标处炸开一簇彩纸 */
export function burstConfetti(x: number, y: number, colors?: string[]): void {
  if (typeof document === 'undefined') return
  ensureFeedbackStyles()
  const palette = colors && colors.length > 0 ? [...colors, ...DEFAULT_PALETTE] : DEFAULT_PALETTE
  const count = 18

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    const p: Particle = {
      dx: (Math.random() - 0.5) * 160,
      dy: -30 - Math.random() * 90,
      rot: (Math.random() - 0.5) * 560,
      size: 4.5 + Math.random() * 4,
      round: Math.random() > 0.65,
      delay: Math.random() * 60,
    }
    el.style.cssText =
      `position:fixed;left:${x}px;top:${y}px;width:${p.size}px;height:${p.round ? p.size : p.size * 0.45}px;` +
      `background:${palette[i % palette.length]};border-radius:${p.round ? '50%' : '1px'};` +
      `pointer-events:none;z-index:2147483647;will-change:transform,opacity;`
    document.body.appendChild(el)

    const anim = el.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${p.dx * 0.85}px), calc(-50% + ${p.dy}px)) rotate(${p.rot * 0.7}deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(calc(-50% + ${p.dx * 1.05}px), calc(-50% + ${p.dy + 130}px)) rotate(${p.rot}deg)`,
          opacity: 0,
        },
      ],
      { duration: 750 + Math.random() * 400, delay: p.delay, easing: 'cubic-bezier(0.16, 0.84, 0.44, 1)', fill: 'forwards' }
    )
    anim.onfinish = () => el.remove()
    anim.oncancel = () => el.remove()
  }
}

/** 全屏庆祝（今日全部完成）：中上方三连发 */
export function celebrateAllDone(): void {
  const cx = window.innerWidth / 2
  const cy = window.innerHeight * 0.3
  burstConfetti(cx - 130, cy + 20)
  window.setTimeout(() => burstConfetti(cx, cy - 30), 140)
  window.setTimeout(() => burstConfetti(cx + 130, cy + 20), 280)
}
