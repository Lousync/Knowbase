import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize as MaximizeIcon,
  FileText, AlertTriangle, Loader2, ListTree, Search, BookOpen, X, PanelLeft,
} from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import { renderTextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { workspaceReadRange } from '../../../lib/ipc'

// 同源 worker（v3 classic，兼容 Electron 33 / Chromium 130——v4.5+ 依赖 toHex 未实现）
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const CHUNK = 128 * 1024 // range 块大小：128KB

/** 文本层必要样式（pdf.js 官方 viewer.css 子集）：一次性注入 */
let textLayerStyleInjected = false
function ensureTextLayerStyle(): void {
  if (textLayerStyleInjected) return
  textLayerStyleInjected = true
  const style = document.createElement('style')
  style.id = 'kb-pdf-textlayer-style'
  style.textContent = `
    .kb-pdf-text-layer { position: absolute; inset: 0; overflow: hidden; line-height: 1; text-align: initial; }
    .kb-pdf-text-layer span, .kb-pdf-text-layer br { position: absolute; white-space: pre; transform-origin: 0% 0%; color: transparent; }
    .kb-pdf-text-layer ::selection { background: rgba(0,120,255,0.35); color: transparent; }
    .kb-pdf-text-layer .kb-pdf-match { color: transparent; outline: 2px solid rgba(230,140,30,0.9); background: rgba(230,140,30,0.35); }
  `
  document.head.appendChild(style)
}

/** base64 → Uint8Array（渲染层无 Buffer） */
function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 走 ws:readRange 的自定义 transport（plugin-pdf-reader-design §4）：
 * pdf.js 渲染层发起 range 请求 → IPC 精确读段 → onDataRange 回传。
 * 大 PDF 只拉可见字节，不整文件过 IPC。
 */
class KbRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  constructor(length: number, initialData: Uint8Array | null, private read: (begin: number, end: number) => Promise<Uint8Array>) {
    super(length, initialData)
  }
  requestDataRange(begin: number, end: number): void {
    void this.read(begin, end).then(
      (chunk) => this.onDataRange(begin, chunk),
      () => this.onDataRange(begin, null),
    )
  }
}

/** outline dest → 页码（v3 dest 结构：数组首元素是 {num,gen} ref；字符串需 getDestination 解析） */
async function destToPageNum(pdf: pdfjsLib.PDFDocumentProxy, dest: unknown): Promise<number> {
  try {
    let d = dest
    if (typeof d === 'string') d = await pdf.getDestination(d)
    if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && typeof (d[0] as { num?: unknown }).num === 'number') {
      return (d[0] as { num: number }).num
    }
  } catch { /* 解析失败回第 1 页 */ }
  return 1
}

interface OutlineNode {
  title: string
  dest?: unknown
  items: OutlineNode[]
}

interface Props {
  rootId: string
  relPath: string
  name: string
}

/**
 * 编辑器 PDF 阅读器（P1 v1）：懒加载 range transport + canvas + 文本层 + 大纲 + 搜索 + 沉浸。
 * 文本层：可选中复制（叠加在 canvas 上，透明字）。
 * 大纲：pdf 书签树 → 点击跳页。
 * 搜索：逐页文本遍历 → 匹配页列表 → 跳页并高亮本页命中。
 * 沉浸：隐藏全部自身 UI，居中页 + 底部悬浮条（自动淡出）。
 */
