import { useRef, useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, FileText, AlertTriangle } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

// 使用同源 worker URL（开发为 http，打包后配合 allow-file-access-from-files）。
// 注意：pdf.js 使用 v3（classic worker），兼容 Electron 33 / Chromium 130——
// 新版 pdf.js(v4.5+) 依赖 Uint8Array.prototype.toHex 而 Electron 33 未实现。
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  base64: string
  title?: string
}

/**
 * 内嵌 PDF 阅读器 — 基于 pdf.js 渲染到 canvas。
 * 支持翻页、缩放、适合宽度、滚轮滚动。
 */
export function PdfViewer({ base64, title = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const pageNumRef = useRef(1)
  const zoomRef = useRef(1)

  const [numPages, setNumPages] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [fitWidth, setFitWidth] = useState(true)

  const renderPage = useCallback(async (num: number) => {
    const pdf = pdfRef.current
    if (!pdf) return
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel() } catch {} }

    try {
      const p = await pdf.getPage(num)
      const viewport = p.getViewport({ scale: zoomRef.current })
      const canvas = canvasRef.current
      if (!canvas) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const renderTask = p.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      renderTaskRef.current = renderTask
      await renderTask.promise
      renderTaskRef.current = null
    } catch (e: any) {
      // canceled or render error — ignore
      if (e?.name !== 'RenderingCancelledException') console.error('[PdfViewer] render failed:', e)
    }
  }, [])

  // 在 container 宽度变化时自动贴合宽度
  const updateFitWidth = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    const pdf = pdfRef.current
    if (!container || !canvas || !pdf || !fitWidth) return
    const page = pdf.getPage(pageNumRef.current)
    page.then(p => {
      const base = p.getViewport({ scale: 1 })
      const avail = container.clientWidth - 32
      const scale = avail / base.width
      zoomRef.current = scale
      setZoom(scale)
    })
  }, [fitWidth])

  useEffect(() => {
    if (numPages === 0) return
    updateFitWidth()
    // 等 fit-width 算好缩放后再渲染当前页，保证首次显示即贴合宽度
    requestAnimationFrame(() => renderPage(pageNumRef.current))
  }, [numPages, updateFitWidth, renderPage])

  // ResizeObserver — 容器尺寸变化时如果处于"适合宽度"则重新适配
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      updateFitWidth()
      requestAnimationFrame(() => renderPage(pageNumRef.current))
    })
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateFitWidth])

  // 加载 PDF
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPageNum(1)
    setNumPages(0)
    pageNumRef.current = 1

    ;(async () => {
      try {
        const bytes = base64ToUint8Array(base64)
        const loadingTask = pdfjsLib.getDocument({ data: bytes })
        loadingTaskRef.current = loadingTask
        loadingTask.promise
          .then(doc => {
            if (cancelled) { loadingTask.destroy(); return }
            pdfRef.current = doc
            setNumPages(doc.numPages)
            setLoading(false)
            renderPage(1)
          })
          .catch(e => {
            if (cancelled) return
            console.error('[PdfViewer] load failed:', e)
            setError(String(e?.message || e))
            setLoading(false)
          })
      } catch (e: any) {
        if (cancelled) return
        setError(String(e?.message || e))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (renderTaskRef.current) { try { renderTaskRef.current.cancel() } catch {} }
      if (loadingTaskRef.current) { try { loadingTaskRef.current.destroy() } catch {} }
      loadingTaskRef.current = null
      pdfRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base64])

  const goToPage = useCallback((num: number) => {
    const next = Math.max(1, Math.min(numPages || 1, num))
    pageNumRef.current = next
    setPageNum(next)
    renderPage(next)
  }, [numPages, renderPage])

  const changeZoom = useCallback((delta: number) => {
    setFitWidth(false)
    const next = Math.min(4, Math.max(0.3, zoomRef.current * delta))
    zoomRef.current = next
    setZoom(next)
    renderPage(pageNumRef.current)
  }, [renderPage])

  const handleFitWidth = useCallback(() => {
    setFitWidth(true)
    updateFitWidth()
    // wait for scale state to apply then re-render
    requestAnimationFrame(() => renderPage(pageNumRef.current))
  }, [renderPage, updateFitWidth])

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    changeZoom(e.deltaY < 0 ? 1.1 : 0.9)
  }, [changeZoom])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border-color)] shrink-0 select-none">
        <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
        <span className="text-[12px] text-[var(--text-secondary)] truncate flex-1">{title || 'PDF 文档'}</span>

        <button
          onClick={() => goToPage(pageNum - 1)}
          disabled={pageNum <= 1}
          className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 transition-colors"
          title="上一页"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-[12px] text-[var(--text-muted)] whitespace-nowrap">
          <input
            className="w-9 bg-[var(--input-bg)] border border-[var(--border-color)] rounded px-1 py-0.5 text-[12px] text-center text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            value={pageNum}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v)) goToPage(v)
            }}
            onBlur={() => setPageNum(pageNumRef.current)}
          />
          {' '}/ {numPages}
        </span>
        <button
          onClick={() => goToPage(pageNum + 1)}
          disabled={pageNum >= numPages}
          className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 transition-colors"
          title="下一页"
        >
          <ChevronRight size={15} />
        </button>

        <div className="w-px h-4 bg-[var(--border-color)] mx-1" />

        <button
          onClick={() => changeZoom(1.1)}
          className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="放大"
        >
          <ZoomIn size={15} />
        </button>
        <span className="text-[12px] text-[var(--text-muted)] w-11 text-center whitespace-nowrap">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => changeZoom(0.9)}
          className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="缩小"
        >
          <ZoomOut size={15} />
        </button>
        <button
          onClick={handleFitWidth}
          className={`p-1 rounded transition-colors ${fitWidth ? 'text-[var(--accent)] bg-[var(--bg-hover)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
          title="适合宽度"
        >
          <Maximize size={15} />
        </button>
      </div>

      {/* Page viewport */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-[var(--bg-tertiary)]/40"
        onWheel={handleWheel}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="border-2 border-[var(--border-color)] border-t-[#007acc] rounded-full w-6 h-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--danger)] gap-2 px-6">
            <AlertTriangle size={36} className="opacity-60" />
            <p className="text-[13px]">PDF 加载失败</p>
            <p className="text-[11px] text-[var(--text-muted)] break-all text-center">{error}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4 px-4 min-h-full">
            <canvas ref={canvasRef} className="shadow-lg bg-white" />
            <div className="text-[11px] text-[var(--text-muted)] pb-2">第 {pageNum} / {numPages} 页</div>
          </div>
        )}
      </div>
    </div>
  )
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
