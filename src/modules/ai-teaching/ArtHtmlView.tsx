import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { workspaceGetCurrent, workspaceReadFile } from '../../lib/ipc'
import { collectThemeVars, injectCspShell } from './htmlShell'

/**
 * 工件栏 HTML 页签（docs/ai-teaching-artifacts-pane-design.md §4.2-§4.4）：
 * 读磁盘全文（workspaceReadFile，与 md 页签同一条 IPC）→ srcDoc 沙箱 iframe。
 * 安全红线：sandbox="allow-scripts" 绝不加 allow-same-origin；CSP/主题/高度上报经 injectCspShell 注入。
 * reloadSeq 自增 = ⟳ 刷新（重读文件重挂）；key 绑定 rel+内容 mtime，内容未变不重挂。
 */
export function ArtHtmlView({ relPath, reloadSeq }: { relPath: string; reloadSeq: number }) {
  const [doc, setDoc] = useState<{ content: string; mtimeMs: number } | null>(null)
  const [readErr, setReadErr] = useState('')
  const [frameErr, setFrameErr] = useState('')
  const [showSrc, setShowSrc] = useState(false)
  const [height, setHeight] = useState(420)
  const [themeTick, setThemeTick] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)

  // 明暗主题切换 → 重算 srcDoc（图随主题走，§4.4）
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick(t => t + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => mo.disconnect()
  }, [])

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

  // 宿主消息：仅采信本 iframe 源（§4.3 劫持防护）；高度钳制 [120,4000]
  const onMsg = useCallback((e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null
    if (!d || e.source !== frameRef.current?.contentWindow) return
    if (typeof d.__kbArtH === 'number' && Number.isFinite(d.__kbArtH)) setHeight(Math.max(120, Math.min(4000, d.__kbArtH)))
    else if (typeof d.__kbArtErr === 'string') setFrameErr(d.__kbArtErr)
  }, [])
  useEffect(() => {
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onMsg])

  const srcDoc = useMemo(() => (doc ? injectCspShell(doc.content, collectThemeVars()) : ''), [doc, themeTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (doc ? doc.content.replace(/\r\n/g, '\n').split('\n').length : 0), [doc])

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
    <div className="h-full overflow-y-auto min-h-0">
      {lines > 150 && (
        <div className="sticky top-0 z-10 px-3 py-1.5 bg-[var(--warning-bg)] border-b border-[var(--warning)]/30 text-[11px] text-[var(--warning)]">
          ⚠ 共 {lines} 行，超出产物约束（≤150 行），渲染可能不佳
        </div>
      )}
      {frameErr && !showSrc ? (
        <div className="m-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-6 text-center">
          <div className="text-[12.5px] text-[var(--text-primary)]">示意图脚本运行出错</div>
          <div className="mt-1 text-[11px] text-[var(--text-muted)] break-all">{frameErr}</div>
          <button onClick={() => setShowSrc(true)} className="mt-3 px-2.5 py-1 rounded-md border border-[var(--border-color)] text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">查看源码</button>
        </div>
      ) : (
        <div className="px-3 py-3">
          {showSrc ? (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10.5px] text-[var(--text-muted)]">HTML 源码（只读）</span>
                <button onClick={() => setShowSrc(false)} className="ml-auto text-[10.5px] px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">← 返回渲染</button>
              </div>
              <pre className="whitespace-pre-wrap break-all rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)] font-[var(--font-mono,var(--font-family))]">{doc.content}</pre>
            </div>
          ) : (
            <iframe
              ref={frameRef}
              key={`${relPath}:${doc.mtimeMs}:${reloadSeq}`}
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title={relPath}
              style={{ width: '100%', height, border: '1px solid var(--border-color)', borderRadius: 10, background: '#fff' }}
            />
          )}
        </div>
      )}
    </div>
  )
}
