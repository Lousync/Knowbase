/**
 * 插件命令/视图激活总线（plugin-phase1-design C3）——纯渲染层模块级单例。
 *
 * 两条线：
 * 1. code 插件命令分发：CodePluginHost（常驻后台 Worker 宿主）在会话就绪后注册
 *    dispatchers；命令面板经 dispatchCodePluginAction 向指定插件 Worker 推
 *    action 报文（command / event / lifecycle 均走同一通道）。
 * 2. 视图激活：命令面板切到宿主模块后需要激活对应侧栏的插件视图——模块可能
 *    尚未挂载（首访才挂），所以「事件广播 + 待激活暂存」双机制：PluginSlotEntry
 *    监听事件，挂载/视图就绪时消费暂存（5 秒过期防陈旧激活）。
 */

type PluginActionDispatcher = (action: string, payload: unknown) => void

const dispatchers = new Map<string, PluginActionDispatcher>()

/** CodePluginHost 会话就绪后注册；返回反注册函数（卸载/换会话时调用） */
export function registerCodePluginDispatcher(pluginId: string, dispatch: PluginActionDispatcher): () => void {
  dispatchers.set(pluginId, dispatch)
  return () => {
    if (dispatchers.get(pluginId) === dispatch) dispatchers.delete(pluginId)
  }
}

/** 向指定 code 插件的常驻 Worker 推一条 action 报文；插件未运行返回 false */
export function dispatchCodePluginAction(pluginId: string, action: string, payload: unknown): boolean {
  const d = dispatchers.get(pluginId)
  if (!d) return false
  try {
    d(action, payload)
    return true
  } catch {
    return false
  }
}

export interface PendingViewActivation {
  pluginId: string
  slot: string
  ts: number
}

const ACTIVATION_TTL_MS = 5000
let pendingActivation: PendingViewActivation | null = null

/** 命令面板发起：切到宿主模块 + 广播激活事件 + 暂存（防模块首挂晚于广播） */
export function requestPluginViewActivation(pluginId: string, slot: string): void {
  pendingActivation = { pluginId, slot, ts: Date.now() }
  window.dispatchEvent(new CustomEvent('plugin:activate-view', { detail: { pluginId, slot } }))
}

/** PluginSlotEntry 侧消费：返回未过期的待激活请求（不移除，匹配方自行 clear） */
export function peekPendingViewActivation(): PendingViewActivation | null {
  if (pendingActivation && Date.now() - pendingActivation.ts > ACTIVATION_TTL_MS) pendingActivation = null
  return pendingActivation
}

/** 匹配方消费后清除 */
export function clearPendingViewActivation(): void {
  pendingActivation = null
}
