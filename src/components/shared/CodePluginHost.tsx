import { useEffect, useRef } from 'react'
import { hostBridgeOpen, hostBridgeClose, hostRpc, pluginAuditWrite } from '../../lib/ipc'
import { showToast } from '../../lib/toast'

/**
 * code 插件宿主（R7 V3-2c）：以后台 Worker 执行 `type: code` 插件的单 JS 入口。
 *
 * 与 PluginFrame(iframe/UI 插件) 并列：code 插件无 DOM，靠 Worker 跑脚本逻辑，
 * 同一套 kb-plugin v2 协议——Worker 内 postMessage ↔ 本组件 ↔ host:rpc ↔ 主进程 Gateway。
 * 依赖：宿主窗口 CSP `worker-src` 已放行 `plugin:`（见 index.html）。
 *
 * 组件渲染为空容器（无可见 UI）；消息经 Worker.onmessage / Worker.postMessage 双向。
 * 卸载时 terminate worker + bridge-close 会话。
 */

const CHANNEL = 'kb-plugin'

export function CodePluginHost({ pluginId, entry, onDenied }: {
  pluginId: string
  /** 插件入口文件名（manifest.entry，如 main.js） */
  entry: string
  onDenied?: (reason: string) => void
}) {
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    let alive = true
    let worker: Worker | null = null
    let token: string | null = null

    // 会话开启后通知 Worker（Worker 内 postMessage 上报请求）
    const openSession = async (): Promise<void> => {
      try {
        const r = await hostBridgeOpen(pluginId)
        if (!alive) return
        if (r.ok && r.token) {
          token = r.token
          worker?.postMessage({ channel: CHANNEL, v: 2, action: 'init', payload: { token, hostVersion: '2' } })
        } else {
          onDenied?.(r.message ?? 'bridge-open 失败')
        }
      } catch (e) {
        onDenied?.(String((e as Error)?.message || e))
      }
    }

    // Worker → Gateway：v2 报文原样转发，回包带 id
    const handleWorkerMessage = (e: MessageEvent): void => {
      const d = (e.data ?? {}) as { channel?: string; v?: number; id?: string; method?: string; action?: string; payload?: unknown }
      if (d.channel !== CHANNEL) return
      const id = d.id ?? ''
      if (d.v !== 2) {
        // code 插件只走 v2（v1 是 iframe UI 插件协议）
        worker?.postMessage({ channel: CHANNEL, v: 2, id, ok: false, error: { code: 'EPARAM', message: 'code 插件需使用 v2 协议(kb-plugin v:2)' } })
        return
      }
      if (!token) {
        worker?.postMessage({ channel: CHANNEL, v: 2, id, ok: false, error: { code: 'EBRIDGE', message: 'bridge 会话未就绪' } })
        return
      }
      const method = d.method ?? d.action ?? ''
      void hostRpc({ token, id, method, params: d.payload }).then((res) => {
        if (!alive || !worker) return
        if (res.ok) {
          // 渲染层本地动作（主进程裁决通过后回 { local }）：Worker 无 DOM，但宿主渲染层可执行 toast
          const r = res.result as { local?: string } | undefined
          if (r && typeof r === 'object' && r.local) {
            if (r.local === 'toast' && typeof d.payload === 'string') {
              showToast({ type: 'info', message: d.payload })
            }
            worker.postMessage({ channel: CHANNEL, v: 2, id, ok: true, result: { handled: true } })
          } else {
            worker.postMessage({ channel: CHANNEL, v: 2, id, ok: true, result: res.result })
          }
        } else {
          worker.postMessage({ channel: CHANNEL, v: 2, id, ok: false, error: { code: res.code, message: res.message } })
          void pluginAuditWrite(pluginId, 'deny', { method, code: res.code })
        }
      }).catch((err) => {
        if (alive && worker) {
          worker.postMessage({ channel: CHANNEL, v: 2, id, ok: false, error: { code: 'EINTERNAL', message: String((err as Error)?.message || err) } })
        }
      })
    }

    const boot = (): void => {
      try {
        worker = new Worker(`plugin://${pluginId}/${entry}`, { type: 'module' })
        workerRef.current = worker
        worker.onmessage = handleWorkerMessage
        worker.onerror = (ev) => {
          console.error(`[CodePlugin] ${pluginId} worker 错误:`, ev.message)
          showToast({ type: 'error', message: `代码插件 ${pluginId} 运行出错: ${ev.message}` })
          onDenied?.(ev.message)
        }
        void openSession()
      } catch (err) {
        console.error(`[CodePlugin] ${pluginId} worker 启动失败:`, err)
        onDenied?.(String((err as Error)?.message || err))
      }
    }

    boot()

    return () => {
      alive = false
      worker?.terminate()
      workerRef.current = null
      if (token) void hostBridgeClose(token)
    }
  }, [pluginId, entry, onDenied])

  return <span data-code-plugin-host={`${pluginId}`} className="hidden" />
}
