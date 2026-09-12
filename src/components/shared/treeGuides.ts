import type { CSSProperties } from 'react'

/**
 * 树形缩进层级参考线（Obsidian 沉浸式文件夹式）——编辑器 FileTree / 知识库 NotebookList 共用。
 *
 * 每行按 depth 画 depth 条 1px 竖线，x 对齐各祖先层「展开箭头/占位列」的中心
 * （两棵树同构：缩进单位 12px、行首基准 6px、首列 12px 宽）。行与行无缝堆叠，
 * 相邻行的同位线段自然连成贯穿竖线，无需容器级绝对定位。
 *
 * 颜色走主题变量 --tree-guide（color-mix 派生自 --border-color，明暗/水墨主题自动联动）；
 * 用背景图而非伪元素：绘制在 hover 底色之上、不参与布局，浅色主题下也能保持「隐形但可读」。
 */
export function treeGuideStyle(depth: number, unit = 12, base = 6): CSSProperties {
  if (depth <= 0) return {}
  const lines: string[] = []
  for (let k = 0; k < depth; k++) {
    const x = base + k * unit + 5
    lines.push(`linear-gradient(to right, var(--tree-guide) ${x}px, transparent ${x + 1}px)`)
  }
  return { backgroundImage: lines.join(', ') }
}
