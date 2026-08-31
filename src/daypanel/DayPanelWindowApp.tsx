import { useCallback, useEffect } from 'react'
import { applyThemeClass, FONT_CSS_MAP } from '../lib/settings'
import { getAllSettings } from '../lib/ipc'
import { useDataChanged } from '../lib/dataChanged'
import { Toast } from '../components/shared/Toast'
import { DayPanel } from './DayPanel'

/**
 * 小窗根组件：独立 BrowserWindow 加载 index.html#/day-panel 时渲染（App.tsx 按 argv 分流）。
 * 与主窗口共享渲染 bundle 与 CSS 变量主题；主窗口设置变更（theme/zoom/字体）经
 * data:notify 广播 scope='settings'，此处重新应用。
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
      <DayPanel />
      <Toast />
    </>
  )
}
