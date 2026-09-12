import type { ReactNode } from 'react'
import { usePresence } from '../../lib/usePresence'

interface Props {
  open: boolean
  /** 点遮罩关闭；不传则遮罩不可点 */
  onClose?: () => void
  /** 遮罩类，默认「全屏居中 + 半透明黑」，z 层按调用方给 */
  overlayClassName?: string
  /** 面板类（尺寸/配色/圆角由调用方给，动效类由本组件加） */
  panelClassName?: string
  /**
   * 是否给遮罩做淡入淡出。**带 backdrop-blur 的遮罩必须传 false**：
   * 遮罩 opacity 动画期间模糊背景每帧重新采样（背后是图片墙时成本极高，
   * 见 docs/ui-animation-plan.md §五 风险表）。false 时遮罩瞬时出现、只动面板。
   */
  animateOverlay?: boolean
  /** 退场时长，需 ≥ 面板退场动画时长 */
  exitMs?: number
  children: ReactNode
}

/**
 * 弹层壳（docs/ui-animation-plan.md B 类）：遮罩淡入淡出 + 面板缩放进出场，
 * 关闭时延迟卸载以播完退场动画（reduced-motion 下立即卸载）。
 *
 * 用法（替换原来的 `{open && <div className="fixed inset-0 …">…</div>}`）：
 *   <ModalShell open={open} onClose={() => setOpen(false)}
 *     overlayClassName="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
 *     panelClassName="w-[420px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
 *     …面板内容…
 *   </ModalShell>
 *
 * 注意：调用方不要再写 `if (!open) return null` —— 那会立刻卸载，退场动画无从播放。
 */
export function ModalShell({
  open,
  onClose,
  overlayClassName = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50',
  panelClassName = '',
  animateOverlay = true,
  exitMs = 180,
  children
}: Props) {
  const { mounted, closing } = usePresence(open, exitMs)
  if (!mounted) return null

  const overlayAnim = animateOverlay
    ? (closing ? 'kb-overlay-out' : 'kb-overlay')
    : ''

  return (
    <div
      className={`${overlayClassName} ${overlayAnim}`}
      onClick={onClose}
    >
      <div
        className={`${panelClassName} ${closing ? 'kb-modal-out' : 'kb-modal-in'}`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
