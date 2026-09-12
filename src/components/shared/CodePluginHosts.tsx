import { useCallback, useEffect, useState } from 'react'
import type { PluginSummary } from '../../types'
import { pluginListInstalled, onPluginInstalledChanged, onPluginEvent } from '../../lib/ipc'
import { dispatchCodePluginAction } from '../../lib/pluginCommandBus'
import { CodePluginHost } from './CodePluginHost'

/**
 * 后台 code 插件宿主容器（R7 V3-2d）：常驻 App 层（隐藏），自动挂载
 * 所有「已启用且 type=code」的插件为其启动后台 Worker。
 *
 * 触发刷新：挂载时 + `plugin:installed-changed` 广播（主进程 notifyPluginsChanged）
 * ——安装/卸载/启停/内置落位都会推，宿主随插件启停自动增删。
 * 保活架构：组件常驻不随 Tab 切换卸载（code 插件是后台任务，不属于任何视图）。
 */
export function CodePluginHosts() {
  const [codePlugins, setCodePlugins] = useState<PluginSummary[]>([])

  const refresh = useCallback(async () => {
    try {
      const list = await pluginListInstalled()
      setCodePlugins(list.filter((p) => p.type === 'code' && p.enabled && !p.broken && p.entry))
    } catch { /* 主进程未就绪等忽略 */ }
  }, [])

  useEffect(() => {
    void refresh()
    const off = onPluginInstalledChanged(() => { void refresh() })
    return off
  }, [refresh])

  // 宿主事件 → 常驻 Worker 转发（plugin-phase1-design C4）：主进程已按订阅 + 能力过滤，
  // 这里只按 pluginId 找到对应 CodePluginHost 注册的推送通道
  useEffect(() => {
    return onPluginEvent((p) => {
      dispatchCodePluginAction(p.pluginId, 'event', { event: p.event, payload: p.payload, ...(p.dropped ? { dropped: p.dropped } : {}) })
    })
  }, [])

  if (codePlugins.length === 0) return null

  return (
    <>
      {codePlugins.map((p) => (
        <CodePluginHost key={p.id} pluginId={p.id} entry={p.entry!} />
      ))}
    </>
  )
}
