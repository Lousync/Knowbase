import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { workspaceGetCurrent, workspaceReadFile } from '../../lib/ipc'
import { collectThemeVars } from './htmlShell'

/**
 * 工件栏 HTML 页签（docs/ai-teaching-artifacts-pane-design.md §4.2-§4.4，2026-09-09 实修裁决）：
 * 载体 = 主进程 kbview://vault/<rel> 协议（electron/lib/kbVisualProtocol.ts）——
 * srcdoc 子框架会**继承父文档 CSP**（index.html `script-src 'self'`），示意图内联脚本与宿主量高脚本全被拦；
 * blob: 又被 sandbox（无 allow-same-origin → opaque）拒载。跨 scheme 正常导航两者都绕开，且响应头 CSP 由主进程统一裁决。
 * 主题/高度/错误壳：协议注入量高与主题监听脚本，宿主经 postMessage 下发 CSS 变量（图随明暗主题即时走）。
 * fit（工件栏 ⤢ 放大态）：fit-to-window 缩放循环——沙箱上报 {内容高 h, 横溢 sw>vw?}，
 * 宿主对 iframe 施加 CSS zoom（矢量/文字无损放大），步进逼近「高度撑满且横向不溢出」；非 fit 时 k=1、iframe=内容高+居中。
 * 安全红线不变：sandbox="allow-scripts" 绝不加 allow-same-origin。
 *
 * 布局（2026-09-09 三修后的四修）：wrap = relative h-full 直接子用 absolute inset-0，
 * iframe 始终填满分栏高度，不再依赖 iframe-container 自适应；沙箱内 body{min-height:100% !important}
 * + flex 垂直居中让图矮于画布时居中、高于画布时正常滚动；警告条 absolute 叠在顶部，不挤压 iframe 高度。
 */
