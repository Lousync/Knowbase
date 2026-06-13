import { useState, useEffect, useCallback } from 'react'
import type { TabName } from './types'
import { TitleBar, ActivityBar } from './components/shared'
import { getSetting, setSetting } from './lib/ipc'
import { BlogModule } from './modules/blog'
import { ScheduleModule } from './modules/schedule'
import { KnowledgeModule } from './modules/knowledge'
import { ExportModule } from './modules/export'

// Zoom by adjusting <html> font-size.  All rem-based content scales naturally;
// chrome elements (TitleBar / ActivityBar) are mostly px-based so
// they barely move.  CSS zoom / transform:scale() both break flex layout — avoid.
const ZOOM_MIN  = 0.85
const ZOOM_MAX  = 1.5
const ZOOM_STEP = 0.05
const ZOOM_BASE = 1.0

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('blog')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [zoom, setZoom] = useState(ZOOM_BASE)

  useEffect(() => {
    Promise.all([getSetting('showLineNumbers'), getSetting('zoom')])
      .then(([ln, z]) => {
        if (ln != null) setShowLineNumbers(ln as boolean)
        if (z != null && typeof z === 'number') {
          setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)))
        }
      })
      .finally(() => setSettingsLoaded(true))
  }, [])

  // Keep <html> font-size in sync — the one true zoom for rem-based layouts
  useEffect(() => {
    document.documentElement.style.fontSize = `${zoom * 16}px`
    return () => { document.documentElement.style.fontSize = '' }
  }, [zoom])

  const toggleLineNumbers = useCallback(() => {
    const next = !showLineNumbers; setShowLineNumbers(next); setSetting('showLineNumbers', next)
  }, [showLineNumbers])

  const zoomIn  = useCallback(() => setZoom(p => { const n = Math.min(ZOOM_MAX, +(p + ZOOM_STEP).toFixed(2)); setSetting('zoom', n); return n }), [])
  const zoomOut = useCallback(() => setZoom(p => { const n = Math.max(ZOOM_MIN, +(p - ZOOM_STEP).toFixed(2)); setSetting('zoom', n); return n }), [])
  const zoomReset = useCallback(() => { setZoom(ZOOM_BASE); setSetting('zoom', ZOOM_BASE) }, [])

  const handleTabChange = (tab: TabName) => {
    if (tab === activeTab) setSidebarOpen(v => !v)
    else { setActiveTab(tab); setSidebarOpen(true) }
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
    <div className="flex flex-col h-screen bg-[#1e1e1e] overflow-hidden">
      <TitleBar showLineNumbers={showLineNumbers} onToggleLineNumbers={toggleLineNumbers} zoomReset={zoomReset} />
      <div className="flex flex-1 overflow-hidden">
        <ActivityBar active={activeTab} onChange={handleTabChange} />
        <main className="flex-1 overflow-hidden bg-[#1e1e1e]">
          {activeTab === 'blog' && <BlogModule showLineNumbers={showLineNumbers} sidebarOpen={sidebarOpen} />}
          {activeTab === 'schedule' && <ScheduleModule sidebarOpen={sidebarOpen} />}
          {activeTab === 'knowledge' && <KnowledgeModule sidebarOpen={sidebarOpen} />}
          {activeTab === 'export' && <ExportModule />}
        </main>
      </div>
    </div>
  )
}
