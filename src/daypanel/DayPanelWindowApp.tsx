import { useCallback, useEffect, useState } from 'react'
import { applyThemeClass, FONT_CSS_MAP } from '../lib/settings'
import { getAllSettings } from '../lib/ipc'
import { useDataChanged } from '../lib/dataChanged'
import { Toast } from '../components/shared/Toast'
import { PomodoroProvider } from '../modules/toolbox/hooks/PomodoroContext'
import { DayPanel, type PanelMode } from './DayPanel'

/**
 * 独立脱离窗口根应用：与主窗口共用 #/day-panel 路由，仅在 detached=true 时由主进程创建
 * 独立的 BrowserWindow 加载并渲染本应用。主窗口内嵌态下不进入此分支（App.tsx 直接渲染
 * <DayPanel mode="embedded" />）。
 *
 * 独立态有三种桌面互动模式（主进程驱动）：
 * - floating      自由漂浮
 * - top-dock      顶部停靠（收缩触碰条 / 展开）
 * - desktop-widget 桌面小组件（鼠标穿透 / 可交互）
 */
export function DayPanelWindowApp() {
  const [panelMode, setPanelMode] = useState<PanelMode>('floating')
  const [collapsed, setCollapsed] = useState(false)
  const [widgetInteractive, setWidgetInteractive] = useState(false)

  const applyAppearance = useCallback(async () => {
    try {
      const s = await getAllSettings()
      const theme = String(s.theme || 'dark').replace(/[^a-zA-Z0-9_-]/g, '-')
      if (String(s.theme || 'dark').startsWith('plugin-')) {
        try {
          const m = await import('../lib/pluginService')
          await m.ensurePluginThemeStyles()
          applyThemeClass(theme)
        } catch { applyThemeClass(theme) }
      } else {
        applyThemeClass(theme)
      }
      const zoom = Math.min(1.5, Math.max(0.85, Number(s.zoom) || 1))
      document.documentElement.style.fontSize = `${zoom * 16}px`
      if (FONT_CSS_MAP[s.editorFont]) {
        document.documentElement.style.setProperty('--font-sans', FONT_CSS_MAP[s.editorFont])
      }
    } catch {
      applyThemeClass('dark')
    }
  }, [])

  useEffect(() => { document.title = '日程与打卡' }, [])
  useEffect(() => { void applyAppearance() }, [applyAppearance])
  useDataChanged('settings', () => { void applyAppearance() })

  // 订阅主进程状态：mode / 收缩态 / 小组件可交互态
  useEffect(() => {
    void window.api?.dayPanelGetState?.().then(s => {
      setPanelMode((s?.mode as PanelMode) || 'floating')
      setCollapsed(!!s?.collapsed)
      setWidgetInteractive(!!s?.widgetInteractive)
    }).catch(() => {})
    const offMode = window.api?.onDayPanelModeChanged?.((s) => setPanelMode((s.mode as PanelMode) || 'floating'))
    const offCollapsed = window.api?.onDayPanelCollapsedChanged?.((s) => setCollapsed(s.collapsed))
    const offWidget = window.api?.onDayPanelWidgetInteractiveChanged?.((s) => setWidgetInteractive(s.interactive))
    return () => { offMode?.(); offCollapsed?.(); offWidget?.() }
  }, [])

  // 报告 document 实际所需尺寸给主进程，独立窗口据此贴合高度（floating/top-dock 展开态）。
  // 内容变多时主动变大；变少时主进程不缩（保留用户拉大的空间）；首次开窗强制贴合避免闪烁。
  useEffect(() => {
    let timer: number | null = null
    const report = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        const w = document.documentElement.scrollWidth
        const h = document.documentElement.scrollHeight
        window.api?.dayPanelReportContentSize?.(w, h)
      }, 120)
    }
    const ro = new ResizeObserver(report)
    ro.observe(document.body)
    // 立即报告一次（首屏即可触发主进程贴合尺寸 + show）
    report()
    return () => {
      ro.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  // 番茄钟状态：拉取一次初始快照 + 订阅主进程广播，让 popout 也能显示主窗口里启动的番茄钟倒计时。
  // 番茄钟权威仍在主窗口，popout 端只接收不发送（避免循环 + 多计时器）。
  const [pomodoroStatus, setPomodoroStatus] = useState<{
    visible: boolean; display: string; running: boolean; phase: string; done: boolean; expanded: boolean; progress: number
  } | null>(null)
  useEffect(() => {
    void window.api?.pomodoroGetState?.().then(s => {
      if (s) setPomodoroStatus(s)
    }).catch(() => {})
    const off = window.api?.onPomodoroState?.((s) => setPomodoroStatus(s))
    return () => { off?.() }
  }, [])

  return (
    <PomodoroProvider passive>
      <DayPanel
        mode="popout"
        panelMode={panelMode}
        collapsed={collapsed}
        widgetInteractive={widgetInteractive}
        pomodoroStatus={pomodoroStatus}
        onDockBack={() => { void window.api?.dayPanelDockBack?.() }}
      />
      <Toast />
    </PomodoroProvider>
  )
}
