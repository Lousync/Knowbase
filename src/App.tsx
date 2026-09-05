import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import type { TabName } from './types'

/** 模块清单（打开命令 / 分屏副栏选择共用；devtools 为 dev-only 不列入口） */
const MODULE_TABS: Array<{ id: TabName; label: string }> = [
  { id: 'editor', label: '编辑器' },
  { id: 'knowledge', label: '知识库' },
  { id: 'blog', label: '博客' },
  { id: 'schedule', label: '日程' },
  { id: 'moments', label: '说说' },
  { id: 'recycle', label: '回收站' },
  { id: 'settings', label: '设置' },
  { id: 'toolbox', label: '工具箱' },
  { id: 'plugins', label: '插件' },
  { id: 'help', label: '帮助' },
  { id: 'user', label: '账户' },
]
const tabLabel = (t: TabName) => MODULE_TABS.find((m) => m.id === t)?.label ?? t
import { TitleBar, ActivityBar } from './components/shared'
import { WorkbenchStatusBar } from './components/shared/WorkbenchStatusBar'
import { GlobalSearchPanel } from './components/shared/GlobalSearchPanel'
import { CommandPalette, type PaletteItem } from './components/shared/CommandPalette'
import { SplitPaneBar } from './components/shared/SplitPaneBar'
import { CodePluginHosts } from './components/shared/CodePluginHosts'
import { Toast } from './components/shared/Toast'
import { FONT_CSS_MAP, applyThemeClass } from './lib/settings'
import { useSettings } from './lib/SettingsContext'
import { isEditingInput } from './lib/shortcuts'
import { setGlobalActiveTab } from './lib/activeTab'
import { getKnowledgePages } from './lib/ipc'
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
import { EditorModule } from './modules/editor'
import { ImModule } from './modules/immersive'
import { FillPopup } from './modules/toolbox/components/FillPopup'
import { WelcomeOverlay } from './components/shared/WelcomeOverlay'
import { PomodoroProvider } from './modules/toolbox/hooks/PomodoroContext'
import { PomodoroPanel } from './modules/toolbox/components/PomodoroPanel'
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
  const [sidebarWidths, setSidebarWidths] = useState<Record<string, number>>({})
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importBackupPath, setImportBackupPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // 首次引导：无「当前仓库」时全屏选择页（对标 Obsidian 打开 vault）
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [welcomeChecked, setWelcomeChecked] = useState(false)
  // 日程打卡侧边栏（WeChat 模式）：内嵌/脱离状态由 React + 主进程共同管理
  const [dayPanelVisible, setDayPanelVisible] = useState(false)
  const [dayPanelDetached, setDayPanelDetached] = useState(false)
  // Workbench 外壳（R1-W1）：全局侧栏容器节点（EditorModule 文件树 portal 目标），
  // 以 state 持有保证 portal 目标出现后触发重渲染；非 workbench 布局保持 null。
  // ref 回调用 useCallback 稳定引用：React 卸载节点时才以 null 调用，避免内联箭头每帧触发 setState
  const [wbSidebarEl, setWbSidebarEl] = useState<HTMLElement | null>(null)
  const wbSidebarRef = useCallback((node: HTMLDivElement | null) => {
    setWbSidebarEl(node)
  }, [])
  // 窗口宽度：任务栏最大宽度与窗口联动（窄窗口自动收窄，主体不被压扁）
  const [winWidth, setWinWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const dayPanelMaxWidth = Math.max(300, Math.min(500, Math.floor(winWidth * 0.4)))
  const { s, update, ready: settingsReady } = useSettings()
  const workbench = !!s.uiWorkbench

  // R1-W2：命令面板 / 快速切换器（Ctrl+Shift+P / Ctrl+O），两布局均可用（docs/rework-workbench-design.md §3）
  const [palette, setPalette] = useState<null | 'command' | 'file'>(null)
  const [fileItems, setFileItems] = useState<PaletteItem[]>([])
  const [fileLoading, setFileLoading] = useState(false)
  // 底部面板（全局搜索 v1，仅 Workbench 布局，Ctrl+` 开合）
  const [bottomPanel, setBottomPanel] = useState(false)
  // W3 · Editor Groups v1：副栏模块（两栏互不相同；null = 未分屏）
  const [secondaryTab, setSecondaryTab] = useState<TabName | null>(null)
  useEffect(() => {
    if (!workbench) { setBottomPanel(false); return }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === '`')) {
        e.preventDefault()
        setBottomPanel((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workbench])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        setPalette((p) => (p === 'command' ? null : 'command'))
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        setPalette((p) => (p === 'file' ? null : 'file'))
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 快速切换器数据源：知识页索引（默认 vault 读源带 path → 经 kb-open-in-editor 在编辑器组打开）
  useEffect(() => {
    if (palette !== 'file') return
    let alive = true
    setFileLoading(true)
    getKnowledgePages()
      .then((ps) => {
        if (!alive) return
        setFileItems(
          (ps ?? [])
            .filter((p) => !!p.path)
            .map((p) => ({
              id: p.id,
              label: p.title || (p.path as string),
              hint: p.path ?? undefined,
              group: '知识页',
              run: () => {
                setPalette(null)
                if (p.path) window.dispatchEvent(new CustomEvent('kb-open-in-editor', { detail: { relPath: p.path } }))
              },
            })),
        )
        setFileLoading(false)
      })
      .catch(() => { if (alive) setFileLoading(false) })
    return () => { alive = false }
  }, [palette])

  const openTab = useCallback((tab: TabName) => {
    setActiveTab(tab)
    setSidebarOpen(true)
    setPalette(null)
  }, [])
  const buildCommandItems = (): PaletteItem[] => {
    const tabs: Array<{ id: TabName; label: string; hint?: string }> = [
      { id: 'editor', label: '打开 编辑器', hint: 'Vault 文件' },
      { id: 'knowledge', label: '打开 知识库', hint: '阅读 / 导航' },
      { id: 'blog', label: '打开 博客' },
      { id: 'schedule', label: '打开 日程' },
      { id: 'moments', label: '打开 说说' },
      { id: 'recycle', label: '打开 回收站' },
      { id: 'settings', label: '打开 设置' },
      { id: 'toolbox', label: '打开 工具箱' },
      { id: 'plugins', label: '打开 插件' },
      { id: 'help', label: '打开 帮助' },
      { id: 'user', label: '打开 账户' },
    ]
    const items: PaletteItem[] = tabs.map((t) => ({
      id: `open-${t.id}`,
      label: t.label,
      hint: t.hint,
      group: '打开模块',
      run: () => openTab(t.id),
    }))
    items.push(
      { id: 'toggle-workbench', label: workbench ? '布局：切回 旧布局' : '布局：启用 Workbench 外壳（实验）', group: '界面设置', run: () => { update('uiWorkbench', !workbench); setPalette(null) } },
      { id: 'toggle-readsrc', label: s.storageKnowledge === 'vault' ? '知识库数据：切换到 数据库 sqlite（过渡）' : '知识库数据：切换到 仓库文件 vault（默认）', group: '界面设置', run: () => { update('storageKnowledge', s.storageKnowledge === 'vault' ? 'sqlite' : 'vault'); setPalette(null) } },
      { id: 'toggle-lineno', label: s.showLineNumbers ? '编辑器：隐藏行号' : '编辑器：显示行号', group: '界面设置', run: () => { update('showLineNumbers', !s.showLineNumbers); setPalette(null) } },
    )
    // W3 · 分屏命令（Editor Groups）：开/关副栏 + 选副栏模块（排除当前主栏，避免同模块双实例）
    items.push(
      { id: 'split-toggle', label: secondaryTab ? '分屏：关闭副栏' : '分屏：开启副栏', hint: '两栏独立选模块', group: '分屏', run: () => { setSecondaryTab(secondaryTab ? null : (activeTab === 'knowledge' ? 'editor' : 'knowledge')); setPalette(null) } },
    )
    MODULE_TABS.filter((m) => m.id !== activeTab).forEach((m) => {
      items.push({ id: `split-${m.id}`, label: `分屏：在副栏打开 ${m.label}`, group: '分屏', run: () => { setSecondaryTab(m.id); setPalette(null) } })
    })
    return items
  }

  useCheckinReminder()
  useHabitAutoCheckinToast()
  const mountedTabs = useRef<Set<TabName>>(new Set(['blog']))  // keep modules alive after first visit

  // 启动检测当前仓库：无 → 引导页（在 loaded 后执行一次）
  useEffect(() => {
    if (!loaded || welcomeChecked) return
    let alive = true
    window.api?.workspaceGetCurrent?.()
      .then((cur) => { if (alive) setWelcomeOpen(!cur) })
      .catch(() => { if (alive) setWelcomeOpen(true) })
      .finally(() => { if (alive) setWelcomeChecked(true) })
    return () => { alive = false }
  }, [loaded, welcomeChecked])

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

  // 读写分工：知识库「在编辑器中打开」→ 切到编辑器 Tab 并打开同一文件
  // ISS-2026-09-04-07：跳转改走 App state + props（pendingOpenRel）。
  // 旧实现 = window 事件 + 一次性 window pending：保活层（renderMounted）在切 Tab 时
  // 会重建编辑器实例，旧实例的 listener 消费事件后随实例一起被丢弃，新实例拿不到
  // pending → 永远空态。state+props 不受实例重建影响。
  const [pendingOpenRel, setPendingOpenRel] = useState<string | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const relPath = (e as CustomEvent).detail?.relPath as string | undefined
      if (typeof relPath === 'string' && relPath) {
        setPendingOpenRel(relPath)
      }
      setActiveTab('editor')
    }
    window.addEventListener('kb-open-in-editor', handler)
    return () => window.removeEventListener('kb-open-in-editor', handler)
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
    if (settingsReady && loaded && !s.onboardingDone) setOnboardingOpen(true)
  }, [settingsReady, loaded, s.onboardingDone])
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
    if (tab === activeTab) { setSidebarOpen(v => !v); return }
    // 分屏冲突：目标已在副栏 → 主栏显示它、旧主栏进副栏（避免同模块双实例）
    if (secondaryTab === tab) {
      const old = activeTab
      setActiveTab(tab)
      setSecondaryTab(old)
      setSidebarOpen(true)
      window.dispatchEvent(new CustomEvent('tab-switched'))
      return
    }
    setActiveTab(tab); setSidebarOpen(true); window.dispatchEvent(new CustomEvent('tab-switched'))
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

  /** 模块内容（主栏/副栏共用；on = 该模块当前在屏幕某栏激活） */
  function renderModuleContent(name: TabName, on: boolean): React.ReactNode {
    switch (name) {
      case 'blog': return <BlogModule showLineNumbers={s.showLineNumbers} sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} />
      case 'schedule': return <ScheduleModule sidebarOpen={sidebarOpen} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} />
      case 'knowledge': return <KnowledgeModule sidebarOpen={sidebarOpen} zoom={s.zoom} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} isActive={on} />
      case 'moments': return <MomentsModule />
      case 'editor': return <EditorModule isActive={on} sidebarEl={workbench && on ? wbSidebarEl : null} markdownDim={s.markdownDim} pendingOpenRel={pendingOpenRel} onPendingConsumed={() => setPendingOpenRel(null)} />
      case 'immersive': return <ImModule isActive={on} />
      case 'recycle': return <RecycleBinModule isActive={on} />
      case 'settings': return <SettingsModule />
      case 'toolbox': return <ToolboxModule />
      case 'plugins': return <PluginsModule />
      case 'help': return <HelpModule />
      case 'devtools': return DevToolsModuleDynamic ? <DevToolsModuleDynamic sidebarOpen={sidebarOpen} sidebarWidths={sidebarWidths} onSnapCloseSidebar={() => setSidebarOpen(false)} onSnapOpenSidebar={() => setSidebarOpen(true)} /> : null
      case 'user': return <UserModule />
      default: return null
    }
  }
  /** 槽位级保活挂载：首次出现在任意栏后常驻（display:none 保活），同一模块只在一个栏渲染 */
  function renderMounted(name: TabName, on: boolean) {
    if (on) mountedTabs.current.add(name)
    if (!on && !mountedTabs.current.has(name)) return null
    return <div key={name} className="flex-1 min-h-0" style={on ? undefined : { display: 'none' }}>{renderModuleContent(name, on)}</div>
  }

  return (
    <div className="flex flex-col h-screen bg-[color-mix(in_srgb,var(--bg-primary)_76%,transparent)] overflow-hidden">
      <CodePluginHosts />
      <TitleBar dayPanelActive={dayPanelVisible || dayPanelDetached} onToggleDayPanel={toggleDayPanel} />
      <PomodoroProvider>
        <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <ActivityBar active={activeTab} onChange={handleTabChange} />
<main className="flex-1 flex overflow-hidden bg-[var(--bg-primary)] relative">
            {/* 主内容区卡片壳：与左右两侧(ActivityBar / 日程打卡面板)同款圆角+阴影+留白，三卡对称 */}
            <div className="m-1.5 flex min-w-0 flex-1">
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-[0_6px_24px_rgba(0,0,0,0.16)]">
              {/* Workbench（R1-W1）：全局侧栏槽（左）+ 编辑器组（右）。编辑器激活时文件树 portal 进侧栏；
                  其余模块暂以整页形态驻留编辑器组（逐模块迁移中）。旧布局 = 无边栏直渲模块 */}
              <div className="flex min-h-0 flex-1">
                {workbench && (
                  <div
                    ref={wbSidebarRef}
                    className={`flex shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)] transition-[width] duration-150 ${
                      activeTab === 'editor' || secondaryTab === 'editor' ? 'w-[220px]' : 'w-0 overflow-hidden border-r-0'
                    }`}
                  />
                )}
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  {/* 编辑器组（W3 · Editor Groups v1）：主栏 + 可选副栏，两栏模块互不相同 */}
                  <div className="flex min-h-0 min-w-0 flex-1">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      {/* 主栏：activeTab 可见；其余已访问模块 display:none 常驻保活（切 Tab 不卸载 → 状态保留）。
                          ISS-2026-09-04-02：原实现只渲染 activeTab，切走即卸载（知识库页签/树状态全丢）。
                          保活顺序 = mountedTabs 访问序 + activeTab 兜底首访（on=true 时 add 到集合） */}
                      {renderMounted(activeTab, true)}
                      {Array.from(mountedTabs.current)
                        .filter((t) => t !== activeTab && t !== secondaryTab)
                        .map((t) => renderMounted(t, false))}
                    </div>
                    {secondaryTab && secondaryTab !== activeTab && (
                      <ResizablePanel
                        storageKey="kb.splitSecondaryWidth"
                        side="right"
                        defaultWidth={380}
                        minWidth={300}
                        maxWidth={Math.max(420, Math.floor(winWidth * 0.45))}
                        visible
                        showHandle
                        onSnapClose={() => setSecondaryTab(null)}
                      >
                        <div className="flex h-full flex-col">
                          <SplitPaneBar
                            currentLabel={tabLabel(secondaryTab)}
                            targets={MODULE_TABS.filter((m) => m.id !== activeTab && m.id !== secondaryTab)}
                            onSwitch={(id) => setSecondaryTab(id as TabName)}
                            onClose={() => setSecondaryTab(null)}
                          />
                          <div className="flex min-h-0 flex-1 flex-col">
                            {renderMounted(secondaryTab, true)}
                          </div>
                        </div>
                      </ResizablePanel>
                    )}
                  </div>
                  {/* AI 助手入口：归属主体卡片，任务栏展开/收起不影响其相对位置。
                      沉浸式 Agent 工作台（immersive）激活时隐藏——全屏 AI 界面不再需要右下浮钮 */}
                  {activeTab !== 'immersive' && secondaryTab !== 'immersive' && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('ai-assistant:toggle'))}
                      title="AI 助手 (Ctrl+J)"
                      className="absolute bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg transition-opacity hover:opacity-90"
                    >
                      <Sparkles size={19} />
                    </button>
                  )}
                  {/* 番茄钟全屏面板：挂在内容卡片内（而非 main），只覆盖主内容区 ——
                      否则会盖住右侧的任务栏（DayPanel），表现为「进入番茄钟任务栏被关闭/唤不出」 */}
                  <PomodoroPanel />
                </div>
              </div>
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
          </main>
      {/* 全局 AI 助手侧栏 */}
      <AssistantPanel />
        </div>
      {workbench && bottomPanel && <GlobalSearchPanel onClose={() => setBottomPanel(false)} />}
      {workbench && <WorkbenchStatusBar />}
        </div>
      </PomodoroProvider>
      {palette === 'command' && (
        <CommandPalette
          placeholder="输入命令…（如：打开编辑器 / 切换布局）"
          items={buildCommandItems()}
          footer="↑↓ 选择 · Enter 执行 · Esc 关闭"
          onClose={() => setPalette(null)}
        />
      )}
      {palette === 'file' && (
        <CommandPalette
          placeholder="搜索页面：标题 / 路径（如：虚拟存储器）"
          items={fileItems}
          loading={fileLoading}
          emptyHint="仓库中暂无可打开的 .md 页面（需 vault 读源并已建索引）"
          footer="基于知识页索引 · Enter 在编辑器打开 · 再按 Ctrl+O 关闭"
          onClose={() => setPalette(null)}
        />
      )}
      <Toast />
      {onboardingOpen && (
        <Onboarding
          onComplete={() => { update('onboardingDone', true); setOnboardingOpen(false) }}
          onSwitchTab={tab => setActiveTab(tab)}
        />
      )}
      {importModalOpen && <ImportModal onClose={() => setImportModalOpen(false)} initialBackupPath={importBackupPath} />}
      {welcomeOpen && <WelcomeOverlay onDone={() => setWelcomeOpen(false)} />}
    </div>
  )
}
