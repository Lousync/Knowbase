import { useState, useEffect, useCallback } from 'react'
import type { TabName } from './types'
import { TitleBar, ActivityBar, StatusBar } from './components/shared'
import { getSetting, getAllSettings, setSetting } from './lib/ipc'
import { FONT_CSS_MAP } from './lib/settings'
import { BlogModule } from './modules/blog'
import { ScheduleModule } from './modules/schedule'
import { KnowledgeModule } from './modules/knowledge'
import { ExportModule } from './modules/export'
import { RecycleBinModule } from './modules/recycle'
import { ImportModal } from './modules/shared/components/ImportModal'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('blog')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [zoom, setZoom] = useState(1.0)
  const [encoding, setEncoding] = useState('UTF-8')
  // 从 settings 加载的约束（用于 zoomIn/zoomOut 闭包）
  const [zoomMin, setZoomMin] = useState(0.85)
  const [zoomMax, setZoomMax] = useState(1.5)
  const [zoomStep, setZoomStep] = useState(0.05)
  // Pre-load all sidebar widths to prevent mount-time layout shift
  const [sidebarWidths, setSidebarWidths] = useState<Record<string, number>>({})
  const [importModalOpen, setImportModalOpen] = useState(false)

  useEffect(() => {
    getAllSettings().then(s => {
      setShowLineNumbers(s.showLineNumbers)
      setZoomMin(s.zoomMin); setZoomMax(s.zoomMax); setZoomStep(s.zoomStep)
      setZoom(Math.min(s.zoomMax, Math.max(s.zoomMin, s.zoom)))
      if (s.theme === 'light') document.documentElement.classList.add('light')
      if (FONT_CSS_MAP[s.editorFont]) document.documentElement.style.setProperty('--font-sans', FONT_CSS_MAP[s.editorFont])
      setEncoding(s.exportEncoding.toUpperCase())
      setSidebarWidths({
        sidebarWidth_blog: s.sidebarWidth_blog,
        sidebarWidth_schedule: s.sidebarWidth_schedule,
        sidebarWidth_knowledgeCat: s.sidebarWidth_knowledgeCat,
        sidebarWidth_knowledgePages: s.sidebarWidth_knowledgePages,
      })
      setSettingsLoaded(true)
    })
  }, [])

  // Listen for encoding changes from settings
  useEffect(() => {
    const handler = (e: Event) => {
      const v = (e as CustomEvent).detail
      if (typeof v === 'string') setEncoding(v.toUpperCase())
    }
    window.addEventListener('settings-encoding-changed', handler)
    return () => window.removeEventListener('settings-encoding-changed', handler)
  }, [])

  // Listen for import modal open
  useEffect(() => {
    const handler = () => setImportModalOpen(true)
    window.addEventListener('open-import-modal', handler)
    return () => window.removeEventListener('open-import-modal', handler)
  }, [])

  // Keep <html> font-size in sync — the one true zoom for rem-based layouts
  useEffect(() => {
    document.documentElement.style.fontSize = `${zoom * 16}px`
    return () => { document.documentElement.style.fontSize = '' }
  }, [zoom])

  // Blue-outline workaround: Chromium draws a compositor-level dashed outline
  // around whichever element calls preventDefault() during dragover.  CSS and
  // inline styles cannot suppress it.  The fix: call preventDefault() exactly
  // once — on document.body in the CAPTURE phase — so the outline appears
  // around the body (viewport edges, invisible).  Individual containers only
  // set dropEffect; they must NOT call preventDefault() on dragover.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onDragStart = () => {
      document.body.classList.add('dragging')
    }
    const onDragEnd = () => {
      document.body.classList.remove('dragging')
    }
    document.addEventListener('dragover', onDragOver, true) // capture phase
    document.addEventListener('dragstart', onDragStart)
    document.addEventListener('dragend', onDragEnd)
    document.addEventListener('drop', onDragEnd)
    return () => {
      document.body.classList.remove('dragging')
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('dragend', onDragEnd)
      document.removeEventListener('drop', onDragEnd)
    }
  }, [])

  const toggleLineNumbers = useCallback(() => {
    const next = !showLineNumbers; setShowLineNumbers(next); setSetting('showLineNumbers', next)
  }, [showLineNumbers])

  const zoomIn  = useCallback(() => setZoom(p => { const n = Math.min(zoomMax, +(p + zoomStep).toFixed(2)); setSetting('zoom', n); return n }), [zoomMax, zoomStep])
  const zoomOut = useCallback(() => setZoom(p => { const n = Math.max(zoomMin, +(p - zoomStep).toFixed(2)); setSetting('zoom', n); return n }), [zoomMin, zoomStep])
  const zoomReset = useCallback(() => { setZoom(1.0); setSetting('zoom', 1.0) }, [])

  const handleTabChange = (tab: TabName) => {
    if (tab === activeTab) setSidebarOpen(v => !v)
    else { setActiveTab(tab); setSidebarOpen(true); window.dispatchEvent(new CustomEvent('tab-switched')) }
  }

  // Ctrl+= / Ctrl+-  zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); zoomIn() }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); zoomOut() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomIn, zoomOut])

  if (!settingsLoaded) return null

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <ActivityBar active={activeTab} onChange={handleTabChange} />
        <main className="flex-1 overflow-hidden bg-[var(--bg-primary)]">
          {activeTab === 'blog' && <BlogModule showLineNumbers={showLineNumbers} sidebarOpen={sidebarOpen} zoom={zoom} sidebarWidths={sidebarWidths} />}
          {activeTab === 'schedule' && <ScheduleModule sidebarOpen={sidebarOpen} sidebarWidths={sidebarWidths} />}
          {activeTab === 'knowledge' && <KnowledgeModule sidebarOpen={sidebarOpen} zoom={zoom} sidebarWidths={sidebarWidths} />}
          {activeTab === 'export' && <ExportModule />}
          {activeTab === 'recycle' && <RecycleBinModule />}
        </main>
      </div>
      <StatusBar encoding={encoding} />
      {importModalOpen && <ImportModal onClose={() => setImportModalOpen(false)} />}
    </div>
  )
}
