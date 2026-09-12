import type { CSSProperties } from 'react'
import { useSettings } from '../../lib/SettingsContext'

export type TreeGuideMode = 'line' | 'dashed' | 'none'

/**
 * 侧栏层级参考线（Obsidian 沉浸式文件夹式）——容器级**连续**竖线。
 *
 * ⚠️ 不要用「每行画线段」的方案：行有 rounded-md 圆角，每段两端被裁圆，
 * 堆起来就是竹节状起伏（2026-09-12 已踩过）。正确画法是每个展开目录在
 * 「子级内容块」里放一条贯穿整块的绝对定位竖线——块顶即父行下方、块底即末子级，
 * 天然笔直连贯。父容器需 position:relative。
 *
 * 用法（两棵树同构：缩进单位 12px、行首基准 6px、首列 12px 箭头/占位列）：
 *   <div className="relative">
 *     <TreeGuideLine level={depth} />   （level = 当前目录自己的深度）
 *     …children rows…
 *   </div>
 *
 * 样式由设置 sidebarTreeGuides 控制：line 实线（默认）/ dashed 虚线 / none 关闭；
 * 颜色走主题变量 --tree-guide（color-mix 派生自 --border-color，明暗/水墨主题自动联动）。
 */
export function TreeGuideLine({ level, unit = 12, base = 6, style }: {
  level: number
  unit?: number
  base?: number
  style?: CSSProperties
}) {
  const { s } = useSettings()
  const mode = (s.sidebarTreeGuides ?? 'line') as TreeGuideMode
  if (mode === 'none') return null
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0"
      style={{ left: base + level * unit + 5, borderLeft: `1px ${mode === 'dashed' ? 'dashed' : 'solid'} var(--tree-guide)`, ...style }}
    />
  )
}
