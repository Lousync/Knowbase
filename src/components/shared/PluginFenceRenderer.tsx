import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 插件 fenced-code 渲染器（plugin-phase1-design C6）——内容只读沙箱。
 *
 * 与 PluginFrame（完整 RPC 桥）不同：渲染器 iframe 不开 bridge 会话、没有 token、
 * 无任何能力面——sandbox="allow-scripts"（opaque origin，不可自取 plugin:// 资源、
 * 不可访问宿主），宿主只单向下发 { code, pageId, pageTitle, vars }，插件可回报
 * fence-height 协商高度与 fence-ready 就绪信号。3 秒未就绪 → onFailed 回退普通代码块。
 */
const CHANNEL = 'kb-plugin-fence'
const READY_TIMEOUT_MS = 3000
const THEME_VAR_NAMES = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--text-primary', '--text-secondary',
  '--text-muted', '--accent', '--border-color',
]

export function PluginFenceRenderer({ pluginId, entry, code, pageId, pageTitle, height, onFailed }: {
  pluginId: string
  entry: string
  code: string
  pageId?: string
  pageTitle?: string
  height?: number
  onFailed?: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [h, setH] = useState(Math.min(2000, Math.max(40, Math.floor(height ?? 240))))
  const readyRef = useRef(false)
  const onFailedRef = useRef(onFailed)
  onFailedRef.current = onFailed

  const sendInput = useCallback(() => {
    const style = getComputedStyle(document.documentElement)
    const vars: Record<string, string> = {}
    for (const name of THEME_VAR_NAMES) vars[name] = style.getPropertyValue(name).trim()
    frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, action: 'fence-input', payload: { code, pageId, pageTitle, vars } }, '*')
  }, [code, pageId, pageTitle])

  useEffect(() => {
    readyRef.current = false
    const timer = window.setTimeout(() => {
      if (!readyRef.current) onFailedRef.current?.()
    }, READY_TIMEOUT_MS)
    const onMsg = (e: MessageEvent) => {
      const d = (e.data ?? {}) as { channel?: string; action?: string; payload?: unknown }
      if (d.channel !== CHANNEL) return
      if (d.action === 'fence-ready') {
        readyRef.current = true
        window.clearTimeout(timer)
        sendInput()
      }
      if (d.action === 'fence-height') {
        const n = Number((d.payload as { height?: number } | undefined)?.height)
        if (Number.isFinite(n)) setH(Math.min(2000, Math.max(40, Math.floor(n))))
      }
    }
    window.addEventListener('message', onMsg)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMsg)
    }
  }, [sendInput])

  // 内容变化重发输入（已就绪后）
  useEffect(() => {
    if (readyRef.current) sendInput()
  }, [sendInput])

  return (
    <iframe
      ref={frameRef}
      src={`plugin://${pluginId}/${entry}`}
      sandbox="allow-scripts"
      title="插件渲染"
      onLoad={sendInput}
      style={{ width: '100%', height: h, border: '1px solid var(--border-color)', borderRadius: 6, display: 'block', background: 'var(--bg-secondary)' }}
    />
  )
}
