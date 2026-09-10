/**
 * 工件栏 HTML 渲染的渲染层小工具（AI教学模块专用；策略/壳注入在主进程 kbVisualProtocol.ts）：
 * 读宿主当前明暗主题下的 CSS 变量值，postMessage 下发给 kbview:// 沙箱内壳展开为 :root 内联声明
 * （不透明源不共享宿主样式，图随主题走——docs/ai-teaching-artifacts-pane-design.md §4.4）。
 */

const THEME_VARS = ['--bg-primary', '--bg-secondary', '--bg-hover', '--text-primary', '--text-secondary', '--text-muted', '--accent', '--border-color', '--success', '--warning', '--danger'] as const

export function collectThemeVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) {
    const val = cs.getPropertyValue(v).trim()
    if (val) out[v] = val
  }
  return out
}
