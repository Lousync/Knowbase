import { useCallback, useEffect } from 'react'
import { applyThemeClass, FONT_CSS_MAP } from '../lib/settings'
import { getAllSettings } from '../lib/ipc'
import { useDataChanged } from '../lib/dataChanged'
import { Toast } from '../components/shared/Toast'
import { DayPanel } from './DayPanel'

/**
 * 独立脱离窗口根应用：与主窗口共用 #/day-panel 路由，仅在 detached=true 时由主进程创建
 * 独立的 BrowserWindow 加载并渲染本应用。主窗口内嵌态下不进入此分支（App.tsx 直接渲染
 * <DayPanel mode="embedded" />）。
 */
export function DayPanelWindowApp() {
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

  return (
    <>
      <DayPanel
        mode="popout"
        onDockBack={() => { void window.api?.dayPanelDockBack?.() }}
      />
      <Toast />
    </>
  )
}