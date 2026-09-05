/**
 * 禅模式状态机（纯函数，可冒烟）。
 * 规格：docs/zen-mode-design.md §5 —— off → Z1 → Z2 → (Z3) → off 循环；
 * Esc 优先级：存在弹窗时让位（各弹窗自己的 Esc 逻辑关闭），无弹窗才退出。
 */

export type ZenLevel = 0 | 1 | 2 | 3

/** V1 循环上限：Z3 打字机为 V2 范围，落地后改为 3 */
export const ZEN_MAX_LEVEL = 2

export interface ZenCycleOpts {
  /** 编辑器存在任一弹窗（inputBox/closeTarget/fmDraft/ctxMenu/createMenu/conflictState） */
  hasModal: boolean
  /** 当前有打开的文件（activePath 非空）——无文件不可进入禅模式 */
  hasDocument: boolean
}

/** Ctrl+K Z：off→Z1→Z2→off 循环；弹窗存在或无文档时保持原档位 */
export function nextZenLevel(current: number, opts: ZenCycleOpts): number {
  if (opts.hasModal) return current
  if (current === 0 && !opts.hasDocument) return current
  const next = current + 1
  return next > ZEN_MAX_LEVEL ? 0 : next
}

/** Esc 是否应退出禅模式（弹窗存在时让位） */
export function shouldExitZen(hasModal: boolean): boolean {
  return !hasModal
}
