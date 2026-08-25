import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Electron 环境下必须从本地 node_modules 加载，禁用 CDN
loader.config({ monaco })

function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : fallback
}

let lastPluginKey = ''

/**
 * 应用主题 → Monaco 主题名。
 * 内置主题映射官方基色;插件主题读取当前生效的 CSS 变量动态生成配色,
 * 保证 MD/代码编辑区与周围界面同色系。
 */
export function monacoThemeFor(themeId: string): string {
  if (themeId === 'light') return 'vs'
  if (themeId === 'dark') return 'vs-dark'
  try {
    const bg = cssVar('--bg-primary', '#1e1e1e')
    const fg = cssVar('--text-primary', '#cccccc')
    const accent = cssVar('--accent', '#4a9eff')
    const border = cssVar('--border-color', '#3c3c3c')
    const muted = cssVar('--text-muted', '#6e7681')
    const key = `${themeId}|${bg}|${fg}|${accent}`
    if (key !== lastPluginKey) {
      monaco.editor.defineTheme('knowbase-plugin', {
        base: hexLuminance(bg) > 0.5 ? 'vs' : 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': fg,
          'editorLineNumber.foreground': muted,
          'editorLineNumber.activeForeground': fg,
          'editor.selectionBackground': accent + '55',
          'editor.lineHighlightBackground': border + '40',
          'editorCursor.foreground': accent,
          'editorIndentGuide.background': border + '80',
          'editorWidget.background': bg,
          'editorWidget.border': border,
        },
      })
      lastPluginKey = key
    }
    return 'knowbase-plugin'
  } catch {
    return 'vs-dark'
  }
}
