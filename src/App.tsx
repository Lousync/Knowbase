import { useState, useEffect, useCallback, useRef } from 'react'
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
import { ToolboxModule } from './modules/toolbox'
import { PomodoroProvider } from './modules/toolbox/hooks/PomodoroContext'
import { PomodoroPanel } from './modules/toolbox/components/PomodoroPanel'
import { LockScreen } from './components/shared/LockScreen'
import { ImportModal } from './modules/shared/components/ImportModal'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('blog')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [encoding, setEncoding] = useState('UTF-8')
  const [sidebarWidths, setSidebarWidths] = useState<Record<string, number>>({})
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [locked, setLocked] = useState(false)
  const { s, update } = useSettings()

  // Set startup tab from settings (fires once with defaults, then again with persisted values)
  useEffect(() => {
    try {
      const hidden: string[] = JSON.parse(s.activityBarHidden || '[]')
      const all = ['blog','schedule','knowledge','toolbox','export','recycle','help'] as const
      if (all.includes(s.startupTab as any) && !hidden.includes(s.startupTab)) {
        setActiveTab(s.startupTab as TabName)
        return
      }
      const order: string[] = JSON.parse(s.activityBarOrder || '[]')
      for (const id of order) {
        if (all.includes(id as any) && !hidden.includes(id)) { setActiveTab(id as TabName); return }
      }
      for (const id of all) {
        if (!hidden.includes(id)) { setActiveTab(id as TabName); return }
      }
    } catch {}
  }, [s.startupTab, s.activityBarOrder, s.activityBarHidden])

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

  // Auto-lock on startup (once, after settings load)
  const startupLockedRef = useRef(false)
  useEffect(() => {
    if (!startupLockedRef.current && s.lockOnStartup && s.lockPassword) {
      startupLockedRef.current = true
      setLocked(true)
    }
  }, [s.lockOnStartup, s.lockPassword])

  // Listen for import modal open
  useEffect(() => {
    const handler = () => setImportModalOpen(true)
    window.addEventListener('open-import-modal', handler)
    return () => window.removeEventListener('open-import-modal', handler)
  }, [])

  // Listen for lockscreen toggle
  useEffect(() => {
    const handler = () => setLocked(v => !v)
    window.addEventListener('lockscreen:toggle', handler)
    return () => window.removeEventListener('lockscreen:toggle', handler)
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
      <PomodoroProvider>
        <div className="flex flex-1 overflow-hidden">
          <ActivityBar active={activeTab} onChange={handleTabChange} />
          <main className="flex-1 overflow-hidden bg-[var(--bg-primary)] relative">
            {activeTab === 'blog' && <BlogModule showLineNumbers={s.showLineNumbers} sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} />}
            {activeTab === 'schedule' && <ScheduleModule sidebarOpen={sidebarOpen} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} />}
            {activeTab === 'knowledge' && <KnowledgeModule sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} />}
            {activeTab === 'export' && <ExportModule />}
            {activeTab === 'recycle' && <RecycleBinModule />}
            {activeTab === 'settings' && <SettingsModule />}
            {activeTab === 'toolbox' && <ToolboxModule />}
            {activeTab === 'help' && <HelpModule />}
            {activeTab === 'user' && <UserModule />}
            <PomodoroPanel />
          </main>
        </div>
        <StatusBar encoding={encoding} />
      </PomodoroProvider>
      <Toast />
      <LockScreen locked={locked} onUnlock={() => setLocked(false)} />
      {importModalOpen && <ImportModal onClose={() => setImportModalOpen(false)} />}
    </div>
  )
}
