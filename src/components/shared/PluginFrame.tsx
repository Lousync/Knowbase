import { useEffect, useRef } from 'react'
import { pluginDataQuery, pluginDataInsert, pluginDataUpdate, pluginDataDelete, pluginAuditWrite } from '../../lib/ipc'
import { showToast } from '../../lib/toast'

/**
 * 插件沙箱页宿主:sandbox iframe 加载 plugin://{id}/{entry},并按授权白名单执行 postMessage 桥。
 *
 * 协议(沿用 toolbox 既有约定,避免多套协议并存):
 *   插件 → 宿主: { channel: 'kb-plugin', action: string, payload: unknown }
 *   宿主 → 插件: { channel: 'kb-plugin', action: 同名, payload: { denied?, reason?, ...结果 } }
 *   宿主 → 插件(加载完成): { channel: 'kb-plugin', action: 'init', payload: { vars } }
 *
 * 支持的能力:
 *   clipboard.write  剪贴板写入(clipboard)
 *   theme.apply      注入 CSS 变量(theme)
 *   data.query / data.insert / data.update / data.delete  插件自有数据表读写(data,C 级)
 *   toast            弹提示(无需授权)
 *
 * 安全:data.* 强制使用当前挂载的 pluginId(插件无法访问别的插件或宿主表),
 *      未授权一律 deny 并写审计。
 */

const CHANNEL = 'kb-plugin'

/** 下发给插件的主题变量(插件据此适配深浅色) */
const THEME_VAR_NAMES = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover',
  '--text-primary', '--text-secondary', '--text-muted', '--text-disabled',
  '--accent', '--accent-hover', '--border-color', '--success', '--danger', '--warning',
]

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

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.channel !== CHANNEL) return
      const reply = (payload: unknown) => {
        frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, action: d.action, payload }, '*')
      }
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
          })
            .then(rows => reply({ rows }))
            .catch(err => reply({ rows: [], denied: true, reason: String(err?.message || err) }))
          return
        }
        case 'data.insert': {
          if (!grantedRef.current.includes('data')) { deny('未授予 data 能力'); return }
          const p = (d.payload ?? {}) as { table?: string; row?: Record<string, unknown> }
          if (typeof p.table !== 'string' || !p.table || !p.row) { reply({ ok: false, reason: '参数缺失' }); return }
          void pluginDataInsert(pluginId, p.table, p.row)
            .then(r => reply(r))
            .catch(err => reply({ ok: false, reason: String(err?.message || err) }))
          return
        }
        case 'data.update': {
          if (!grantedRef.current.includes('data')) { deny('未授予 data 能力'); return }
          const p = (d.payload ?? {}) as { table?: string; rowId?: string | number; patch?: Record<string, unknown> }
          if (typeof p.table !== 'string' || !p.table || p.rowId === undefined || !p.patch) { reply({ ok: false, reason: '参数缺失' }); return }
          void pluginDataUpdate(pluginId, p.table, p.rowId, p.patch)
            .then(r => reply(r))
            .catch(err => reply({ ok: false, reason: String(err?.message || err) }))
          return
        }
        case 'data.delete': {
          if (!grantedRef.current.includes('data')) { deny('未授予 data 能力'); return }
          const p = (d.payload ?? {}) as { table?: string; rowId?: string | number }
          if (typeof p.table !== 'string' || !p.table || p.rowId === undefined) { reply({ ok: false, reason: '参数缺失' }); return }
          void pluginDataDelete(pluginId, p.table, p.rowId)
            .then(r => reply(r))
            .catch(err => reply({ ok: false, reason: String(err?.message || err) }))
          return
        }
        case 'clipboard.write': {
          if (!grantedRef.current.includes('clipboard')) { deny('未授予剪贴板能力'); return }
          if (typeof d.payload !== 'string') return
          navigator.clipboard.writeText(d.payload)
            .then(() => showToast({ type: 'info', message: '已复制到剪贴板' }))
            .catch(() => showToast({ type: 'error', message: '复制失败' }))
          return
        }
        case 'theme.apply': {
          if (!grantedRef.current.includes('theme')) { deny('未授予主题能力'); return }
          const vars = (d.payload && typeof d.payload === 'object') ? (d.payload as { vars?: unknown }).vars ?? d.payload : null
          if (!vars || typeof vars !== 'object') return
          for (const [k, v] of Object.entries(vars as Record<string, unknown>)) {
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
          // 打开宿主刷题器（插件模式，判题写插件表）。需要 knowledge 能力。
          if (!grantedRef.current.includes('knowledge')) { deny('未授予 knowledge 能力'); return }
          const handled = onHostAction?.('host.review', d.payload)
          if (handled !== false) reply({ ok: true })
          return
        }
        default:
          deny(`未知消息类型: ${String(d.action)}`)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pluginId, onDenied, onHostAction])

  // iframe 就绪后下发主题变量
  const sendInit = () => {
    const style = getComputedStyle(document.documentElement)
    const vars: Record<string, string> = {}
    for (const name of THEME_VAR_NAMES) vars[name] = style.getPropertyValue(name).trim()
    frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, action: 'init', payload: { vars } }, '*')
  }

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
