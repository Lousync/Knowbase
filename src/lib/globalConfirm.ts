/**
 * 应用级全局确认框（Promise 化）。
 *
 * 背景：Electron 原生 window.confirm 会破坏渲染进程键盘焦点（各模块注释已明令禁止），
 * 逐组件挂 <ConfirmDialog> 又要求每个入口自持 state。本模块提供命令式一次性确认：
 * 宿主 <GlobalConfirm/> 挂载在 App 根部，调用方 `await showGlobalConfirm({...})` 即可。
 */

export interface GlobalConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 可选第三个按钮（中性样式，位于取消与确认之间）。提供后 resolve 可能返回 'extra' */
  extraLabel?: string
  variant?: 'default' | 'danger'
}

/** resolve 结果：true=确认按钮，false=取消按钮/Esc/点击背景，'extra'=第三按钮（仅提供 extraLabel 时） */
export type GlobalConfirmResult = boolean | 'extra'

type Handler = (opts: GlobalConfirmOptions, resolve: (result: GlobalConfirmResult) => void) => void

let handler: Handler | null = null

/** 注册/注销宿主（GlobalConfirm 组件挂载时注册；无宿主时确认恒为取消，安全兜底） */
export function setGlobalConfirmHandler(h: Handler | null): void {
  handler = h
}

export function showGlobalConfirm(opts: GlobalConfirmOptions): Promise<GlobalConfirmResult> {
  if (!handler) return Promise.resolve(false)
  return new Promise((resolve) => handler!(opts, resolve))
}
