import type * as Monaco from 'monaco-editor'

/**
 * 编辑器主题桥 —— 让 Monaco 跟随应用主题（含插件主题）。
 *
 * 背景：Monaco 有独立的配色体系（defineTheme），不吃 CSS 变量；此前 PageEditor / MarkdownEditor
 * 用 `s.theme === 'light' ? 'vs' : 'vs-dark'` 硬编码，任何插件主题下编辑器都强制深色，
 * 与周围界面配色割裂。
 *
 * 方案：从 computed style 读取应用 CSS 变量，动态合成 knowbase-auto 主题；
 * 监听 html.class 变化（切换主题 = 换类名）实时重定义，所有已挂载编辑器即时刷新。
 */

let monacoRef: typeof Monaco | null = null
let observerInstalled = false

/** css 颜色 → Monaco 接受的 #rrggbb / #rrggbbaa；无法解析返回 null */
function toHex(raw: string): string | null {
  const s = raw.trim()
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return s
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('')
  const m = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (m) {
    const parts = m[1].split(',').map(x => parseFloat(x.trim()))
    if (parts.length >= 3 && parts.slice(0, 3).every(n => Number.isFinite(n))) {
      const [r, g, b] = parts.map(n => Math.max(0, Math.min(255, Math.round(n))))
      const hex = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
      if (parts.length >= 4 && Number.isFinite(parts[3])) {
        const a = Math.round(Math.max(0, Math.min(1, parts[3])) * 255)
        return `#${hex}${a.toString(16).padStart(2, '0')}`
      }
      return `#${hex}`
    }
  }
  return null
}

/** 相对亮度判断明暗基座 */
function isLightColor(hex: string): boolean {
  const m = /^#([0-9a-f]{6})/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140
}

export function applyEditorTheme(): void {
  if (!monacoRef) return
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => toHex(cs.getPropertyValue(name)) ?? fallback

  const bg = v('--bg-primary', '#1e1e1e')
  const bgSecondary = v('--bg-secondary', '#252526')
  const fg = v('--text-primary', '#cccccc')
  const muted = v('--text-muted', '#8a8a8a')
  const border = v('--border-color', '#333333')
  const accent = v('--accent', '#007acc')
  const selected = v('--bg-selected', '#094771')

  monacoRef.editor.defineTheme('knowbase-auto', {
    base: isLightColor(bg) ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorGutter.background': bg,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': fg,
      'editor.lineHighlightBackground': bgSecondary,
      'editor.selectionBackground': selected,
      'editorIndentGuide.background1': border,
      'editorIndentGuide.activeBackground1': muted,
      'editorWidget.background': bgSecondary,
      'editorWidget.border': border,
      'editorSuggestWidget.background': bgSecondary,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': selected,
      'scrollbarSlider.background': `${border}80`,
      'scrollbarSlider.hoverBackground': `${muted}80`,
      'editorBracketMatch.border': accent,
    },
  })
  monacoRef.editor.setTheme('knowbase-auto')
}

/** Monaco 实例就绪后调用（beforeMount）；重复调用安全 */
export function bindEditorTheme(monaco: typeof Monaco): void {
  monacoRef = monaco
  applyEditorTheme()
  if (!observerInstalled && typeof MutationObserver !== 'undefined') {
    observerInstalled = true
    new MutationObserver(applyEditorTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }
}
