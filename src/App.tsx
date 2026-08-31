import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import type { TabName } from './types'
import { TitleBar, ActivityBar, StatusBar } from './components/shared'
import { Toast } from './components/shared/Toast'
import { FONT_CSS_MAP, applyThemeClass } from './lib/settings'
import { useSettings } from './lib/SettingsContext'
import { isEditingInput } from './lib/shortcuts'
import { setGlobalActiveTab } from './lib/activeTab'
import { BlogModule } from './modules/blog'
import { ScheduleModule } from './modules/schedule'
import { KnowledgeModule } from './modules/knowledge'
import { MomentsModule } from './modules/moments'
import { RecycleBinModule } from './modules/recycle'
import { SettingsModule } from './modules/settings'
import { HelpModule } from './modules/help'
import { UserModule } from './modules/user'
import { ToolboxModule } from './modules/toolbox'
import { PluginsModule } from './modules/plugins'
import { FillPopup } from './modules/toolbox/components/FillPopup'
import { PomodoroProvider } from './modules/toolbox/hooks/PomodoroContext'
import { PomodoroPanel } from './modules/toolbox/components/PomodoroPanel'
import { LockScreen } from './components/shared/LockScreen'
import { Onboarding } from './components/shared/Onboarding'
import { ImportModal } from './modules/shared/components/ImportModal'
import { useCheckinReminder } from './lib/useCheckinReminder'
import { useHabitAutoCheckinToast } from './lib/useHabitAutoCheckin'
import { AssistantPanel } from './components/shared/AssistantPanel'
import { DayPanelWindowApp } from './daypanel/DayPanelWindowApp'
import { DayPanel } from './daypanel/DayPanel'
import { ResizablePanel } from './components/shared/ResizablePanel'
// 仅类型引用,编译期擦除,不会把 devtools 模块带进正式版 bundle
import type { DevToolsModuleProps } from './modules/devtools'
export default function App() {
  // Fill popup mode: render standalone popup instead of full app
  if (window.api.isFillPopup) {
    return <FillPopup />
  }
  // 日程与打卡小窗：独立 BrowserWindow 加载 #/day-panel（argv 由主进程注入），渲染独立面板
  if (window.api.isDayPanel) {
    return <DayPanelWindowApp />
  }
  const [activeTab, setActiveTab] = useState<TabName>('blog')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [encoding, setEncoding] = useState('UTF-8')
  const [sidebarWidths, setSidebarWidths] = useState<Record<string, number>>({})
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importBackupPath, setImportBackupPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [locked, setLocked] = useState(false)
  // 日程打卡侧边栏（WeChat 模式）：内嵌/脱离状态由 React + 主进程共同管理
  const [dayPanelVisible, setDayPanelVisible] = useState(false)
  const [dayPanelDetached, setDayPanelDetached] = useState(false)
  // 窗口宽度：任务栏最大宽度与窗口联动（窄窗口自动收窄，主体不被压扁）
  const [winWidth, setWinWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const dayPanelMaxWidth = Math.max(300, Math.min(500, Math.floor(winWidth * 0.4)))
  const { s, update, ready: settingsReady } = useSettings()
  useCheckinReminder()
  useHabitAutoCheckinToast()
  const mountedTabs = useRef<Set<TabName>>(new Set(['blog']))  // keep modules alive after first visit

  // Set startup tab from settings — only on initial load, NOT on subsequent setting changes
  useEffect(() => {
    if (!settingsReady || !loaded) return
    try {
      const hidden: string[] = JSON.parse(s.activityBarHidden || '[]')
      const all = ['blog','schedule','knowledge','moments','toolbox','plugins','recycle','help'] as const
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, loaded])

  // Apply theme class to <html> — reacts to async loaded settings (fixes stale-default bug)
  // 插件主题:先确保 <style> 已注入,再应用主题类(插件主题依赖运行时注入的 CSS 变量)
  // 历史值归一化:旧版可能存了带 "." 的插件主题 id(点号会破坏 CSS 类选择器)
  useEffect(() => {
    const raw = s.theme
    const theme = raw.replace(/[^a-zA-Z0-9_-]/g, '-')
    if (theme !== raw) update('theme', theme)
    if (theme.startsWith('plugin-')) {
      import('./lib/pluginService').then(m => m.ensurePluginThemeStyles()).then(() => applyThemeClass(theme)).catch(() => applyThemeClass(theme))
    } else {
      applyThemeClass(theme)
    }
  }, [s.theme, settingsReady, update])

  // Apply persisted settings on first render — 必须等真实设置加载完成,否则会用默认值覆盖一次
  useEffect(() => {
    if (!settingsReady) return
    if (FONT_CSS_MAP[s.editorFont]) document.documentElement.style.setProperty('--font-sans', FONT_CSS_MAP[s.editorFont])
    setEncoding(s.exportEncoding.toUpperCase())
    setSidebarWidths({
      sidebarWidth_blog: s.sidebarWidth_blog,
      sidebarWidth_schedule: s.sidebarWidth_schedule,
      sidebarWidth_knowledgeCat: s.sidebarWidth_knowledgeCat,
      sidebarWidth_knowledgePages: s.sidebarWidth_knowledgePages,
      sidebarWidth_devtools: s.sidebarWidth_devtools,
    })
    document.documentElement.style.fontSize = `${Math.min(s.zoomMax, Math.max(s.zoomMin, s.zoom)) * 16}px`
    setLoaded(true)
  }, [settingsReady]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const handler = () => { setImportBackupPath(null); setImportModalOpen(true) }
    window.addEventListener('open-import-modal', handler)
    return () => window.removeEventListener('open-import-modal', handler)
  }, [])

  // Drag a backup zip anywhere onto the window → auto-open import and restore it
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      const zip = Array.from(files).find(f => /\.zip$/i.test(f.name))
      if (!zip) return
      e.preventDefault()
      e.stopPropagation()
      try {
        const p = window.api.getPathForFile(zip)
        if (p) {
          setImportBackupPath(p)
          setImportModalOpen(true)
        }
      } catch { /* ignore */ }
    }
    document.addEventListener('drop', onDrop, true)
    return () => document.removeEventListener('drop', onDrop, true)
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

  // Listen for knowledge:open — navigate to knowledge tab(插件导入完成后「去知识库查看」)
  useEffect(() => {
    const handler = () => { setActiveTab('knowledge'); setSidebarOpen(true) }
    window.addEventListener('knowledge:open', handler)
    return () => window.removeEventListener('knowledge:open', handler)
  }, [])

  // Listen for help:open — navigate to help tab(入口:设置弹出菜单/Toast 深链)
  useEffect(() => {
    const handler = () => { setActiveTab('help'); setSidebarOpen(true) }
    window.addEventListener('help:open', handler)
    return () => window.removeEventListener('help:open', handler)
  }, [])

  // Listen for plugins:open — navigate to plugins tab (e.g. 设置→AI 工具→Skill 跳市场)
  useEffect(() => {
    const handler = () => { setActiveTab('plugins'); setSidebarOpen(true) }
    window.addEventListener('plugins:open', handler)
    return () => window.removeEventListener('plugins:open', handler)
  }, [])

  // 接收小窗指令：日程与打卡小窗「打开任务模块/完整配置」→ 切换主窗口 Tab
  useEffect(() => {
    const off = window.api?.onMainCommand?.((p) => {
      if (p?.type === 'switch-tab' && typeof p.tab === 'string') {
        const all: string[] = ['blog', 'schedule', 'knowledge', 'moments', 'toolbox', 'plugins', 'recycle', 'help', 'settings', 'user']
        if (all.includes(p.tab)) { setActiveTab(p.tab as TabName); setSidebarOpen(true) }
      }
    })
    return () => { off?.() }
  }, [])

  // 日程打卡侧边栏：脱离态变化推送（独立窗口打开/销毁）
  useEffect(() => {
    const off = window.api?.onDayPanelStateChanged?.(({ detached }) => {
      setDayPanelDetached(detached)
      // 脱离→内嵌（独立窗口被关）：自动恢复内嵌显示，避免用户看到一个"消失的面板"
      if (!detached) setDayPanelVisible(true)
    })
    return () => { off?.() }
  }, [])
  // 全局快捷键 Ctrl+Alt+S toggle：脱离态→吸附 + 显示内嵌；否则切内嵌可见性
  useEffect(() => {
    const off = window.api?.onDayPanelToggleVisibility?.(() => { setDayPanelVisible(v => !v) })
    return () => { off?.() }
  }, [])

  // 开发者工具 — 仅 DEV 动态加载:打包构建时 import.meta.env.DEV 被静态替换为 false,
  // 动态 import 随之被 tree-shaking 移除,devtools 模块代码不进入产物
  const [DevToolsModuleDynamic, setDevtoolsNode] = useState<React.ComponentType<DevToolsModuleProps> | null>(null)
  useEffect(() => {
    if (import.meta.env.DEV) {
      import('./modules/devtools').then(m => setDevtoolsNode(() => m.DevToolsModule))
      // AI 测试桥:安装渲染层日志采集(console / error / rejection → 主进程)
      import('./devbridge/collector').then(m => m.installRendererCollector()).catch(() => { /* 桥未启用 */ })
    }
  }, [])

  // AI 测试桥:上报当前激活模块,使 GET /state 能反映真实路由
  useEffect(() => {
    if (!import.meta.env.DEV) return
    import('./devbridge/collector')
      .then(m => m.reportUiState({ activeModule: activeTab }))
      .catch(() => { /* 桥未启用 */ })
  }, [activeTab])

  // First-run onboarding — show once after load & unlock; re-openable from settings
  // 依赖 settingsReady:等真实设置到位后再判断,避免默认值 onboardingDone:false 造成的竞态弹出
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  useEffect(() => {
    if (settingsReady && loaded && !locked && !s.onboardingDone) setOnboardingOpen(true)
  }, [settingsReady, loaded, locked, s.onboardingDone])
  useEffect(() => {
    const handler = () => setOnboardingOpen(true)
    window.addEventListener('onboarding:show', handler)
    return () => window.removeEventListener('onboarding:show', handler)
  }, [])

  // Keep <html> font-size in sync when zoom changes externally
  useEffect(() => {
    document.documentElement.style.fontSize = `${s.zoom * 16}px`
  }, [s.zoom])

  // Sync active tab for module-level shortcut guards (hidden modules stay mounted)
  useEffect(() => { setGlobalActiveTab(activeTab) }, [activeTab])

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

  // 日程打卡侧边栏：标题栏按钮 + Ctrl+Alt+S 统一入口
  // - 脱离态 → 吸附回来（关独立窗口 + 显示内嵌）
  // - 内嵌态 → 切可见性
  const toggleDayPanel = useCallback(() => {
    if (dayPanelDetached) {
      void window.api?.dayPanelDockBack?.()
      setDayPanelVisible(true)
    } else {
      setDayPanelVisible(v => !v)
    }
  }, [dayPanelDetached])

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

  function renderTab(name: TabName, children: React.ReactNode) {
    if (activeTab === name) {
      mountedTabs.current.add(name)
      return <div key={name} className="flex-1 min-h-0">{children}</div>
    }
    if (mountedTabs.current.has(name)) {
      return <div key={name} className="flex-1 min-h-0" style={{ display: 'none' }}>{children}</div>
    }
    return null
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] overflow-hidden">
      <TitleBar dayPanelActive={dayPanelVisible || dayPanelDetached} onToggleDayPanel={toggleDayPanel} />
      <PomodoroProvider>
        <div className="flex flex-1 overflow-hidden">
          <ActivityBar active={activeTab} onChange={handleTabChange} />
<main className="flex-1 flex overflow-hidden bg-[var(--bg-primary)] relative">
            {/* 主内容区卡片壳：与左右两侧(ActivityBar / 日程打卡面板)同款圆角+阴影+留白，三卡对称 */}
            <div className="m-1.5 flex min-w-0 flex-1">
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-[0_6px_24px_rgba(0,0,0,0.16)]">
              {renderTab('blog', <BlogModule showLineNumbers={s.showLineNumbers} sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} />)}
              {renderTab('schedule', <ScheduleModule sidebarOpen={sidebarOpen} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} />)}
              {renderTab('knowledge', <KnowledgeModule sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} isActive={activeTab === 'knowledge'} />)}
{renderTab('moments', <MomentsModule />)}
{renderTab('recycle', <RecycleBinModule isActive={activeTab === 'recycle'} />)}
              {renderTab('settings', <SettingsModule />)}
              {renderTab('toolbox', <ToolboxModule />)}
              {renderTab('plugins', <PluginsModule />)}
              {renderTab('help', <HelpModule />)}
              {DevToolsModuleDynamic && renderTab('devtools', <DevToolsModuleDynamic sidebarOpen={sidebarOpen} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} />)}
              {renderTab('user', <UserModule />)}
              {/* AI 助手入口：归属主体卡片，任务栏展开/收起不影响其相对位置 */}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('ai-assistant:toggle'))}
                title="AI 助手 (Ctrl+J)"
                className="absolute bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg transition-opacity hover:opacity-90"
              >
                <Sparkles size={19} />
              </button>
              </div>
            </div>
            {dayPanelVisible && !dayPanelDetached && (
              <ResizablePanel
                storageKey="dayPanelEmbedded"
                defaultWidth={300}
                minWidth={240}
                maxWidth={dayPanelMaxWidth}
                side="right"
                visible
                showHandle
              >
                {/* 内嵌面板的"子窗口"外壳：留白 + 圆角 + 阴影，让它在主窗口内像独立浮窗（微信会议窗同款） */}
                <div className="m-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[0_6px_24px_rgba(0,0,0,0.16)]">
                  <DayPanel
                    mode="embedded"
                    onPopout={() => { void window.api?.dayPanelPopout?.() }}
                    onClose={() => setDayPanelVisible(false)}
                  />
                </div>
              </ResizablePanel>
            )}
            <PomodoroPanel />
          </main>
      {/* 全局 AI 助手侧栏 */}
      <AssistantPanel />
        </div>
        <StatusBar encoding={encoding} />
      </PomodoroProvider>
      <Toast />
      {onboardingOpen && !locked && (
        <Onboarding
          onComplete={() => { update('onboardingDone', true); setOnboardingOpen(false) }}
          onSwitchTab={tab => setActiveTab(tab)}
        />
      )}
      <LockScreen locked={locked} onUnlock={() => setLocked(false)} />
      {importModalOpen && <ImportModal onClose={() => setImportModalOpen(false)} initialBackupPath={importBackupPath} />}
    </div>
  )
}