export function PdfReaderView({ rootId, relPath, name }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const pageHostRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const pageNumRef = useRef(1)
  const zoomRef = useRef(1)

  const [numPages, setNumPages] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fitWidth, setFitWidth] = useState(true)

  // 侧栏 / 搜索 / 沉浸
  const [sideTab, setSideTab] = useState<'outline' | 'search' | null>(null)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchHits, setSearchHits] = useState<Array<{ page: number; preview: string }>>([])
  const [immersive, setImmersive] = useState(false)
  const [barHidden, setBarHidden] = useState(false)

  const readRange = useCallback(async (begin: number, end: number): Promise<Uint8Array> => {
    const r = await workspaceReadRange(rootId, relPath, begin, Math.max(1, end - begin))
    if ('error' in r && r.error) throw new Error(r.error)
    return b64ToU8(r.data)
  }, [rootId, relPath])

  /** 渲染一页：canvas + 文本层（同 viewport 叠放），fitWidth 时按容器宽自适应 */
  const renderPage = useCallback(async (num: number, opts?: { keepZoom?: boolean }) => {
    const pdf = pdfRef.current
    const canvas = canvasRef.current
    const textHost = textLayerRef.current
    if (!pdf || !canvas || !textHost) return
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel() } catch { /* 忽略 */ } }
    try {
      const page = await pdf.getPage(num)
      const base = page.getViewport({ scale: 1 })
      const containerW = (containerRef.current?.clientWidth ?? 800) - (immersive ? 120 : 48)
      let scale = opts?.keepZoom ? zoomRef.current : (fitWidth ? Math.max(0.2, containerW / base.width) : zoomRef.current)
      if (fitWidth && !opts?.keepZoom) zoomRef.current = scale
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const task = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      renderTaskRef.current = task
      await task.promise
      renderTaskRef.current = null

      // 文本层：清空后重建（透明字、可选中、可被搜索高亮打标）
      textHost.innerHTML = ''
      textHost.style.width = `${viewport.width}px`
      textHost.style.height = `${viewport.height}px`
      const textContent = await page.getTextContent()
      const textTask = renderTextLayer({
        textContentSource: textContent,
        container: textHost,
        viewport,
      })
      await textTask.promise
      setZoom(scale)
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      if (!msg.includes('cancel')) setError(msg)
    }
  }, [fitWidth, immersive])

  const goPage = useCallback(async (num: number) => {
    const pdf = pdfRef.current
    if (!pdf) return
    const target = Math.max(1, Math.min(num, pdf.numPages))
    if (target === pageNumRef.current) {
      await renderPage(target, { keepZoom: true })
      return
    }
    pageNumRef.current = target
    setPageNum(target)
    await renderPage(target)
  }, [pdfRef, renderPage])

  /** 加载文档 */
  useEffect(() => {
    ensureTextLayerStyle()
    let alive = true
    setLoading(true)
    setError('')
    setSearchHits([])
    setSearchQuery('')
    void (async () => {
      try {
        const probe = await workspaceReadRange(rootId, relPath, 0, 4096)
        if ('error' in probe && probe.error) throw new Error(probe.error)
        if (!alive) return
        const head = b64ToU8(probe.data)
        const transport = new KbRangeTransport(probe.size, head.length > 0 ? head : null, readRange)
        const task = pdfjsLib.getDocument({ range: transport, disableAutoFetch: false, rangeChunkSize: CHUNK })
        const pdf = await task.promise
        if (!alive) { void task.destroy(); return }
        pdfRef.current = pdf
        setNumPages(pdf.numPages)
        // 大纲（书签树）
        try {
          const raw = await pdf.getOutline()
          if (raw && raw.length) {
            const walk = (list: typeof raw): OutlineNode[] => list.map((it) => ({
              title: it.title ?? '',
              dest: it.dest,
              items: it.items?.length ? walk(it.items) : [],
            }))
            setOutline(walk(raw))
          }
        } catch { setOutline([]) }
        setLoading(false)
        pageNumRef.current = 1
        setPageNum(1)
        await renderPage(1)
      } catch (e) {
        if (alive) setError(String((e as Error)?.message || e))
      }
    })()
    return () => {
      alive = false
      pdfRef.current?.destroy().catch(() => {})
      pdfRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, relPath])

  // 窗口 resize → 适宽重绘（沉浸模式无需：页面按容器滚动）
  useEffect(() => {
    if (!fitWidth || loading || immersive) return
    const onResize = () => { void renderPage(pageNumRef.current, { keepZoom: false }) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitWidth, loading, immersive, renderPage])

  const zoomBy = useCallback(async (delta: number) => {
    const pdf = pdfRef.current
    if (!pdf) return
    setFitWidth(false)
    zoomRef.current = Math.max(0.25, Math.min(5, (zoomRef.current || 1) * delta))
    await renderPage(pageNumRef.current, { keepZoom: true })
  }, [renderPage])

  /** 大纲点击 → 跳页 */
  const jumpOutline = useCallback(async (node: OutlineNode) => {
    const pdf = pdfRef.current
    if (!pdf || node.dest === undefined) return
    const p = await destToPageNum(pdf, node.dest)
    if (p >= 1 && p <= pdf.numPages) {
      await goPage(p)
      containerRef.current?.scrollTo({ top: 0 })
    }
  }, [goPage])

  /** 全文搜索：逐页取文本（结果缓存于模块级避免重复遍历） */
  const searchText = useCallback(async (q: string) => {
    const pdf = pdfRef.current
    if (!pdf || !q.trim()) { setSearchHits([]); return }
    const needle = q.trim().toLowerCase()
    setSearching(true)
    try {
      const hits: Array<{ page: number; preview: string }> = []
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n)
        const tc = await page.getTextContent()
        const text = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ')
        const idx = text.toLowerCase().indexOf(needle)
        if (idx >= 0) {
          const s = Math.max(0, idx - 20)
          hits.push({ page: n, preview: text.slice(s, idx + needle.length + 40).replace(/\s+/g, ' ') })
        }
      }
      setSearchHits(hits)
      if (hits.length) await goPage(hits[0].page)
    } finally {
      setSearching(false)
    }
  }, [goPage])

  /** 沉浸：进入/退出重置悬浮条显示 */
  const toggleImmersive = useCallback(() => {
    setImmersive((v) => {
      const next = !v
      if (next) { setSideTab(null); setBarHidden(false) }
      return next
    })
  }, [])

  /** 沉浸模式 30s 无操作 → 悬浮条淡出；动鼠标唤出 */
  const barTimer = useRef<number>(0)
  useEffect(() => {
    if (!immersive) return
    const wake = () => { setBarHidden(false); window.clearTimeout(barTimer.current); barTimer.current = window.setTimeout(() => setBarHidden(true), 30000) }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    return () => { window.clearTimeout(barTimer.current); window.removeEventListener('mousemove', wake); window.removeEventListener('keydown', wake) }
  }, [immersive])

  // 快捷键：PageUp/Down 翻页、Ctrl+F 搜索（退出沉浸时优先）、Esc 逐级退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.key === 'PageDown' || (e.key === ' ' && !immersive)) { e.preventDefault(); void goPage(pageNumRef.current + 1) }
      else if (e.key === 'PageUp') { e.preventDefault(); void goPage(pageNumRef.current - 1) }
      else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSideTab('search')
        const input = document.getElementById('kb-pdf-search-input') as HTMLInputElement | null
        input?.focus()
        input?.select()
      } else if (e.key === 'Escape') {
        if (document.getElementById('kb-pdf-search-input') === document.activeElement) {
          ;(document.activeElement as HTMLInputElement).blur()
        } else if (sideTab !== null) {
          setSideTab(null)
        } else if (immersive) {
          toggleImmersive()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPage, immersive, sideTab, toggleImmersive])

  // 渲染时高亮本页搜索命中：renderPage 后对文本层打标
  useEffect(() => {
    if (!searchQuery.trim() || loading) return
    const textHost = textLayerRef.current
    if (!textHost) return
    const needle = searchQuery.trim().toLowerCase()
    const spans = Array.from(textHost.querySelectorAll('span')) as HTMLElement[]
    let matched = false
    for (const span of spans) {
      if (span.textContent?.toLowerCase().includes(needle)) { span.classList.add('kb-pdf-match'); matched = true }
    }
    if (matched) setBarHidden(false)
  }, [pageNum, loading, searchQuery])

  // ===== 渲染 =====
  const toolbar = (
    <div className={`flex shrink-0 items-center gap-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[12px] text-[var(--text-secondary)] ${immersive ? 'hidden' : ''}`}>
      <FileText size={13} className="text-[var(--text-tertiary)]" />
      <span className="max-w-[220px] truncate text-[var(--text-primary)]">{name}</span>
      <span className="text-[var(--text-tertiary)]">{numPages} 页</span>
      <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
      <button onClick={() => void goPage(pageNum - 1)} disabled={pageNum <= 1} title="上一页 (PageUp)"
        className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40">
        <ChevronLeft size={15} />
      </button>
      <input
        value={pageNum}
        onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) void goPage(n) }}
        className="w-11 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 py-0.5 text-center text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      <span className="text-[var(--text-tertiary)]">/ {numPages}</span>
      <button onClick={() => void goPage(pageNum + 1)} disabled={pageNum >= numPages} title="下一页 (PageDown)"
        className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40">
        <ChevronRight size={15} />
      </button>
      <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
      <button onClick={() => { setFitWidth(true); void renderPage(pageNumRef.current) }} title="适合宽度"
        className={`rounded p-0.5 ${fitWidth ? 'text-[var(--accent)]' : 'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}>
        <MaximizeIcon size={14} />
      </button>
      <button onClick={() => void zoomBy(1.2)} title="放大" className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><ZoomIn size={14} /></button>
      <button onClick={() => void zoomBy(1 / 1.2)} title="缩小" className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><ZoomOut size={14} /></button>
      <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
      <button onClick={() => setSideTab((v) => (v === 'outline' ? null : 'outline'))} title="大纲"
        className={`flex items-center gap-1 rounded p-0.5 ${sideTab === 'outline' ? 'text-[var(--accent)]' : 'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}>
        <ListTree size={14} />大纲
      </button>
      <button onClick={() => setSideTab((v) => (v === 'search' ? null : 'search'))} title="搜索 (Ctrl+F)"
        className={`flex items-center gap-1 rounded p-0.5 ${sideTab === 'search' ? 'text-[var(--accent)]' : 'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}>
        <Search size={14} />搜索
      </button>
      <button onClick={toggleImmersive} title="沉浸阅读（隐藏全部 UI，Esc 退出）"
        className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 ${immersive ? 'text-[var(--accent)]' : 'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}>
        <BookOpen size={14} />沉浸
      </button>
      <span className="text-[11px] text-[var(--text-tertiary)]">{Math.round(zoom * 100)}%</span>
    </div>
  )

  const sidePanel = (
    <div className={`kb-view-fade flex w-64 shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)] ${immersive || sideTab === null ? 'hidden' : ''}`}>
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)]">
        {sideTab === 'outline' ? <><ListTree size={13} />大纲</> : <><Search size={13} />搜索</>}
        <button onClick={() => setSideTab(null)} className="ml-auto rounded p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><X size={12} /></button>
      </div>
      {sideTab === 'outline' && (
        <div className="kb-view-in min-h-0 flex-1 overflow-auto py-1">
          {outline.length === 0 && <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">此 PDF 没有书签</div>}
          <OutlineTree nodes={outline} onJump={(n) => void jumpOutline(n)} depth={0} />
        </div>
      )}
      {sideTab === 'search' && (
        <div className="kb-view-in flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 p-2">
            <input
              id="kb-pdf-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void searchText(searchQuery) }}
              placeholder="搜索全文…"
              className="min-w-0 flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <button onClick={() => void searchText(searchQuery)} disabled={searching || !searchQuery.trim()}
              className="rounded border border-[var(--border-color)] px-2 py-1 text-[12px] hover:bg-[var(--bg-hover)] disabled:opacity-40">
              {searching ? '…' : '搜索'}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
            {searchHits.length === 0 && !searching && searchQuery && (
              <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">无匹配</div>
            )}
            {searchHits.map((h, i) => (
              <button key={`${h.page}-${i}`} onClick={() => void goPage(h.page)}
                className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]">
                <div className="text-[11px] text-[var(--accent)]">第 {h.page} 页</div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--text-secondary)]">{h.preview}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const floatingBar = (
    <div className={`pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center transition-opacity duration-500 ${immersive && !barHidden ? 'opacity-100' : 'opacity-0'}`}>
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)]/95 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] shadow-lg backdrop-blur">
        <span className="text-[var(--text-primary)]">{pageNum} / {numPages} 页</span>
        <button onClick={() => void goPage(pageNum - 1)} className="rounded p-0.5 hover:bg-[var(--bg-hover)]"><ChevronLeft size={14} /></button>
        <button onClick={() => void goPage(pageNum + 1)} className="rounded p-0.5 hover:bg-[var(--bg-hover)]"><ChevronRight size={14} /></button>
        <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
        <button onClick={() => void zoomBy(1.2)} className="rounded p-0.5 hover:bg-[var(--bg-hover)]"><ZoomIn size={14} /></button>
        <button onClick={() => void zoomBy(1 / 1.2)} className="rounded p-0.5 hover:bg-[var(--bg-hover)]"><ZoomOut size={14} /></button>
        <button onClick={toggleImmersive} title="退出沉浸 (Esc)" className="rounded px-1.5 py-0.5 text-[var(--accent)] hover:bg-[var(--bg-hover)]">退出</button>
      </div>
    </div>
  )

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-[var(--text-secondary)]">
        <AlertTriangle size={28} className="text-[var(--text-warning)]" />
        <div className="max-w-md text-center text-[13px] leading-relaxed">PDF 打开失败：{error}</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-[var(--text-secondary)]">
        <Loader2 size={26} className="animate-spin text-[var(--accent)]" />
        <span className="text-[12.5px]">正在加载 {name}…（懒加载模式）</span>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--bg-tertiary)]">
      {toolbar}
      <div className="flex min-h-0 flex-1">
        {sidePanel}
        {/* 页面区：canvas + 文本层叠放 */}
        <div ref={containerRef} className="min-h-0 flex-1 overflow-auto">
          <div className={`flex min-h-full w-full items-start justify-center ${immersive ? 'p-0' : 'p-6'}`}>
            <div ref={pageHostRef} className="relative inline-block">
              <canvas ref={canvasRef} className="block bg-[var(--bg-primary)] shadow-sm" />
              <div ref={textLayerRef} className="kb-pdf-text-layer" style={{ top: 0, left: 0 }} />
            </div>
          </div>
        </div>
      </div>
      {immersive && <button onClick={toggleImmersive} title="退出沉浸 (Esc)"
        className="fixed top-3 right-3 z-50 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)]/90 text-[var(--text-secondary)] shadow hover:text-[var(--text-primary)]"><X size={14} /></button>}
      {floatingBar}
    </div>
  )
}

/** 大纲递归树 */
function OutlineTree({ nodes, onJump, depth }: { nodes: OutlineNode[]; onJump: (n: OutlineNode) => void; depth: number }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  return (
    <div className={depth > 0 ? 'ml-3 border-l border-[var(--border-color)]' : ''}>
      {nodes.map((n, i) => {
        const key = `${depth}-${i}-${n.title}`
        const isCollapsed = collapsed.has(key)
        const hasKids = n.items.length > 0
        return (
          <div key={key}>
            <div className="group flex items-center gap-0.5 pr-1 hover:bg-[var(--bg-hover)]">
              {hasKids ? (
                <button onClick={() => setCollapsed((s) => { const n2 = new Set(s); if (n2.has(key)) n2.delete(key); else n2.add(key); return n2 })}
                  className="w-4 shrink-0 pl-0.5 text-center text-[10px] text-[var(--text-tertiary)]">{isCollapsed ? '▸' : '▾'}</button>
              ) : <span className="w-4 shrink-0" />}
              <button onClick={() => onJump(n)}
                className="min-w-0 flex-1 truncate py-0.5 pr-2 text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                style={{ paddingLeft: depth > 0 ? 0 : 2 }}
                title={n.title}>
                {n.title}
              </button>
            </div>
            {hasKids && !isCollapsed && <OutlineTree nodes={n.items} onJump={onJump} depth={depth + 1} />}
          </div>
        )
      })}
    </div>
  )
}
