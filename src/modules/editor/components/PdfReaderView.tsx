import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize as MaximizeIcon, FileText, AlertTriangle, Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { workspaceReadRange } from '../../../lib/ipc'

// 同源 worker（v3 classic，兼容 Electron 33 / Chromium 130——v4.5+ 依赖 toHex 未实现）
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const CHUNK = 128 * 1024 // range 块大小：128KB

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
 * 大 PDF 只拉可见字节，不整文件过 IPC（对比 PdfViewer 的 base64 全量）。
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

interface Props {
  rootId: string
  relPath: string
  name: string
}

/**
 * 编辑器 PDF 视图（P1）：懒加载 range transport + canvas 单页渲染。
 * v1 能力：翻页 / 缩放 / 适合宽度 / 页码跳转。大纲/搜索/文本层/沉浸阅读后续轮次叠加。
 */
export function PdfReaderView({ rootId, relPath, name }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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

  /** 经 IPC 读 [begin, end) 段（base64 解回 Uint8Array） */
  const readRange = useCallback(async (begin: number, end: number): Promise<Uint8Array> => {
    const r = await workspaceReadRange(rootId, relPath, begin, Math.max(1, end - begin))
    if ('error' in r && r.error) throw new Error(r.error)
    return b64ToU8(r.data)
  }, [rootId, relPath])

  const renderPage = useCallback(async (num: number) => {
    const pdf = pdfRef.current
    if (!pdf) return
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel() } catch { /* 忽略 */ } }
    try {
      const page = await pdf.getPage(num)
      const base = page.getViewport({ scale: 1 })
      // fitWidth 自适应容器宽（页宽 = 容器宽 - 内边距）
      const cw = fitWidth ? Math.max(240, (containerRef.current?.clientWidth ?? 800) - 48) : base.width * zoomRef.current
      const scale = cw / base.width
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
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
      setZoom(scale)
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      if (!msg.includes('cancel')) setError(msg)
    }
  }, [fitWidth])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    // 首次探测：前 4KB + 总长 → transport 构造（pdf.js 随后按需 range 拉取）
    void (async () => {
      try {
        const probe = await workspaceReadRange(rootId, relPath, 0, 4096)
        if ('error' in probe && probe.error) throw new Error(probe.error)
        if (!alive) return
        const total = probe.size
        const head = b64ToU8(probe.data)
        const transport = new KbRangeTransport(total, head.length > 0 ? head : null, readRange)
        const task = pdfjsLib.getDocument({ range: transport, disableAutoFetch: false, rangeChunkSize: CHUNK })
        const pdf = await task.promise
        if (!alive) { void task.destroy(); return }
        pdfRef.current = pdf
        setNumPages(pdf.numPages)
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

  // 窗口尺寸变化 → fitWidth 重绘
  useEffect(() => {
    if (!fitWidth || loading) return
    const onResize = () => { void renderPage(pageNumRef.current) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitWidth, loading, renderPage])

  const goPage = useCallback(async (num: number) => {
    const target = Math.max(1, Math.min(num, numPages))
    if (target === pageNumRef.current) return
    pageNumRef.current = target
    setPageNum(target)
    await renderPage(target)
  }, [numPages, renderPage])

  const zoomBy = useCallback(async (delta: number) => {
    const cur = pdfRef.current
    if (!cur) return
    setFitWidth(false)
    zoomRef.current = Math.max(0.25, Math.min(5, (zoomRef.current || 1) * delta))
    const base = (await cur.getPage(pageNumRef.current)).getViewport({ scale: 1 })
    const viewport = base.clone({ scale: zoomRef.current })
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const page = await cur.getPage(pageNumRef.current)
    const task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: zoomRef.current }), transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
    renderTaskRef.current = task
    await task.promise
    renderTaskRef.current = null
    setZoom(zoomRef.current)
  }, [])

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
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-tertiary)]">
      {/* PDF 工具条 */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[12px] text-[var(--text-secondary)]">
        <FileText size={13} className="text-[var(--text-tertiary)]" />
        <span className="max-w-[240px] truncate text-[var(--text-primary)]">{name}</span>
        <span className="text-[var(--text-tertiary)]">{numPages} 页</span>
        <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
        <button onClick={() => void goPage(pageNum - 1)} disabled={pageNum <= 1} title="上一页 (PageUp)"
          className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronLeft size={15} />
        </button>
        <input
          value={pageNum}
          onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) void goPage(n) }}
          className="w-12 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 py-0.5 text-center text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <span className="text-[var(--text-tertiary)]">/ {numPages}</span>
        <button onClick={() => void goPage(pageNum + 1)} disabled={pageNum >= numPages} title="下一页 (PageDown)"
          className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronRight size={15} />
        </button>
        <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
        <button onClick={() => { setFitWidth(true); void renderPage(pageNumRef.current) }} title="适合宽度"
          className={`rounded p-0.5 ${fitWidth ? 'text-[var(--accent)]' : 'hover:bg-[var(--bg-hover)]'}`}>
          <MaximizeIcon size={14} />
        </button>
        <button onClick={() => void zoomBy(1.2)} title="放大"
          className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => void zoomBy(1 / 1.2)} title="缩小"
          className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
          <ZoomOut size={14} />
        </button>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">{Math.round(zoom * 100)}%</span>
      </div>
      {/* 页面画布（居中滚动） */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full w-full items-start justify-center p-6">
          <canvas ref={canvasRef} className="bg-[var(--bg-primary)] shadow-sm" />
        </div>
      </div>
    </div>
  )
}
