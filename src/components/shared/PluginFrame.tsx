import { useCallback, useEffect, useRef } from 'react'
import {
  pluginDataQuery, pluginDataInsert, pluginDataUpdate, pluginDataDelete,
  pluginAuditWrite, hostBridgeOpen, hostBridgeClose, hostRpc,
} from '../../lib/ipc'
import { showToast } from '../../lib/toast'

/**
 * 插件沙箱页宿主: sandbox iframe 加载 plugin://{id}/{entry}，转发 postMessage 桥。
 *
 * 协议双轨（v1/v2 并存一个版本周期，见 plugin-api-v2-design §9.3）：
 *   v1（无 v 字段，存量插件）: 渲染层本地裁决 + pluginData:* IPC（保留，避免破坏现网插件）
 *   v2（v:2，新插件）       : PluginFrame 降级纯管道——bridge-open 拿一次性 token，
 *                             请求 {v:2,id,token,method,params} → host:rpc 主进程裁决执行；
 *                             回包同 id 配对（并发安全）。裁决点已收口到主进程 Gateway。
 *
 * 授权单点化（V3-2 目标）: v2 路径下 PluginFrame 不再做 grantedRef.includes 判断，
 * 渲染层仅剩「协议转发」与「宿主本地动作（host.review 打开刷题器）」两类职责。
 */

const CHANNEL = 'kb-plugin'

/** 下发给插件的主题变量(插件据此适配深浅色) */
const THEME_VAR_NAMES = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover',
  '--text-primary', '--text-secondary', '--text-muted', '--text-disabled',
  '--accent', '--accent-hover', '--border-color', '--success', '--danger', '--warning',
]

interface BridgeMessage {
  channel?: string
  v?: number
  id?: string
  action?: string
  method?: string
  payload?: unknown
  token?: string
}

