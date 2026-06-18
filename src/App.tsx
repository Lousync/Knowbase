import { useState, useEffect, useCallback } from 'react'
import type { TabName } from './types'
import { TitleBar, ActivityBar, StatusBar } from './components/shared'
import { Toast } from './components/shared/Toast'
import { FONT_CSS_MAP, applyThemeClass } from './lib/settings'
import { useSettings } from './lib/SettingsContext'
import { isEditingInput } from './lib/shortcuts'
import { BlogModule } from './modules/blog'
import { ScheduleModule } from './modules/schedule'
import { KnowledgeModule } from './modules/knowledge'
import { ExportModule } from './modules/export'
import { RecycleBinModule } from './modules/recycle'
import { SettingsModule } from './modules/settings'
import { HelpModule } from './modules/help'
import { UserModule } from './modules/user'
import { ImportModal } from './modules/shared/components/ImportModal'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('blog')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [encoding, setEncoding] = useState('UTF-8')
  const [sidebarWidths, setSidebarWidths] = useState<Record<string, number>>({})
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const { s, update } = useSettings()

  // Apply theme class to <html> — reacts to async loaded settings (fixes stale-default bug)
  useEffect(() => { applyThemeClass(s.theme) }, [s.theme])

  // Apply persisted settings on first render
  useEffect(() => {
    if (FONT_CSS_MAP[s.editorFont]) document.documentElement.style.setProperty('--font-sans', FONT_CSS_MAP[s.editorFont])
    setEncoding(s.exportEncoding.toUpperCase())
    setSidebarWidths({
      sidebarWidth_blog: s.sidebarWidth_blog,
      sidebarWidth_schedule: s.sidebarWidth_schedule,
      sidebarWidth_knowledgeCat: s.sidebarWidth_knowledgeCat,
      sidebarWidth_knowledgePages: s.sidebarWidth_knowledgePages,
    })
    document.documentElement.style.fontSize = `${Math.min(s.zoomMax, Math.max(s.zoomMin, s.zoom)) * 16}px`
    setLoaded(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Listen for settings:open — navigate to settings tab
  useEffect(() => {
    const handler = () => { setActiveTab('settings'); setSidebarOpen(true) }
    window.addEventListener('settings:open', handler)
    return () => window.removeEventListener('settings:open', handler)
  }, [])

  // Listen for help:open — navigate to help tab
  useEffect(() => {
    const handler = () => { setActiveTab('help'); setSidebarOpen(true) }
    window.addEventListener('help:open', handler)
    return () => window.removeEventListener('help:open', handler)
  }, [])

  // Keep <html> font-size in sync when zoom changes externally
  useEffect(() => {
    document.documentElement.style.fontSize = `${s.zoom * 16}px`
  }, [s.zoom])

  // Blue-outline drag workaround
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDragStart = () => { document.body.classList.add('dragging') }
    const onDragEnd = () => { document.body.classList.remove('dragging') }
    document.addEventListener('dragover', onDragOver, true)
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

  const handleTabChange = (tab: TabName) => {
    if (tab === activeTab) setSidebarOpen(v => !v)
    else { setActiveTab(tab); setSidebarOpen(true); window.dispatchEvent(new CustomEvent('tab-switched')) }
  }

  // Ctrl+= / Ctrl+- zoom — synced with settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault()
        const n = Math.min(s.zoomMax, +(s.zoom + s.zoomStep).toFixed(2))
        update('zoom', n)
      }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        const n = Math.max(s.zoomMin, +(s.zoom - s.zoomStep).toFixed(2))
        update('zoom', n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.zoom, s.zoomMin, s.zoomMax, s.zoomStep, update])

  // Ctrl+B — toggle sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditingInput(e)) return
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault()
        setSidebarOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded) return null

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <ActivityBar active={activeTab} onChange={handleTabChange} />
        <main className="flex-1 overflow-hidden bg-[var(--bg-primary)]">
          {activeTab === 'blog' && <BlogModule showLineNumbers={s.showLineNumbers} sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} />}
          {activeTab === 'schedule' && <ScheduleModule sidebarOpen={sidebarOpen} sidebarWidths={sidebarWidths} />}
          {activeTab === 'knowledge' && <KnowledgeModule sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} />}
          {activeTab === 'export' && <ExportModule />}
          {activeTab === 'recycle' && <RecycleBinModule />}
          {activeTab === 'settings' && <SettingsModule />}
          {activeTab === 'help' && <HelpModule />}
          {activeTab === 'user' && <UserModule />}
        </main>
      </div>
      <StatusBar encoding={encoding} />
      <Toast />
      {importModalOpen && <ImportModal onClose={() => setImportModalOpen(false)} />}
    </div>
  )
}
