/** 运行时读 CSS 变量取色（主题跟随全局，插件主题免通知；design 风险 5） */

export function cssVar(name: string, fallback = ''): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

export interface GraphThemeColors {
  bg: string
  accent: string
  textMuted: string
  textDisabled: string
  border: string
  selected: string
}

export function readGraphTheme(): GraphThemeColors {
  return {
    bg: cssVar('--bg-primary', '#111216'),
    accent: cssVar('--accent', '#4d8dff'),
    textMuted: cssVar('--text-muted', '#9a9a9a'),
    textDisabled: cssVar('--text-disabled', '#565656'),
    border: cssVar('--border-color', '#2a2b30'),
    selected: cssVar('--accent', '#4d8dff'),
  }
}

/** 按页 path 一级目录取预设色环（G3 着色开关的廉价版，G1 预留接口） */
const SPACE_PALETTE = ['#e34d4d', '#e0913b', '#d3c23c', '#4daf6a', '#3b8fd3', '#8d5fd6', '#d653a3', '#4db8b0']
export function colorBySpace(path: string, theme: GraphThemeColors): string {
  if (!path) return theme.accent
  const first = path.split('/')[0]
  let h = 0
  for (let i = 0; i < first.length; i++) h = (h * 31 + first.charCodeAt(i)) >>> 0
  return SPACE_PALETTE[h % SPACE_PALETTE.length]
}