export function PluginFrame({ pluginId, entry, grantedCapabilities, onDenied, onHostAction }: {
  pluginId: string
  entry: string
  grantedCapabilities?: string[]
  onDenied?: (reason: string) => void
  /** 宿主动作转发（如 host.review 打开宿主刷题器）；返回 true 表示已处理 */
  onHostAction?: (action: string, payload: unknown) => boolean | void
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const grantedRef = useRef<string[]>(grantedCapabilities ?? [])
  const tokenRef = useRef<string | null>(null)
  const onHostRef = useRef(onHostAction)
  onHostRef.current = onHostAction

  /** v1 兜底：向 iframe 回包（含 v 透传，v2 由 rpc 路径回） */
  const postToFrame = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, ...msg }, '*')
  }, [])

  /** 收集主题 CSS 变量 */
  const collectThemeVars = useCallback((): Record<string, string> => {
    const style = getComputedStyle(document.documentElement)
    const vars: Record<string, string> = {}
    for (const name of THEME_VAR_NAMES) vars[name] = style.getPropertyValue(name).trim()
    return vars
  }, [])

  /** 下发 init（主题变量 + v2 token；插件据此发起 v2 请求） */
  const sendInit = useCallback(() => {
    postToFrame({ v: 2, action: 'init', payload: { vars: collectThemeVars(), token: tokenRef.current ?? null, hostVersion: '2' } })
  }, [postToFrame, collectThemeVars])

  useEffect(() => {
    let alive = true
    let closeToken: string | null = null

    // v2 会话开启：主进程发一次性 token（帧级生命周期；卸载时 close）
    void hostBridgeOpen(pluginId).then((r) => {
      if (!alive) return
      if (r.ok && r.token) {
        tokenRef.current = r.token
        closeToken = r.token
        sendInit() // token 就绪后补发 init（若 frame 尚未 load，onLoad 会再发一次，幂等）
      } else {
        onDenied?.(r.message ?? 'bridge-open 失败')
      }
    })

    /** v2 渲染层本地动作：主进程裁决通过后回 { local } 标记，此处真正执行 */
    const handleLocal = (local: string, payload: unknown): boolean => {
      if (local === 'toast' && typeof payload === 'string') { showToast({ type: 'info', message: payload }); return true }
      if (local === 'host.review') { onHostRef.current?.('host.review', payload); return true }
      if (local === 'clipboard' && typeof payload === 'string') {
        void navigator.clipboard.writeText(payload)
          .then(() => showToast({ type: 'info', message: '已复制到剪贴板' }))
          .catch(() => showToast({ type: 'error', message: '复制失败' }))
        return true
      }
      if (local === 'theme') {
        const vars = (payload && typeof payload === 'object')
          ? ((payload as { vars?: unknown }).vars ?? payload) as Record<string, unknown> : null
        if (vars) {
          for (const [k, v] of Object.entries(vars)) {
            if (!/^--[a-zA-Z0-9-]{1,64}$/.test(k) || typeof v !== 'string' || v.length > 200) continue
            if (/url\s*\(|expression|@|{|}|<|>/i.test(v)) continue
            document.documentElement.style.setProperty(k, v)
          }
        }
        return true
      }
      return false
    }

    const onMessage = (e: MessageEvent) => {
      const d = (e.data ?? {}) as BridgeMessage
      if (d.channel !== CHANNEL) return
      const id = d.id ?? ''

      // ---------- v2：纯管道转发 → 主进程 Gateway 裁决执行 ----------
      if (d.v === 2) {
        const token = tokenRef.current
        if (!token) {
          postToFrame({ v: 2, id, ok: false, error: { code: 'EBRIDGE', message: 'bridge 会话未就绪' } })
          return
        }
        const method = d.method ?? d.action ?? ''
        void hostRpc({ token, id, method, params: d.payload }).then((res) => {
          if (!alive) return
          if (res.ok) {
            // 渲染层本地动作（toast/host.review）由主进程返回 { local } 标记
            const r = res.result as { local?: string } | undefined
            if (r && typeof r === 'object' && r.local) {
              postToFrame({ v: 2, id, ok: true, result: { handled: handleLocal(r.local, d.payload) } })
            } else {
              postToFrame({ v: 2, id, ok: true, result: res.result })
            }
          } else {
            postToFrame({ v: 2, id, ok: false, error: { code: res.code, message: res.message } })
            void pluginAuditWrite(pluginId, 'deny', { method, code: res.code })
          }
        }).catch((err) => {
          if (alive) postToFrame({ v: 2, id, ok: false, error: { code: 'EINTERNAL', message: String(err?.message || err) } })
        })
        return
      }

      // ---------- v1：存量插件（渲染层裁决 + pluginData IPC）----------
      const reply = (payload: unknown) => postToFrame({ action: d.action, payload })
      const deny = (reason: string) => {
        reply({ denied: true, reason })
        void pluginAuditWrite(pluginId, 'deny', { action: d.action, reason })
        onDenied?.(reason)
        showToast({ type: 'warning', message: `插件请求被拒绝:${reason}` })
      }

      switch (d.action) {
        case 'data.query': {
          if (!grantedRef.current.includes('data')) { deny('未授予 data 能力'); return }
          const p = (d.payload ?? {}) as { table?: string; where?: unknown; orderBy?: string; desc?: boolean; limit?: number }
          if (typeof p.table !== 'string' || !p.table) { reply({ rows: [], denied: true, reason: 'table 缺失' }); return }
          void pluginDataQuery(pluginId, p.table, {
            where: p.where as never, orderBy: p.orderBy, desc: p.desc, limit: p.limit,
          }).then(rows => reply({ rows })).catch(err => reply({ rows: [], denied: true, reason: String(err?.message || err) }))
          return
        }
        case 'data.insert': {
          if (!grantedRef.current.includes('data')) { deny('未授予 data 能力'); return }
          const p = (d.payload ?? {}) as { table?: string; row?: Record<string, unknown> }
          if (typeof p.table !== 'string' || !p.table || !p.row) { reply({ ok: false, reason: '参数缺失' }); return }
          void pluginDataInsert(pluginId, p.table, p.row).then(r => reply(r)).catch(err => reply({ ok: false, reason: String(err?.message || err) }))
          return
        }
        case 'data.update': {
          if (!grantedRef.current.includes('data')) { deny('未授予 data 能力'); return }
          const p = (d.payload ?? {}) as { table?: string; rowId?: string | number; patch?: Record<string, unknown> }
          if (typeof p.table !== 'string' || !p.table || p.rowId === undefined || !p.patch) { reply({ ok: false, reason: '参数缺失' }); return }
          void pluginDataUpdate(pluginId, p.table, p.rowId, p.patch).then(r => reply(r)).catch(err => reply({ ok: false, reason: String(err?.message || err) }))
          return
        }
        case 'data.delete': {
          if (!grantedRef.current.includes('data')) { deny('未授予 data 能力'); return }
          const p = (d.payload ?? {}) as { table?: string; rowId?: string | number }
          if (typeof p.table !== 'string' || !p.table || p.rowId === undefined) { reply({ ok: false, reason: '参数缺失' }); return }
          void pluginDataDelete(pluginId, p.table, p.rowId).then(r => reply(r)).catch(err => reply({ ok: false, reason: String(err?.message || err) }))
          return
        }
        case 'clipboard.write': {
          if (!grantedRef.current.includes('clipboard')) { deny('未授予剪贴板能力'); return }
          if (typeof d.payload !== 'string') return
          navigator.clipboard.writeText(d.payload).catch(() => showToast({ type: 'error', message: '复制失败' }))
          return
        }
        case 'theme.apply': {
          if (!grantedRef.current.includes('theme')) { deny('未授予主题能力'); return }
          const vars = (d.payload && typeof d.payload === 'object')
            ? ((d.payload as { vars?: unknown }).vars ?? d.payload) as Record<string, unknown> : null
          if (!vars) return
          for (const [k, v] of Object.entries(vars)) {
            if (!/^--[a-zA-Z0-9-]{1,64}$/.test(k) || typeof v !== 'string' || v.length > 200) continue
            if (/url\s*\(|expression|@|{|}|<|>/i.test(v)) continue
            document.documentElement.style.setProperty(k, v)
          }
          reply({ denied: false })
          return
        }
        case 'toast': {
          if (typeof d.payload === 'string') showToast({ type: 'info', message: d.payload })
          return
        }
        case 'host.review': {
          if (!grantedRef.current.includes('knowledge')) { deny('未授予 knowledge 能力'); return }
          const handled = onHostRef.current?.('host.review', d.payload)
          if (handled !== false) reply({ ok: true })
          return
        }
        default:
          deny(`未知消息类型: ${String(d.action)}`)
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      alive = false
      window.removeEventListener('message', onMessage)
      if (closeToken) void hostBridgeClose(closeToken)
      tokenRef.current = null
    }
  }, [pluginId, onDenied, postToFrame, sendInit])

  return (
    <iframe
      ref={frameRef}
      data-plugin-frame=""
      title={`插件 ${pluginId}`}
      src={`plugin://${pluginId}/${entry}`}
      sandbox="allow-scripts allow-forms allow-popups"
      onLoad={sendInit}
      className="w-full h-full border-0 bg-transparent"
    />
  )
}