export function ArtHtmlView({ relPath, reloadSeq, fit = false }: { relPath: string; reloadSeq: number; fit?: boolean }) {
  const [doc, setDoc] = useState<{ content: string; mtimeMs: number } | null>(null)
  const [readErr, setReadErr] = useState('')
  const [frameErr, setFrameErr] = useState('')
  const [showSrc, setShowSrc] = useState(false)
  const [box, setBox] = useState<{ h: number; sw: number; vw: number } | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState({ w: 0, h: 0 })

  // 明暗主题切换 → 向沙箱内壳重发 CSS 变量（§4.4，不重挂 iframe）
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick(t => t + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => mo.disconnect()
  }, [])

  // 可用空间（fit 判定基准）：跟随栏宽拖拽 / 放大收缩 / 窗口 resize
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setAvail({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [fit, relPath, !!doc]) // doc 加载前 wrap 未渲染（早退分支），加载后需补挂观测

  useEffect(() => {
    let alive = true
    setReadErr('')
    void (async () => {
      try {
        const cur = await workspaceGetCurrent().catch(() => null)
        const rootId = (cur as { rootId?: string } | null)?.rootId
        if (!rootId) throw new Error('尚未打开仓库')
        const r = await workspaceReadFile(rootId, relPath)
        if (!alive) return
        if (!r || typeof r.content !== 'string') throw new Error('读取文件失败')
        setDoc({ content: r.content, mtimeMs: Number(r.mtimeMs ?? 0) })
      } catch (e) {
        if (alive) setReadErr(String((e as Error)?.message ?? e))
      }
    })()
    return () => { alive = false }
  }, [relPath, reloadSeq])

  const frameUrl = useMemo(() => {
    if (!doc) return ''
    const seg = relPath.split('/').map(s => encodeURIComponent(s)).join('/')
    return `kbview://vault/${seg}?v=${Math.round(doc.mtimeMs)}-${reloadSeq}`
  }, [doc, relPath, reloadSeq])

  /** fit 缩放（2026-09-09 二修）：zoom 必须做在**沙箱内部 documentElement**上——
   *  宿主 iframe 元素 zoom 会等比缩小内部视口，宽度驱动的等比 SVG 视觉高度恒不变（放大空转，一版踩坑）。
   *  内层 zoom 把内容物理放大：fit 态 iframe 直接铺满可用区，内容由壳内 zoom 撑到 ~92% 高（上限 4×），横向超出时图内可拖动；
   *  基准高 = k=1 首帧自然高。 */
  const [baseH, setBaseH] = useState(0)
  const fitKRef = useRef(1)
  useEffect(() => { setBaseH(0); fitKRef.current = 1 }, [frameUrl])
  useEffect(() => { if (box && !baseH) setBaseH(box.h) }, [box, baseH])
  const fitK = useMemo(() => {
    const k = fit && baseH > 0 && avail.h > 0 ? Math.max(1, Math.min(4, (avail.h * 0.92) / baseH)) : 1
    fitKRef.current = k
    return k
  }, [fit, baseH, avail.h])

  const pushEnv = useCallback(() => {
    try { frameRef.current?.contentWindow?.postMessage({ __kbArtTheme: collectThemeVars(), __kbArtZoom: fitKRef.current }, '*') } catch { /* iframe 未就绪 */ }
  }, [])
  useEffect(() => { pushEnv() }, [themeTick, pushEnv, fitK, frameUrl]) // 明暗/缩放/文档变化重发（未 ready 帧由 __kbArtReady 补）

  // 宿主消息：仅采信本 iframe 源（§4.3 劫持防护）；保留 box 量高供 fit 用
  const onMsg = useCallback((e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null
    if (!d || e.source !== frameRef.current?.contentWindow) return
    if (d.__kbArtBox && typeof d.__kbArtBox === 'object') {
      const b = d.__kbArtBox as { h?: number; sw?: number; vw?: number }
      if (typeof b.h === 'number') setBox({ h: Math.max(1, b.h), sw: Math.max(0, b.sw ?? 0), vw: Math.max(1, b.vw ?? 1) })
    }
    if (typeof d.__kbArtErr === 'string') setFrameErr(d.__kbArtErr)
    else if (d.__kbArtReady === true) pushEnv()
  }, [pushEnv])
  useEffect(() => {
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onMsg])

  const lines = useMemo(() => (doc ? doc.content.split('\n').length : 0), [doc])

  if (readErr) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-[12.5px] text-[var(--text-secondary)]">示意图文件读取失败</div>
        <div className="text-[11px] text-[var(--text-muted)] break-all">{readErr}</div>
      </div>
    )
  }
  if (!doc) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-[var(--text-muted)]">加载示意图…</div>
    )
  }
  return (
    <div ref={wrapRef} className="relative h-full">
      {lines > 150 && !fit && (
        <div className="absolute top-0 left-0 right-0 z-10 px-3 py-1.5 bg-[var(--warning-bg)] border-b border-[var(--warning)]/30 text-[11px] text-[var(--warning)]">
          ⚠ 共 {lines} 行，超出产物约束（≤150 行），渲染可能不佳
        </div>
      )}
      {frameErr && !showSrc ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="text-[12.5px] text-[var(--text-primary)]">示意图脚本运行出错</div>
          <div className="mt-1 text-[11px] text-[var(--text-muted)] break-all">{frameErr}</div>
          <button onClick={() => setShowSrc(true)} className="mt-3 px-2.5 py-1 rounded-md border border-[var(--border-color)] text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">查看源码</button>
        </div>
      ) : showSrc ? (
        <div className="absolute inset-0 overflow-y-auto px-3 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10.5px] text-[var(--text-muted)]">HTML 源码（只读）</span>
            <button onClick={() => setShowSrc(false)} className="ml-auto text-[10.5px] px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">← 返回渲染</button>
          </div>
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)] font-[var(--font-mono,var(--font-family))]">{doc.content}</pre>
        </div>
      ) : (
        <iframe
          ref={frameRef}
          key={frameUrl}
          src={frameUrl}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={relPath}
          className="absolute inset-0 w-full h-full"
          style={{
            border: 'none',
            background: 'var(--bg-primary)',
            display: 'block',
          }}
        />
      )}
    </div>
  )
}
