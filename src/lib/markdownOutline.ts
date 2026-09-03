/**
 * Markdown 大纲解析（编辑器大纲导航用）。
 * 纯逻辑、无依赖；输入全文 → 标题层级树（# 一级 / ## 二级…），附行号（1-based）。
 */

export interface OutlineItem {
  /** 标题文本（去掉 # 前缀与两侧空白） */
  text: string
  /** 1-based 行号 */
  line: number
  /** 层级 1-6 */
  level: number
}

/** 从 markdown 全文提取标题大纲（跳过代码块中的 #） */
export function extractOutline(markdown: string): OutlineItem[] {
  const lines = markdown.split('\n')
  const out: OutlineItem[] = []
  let inFence = false
  let fenceMark = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 围栏代码块（``` 或 ~~~）
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (!inFence) { inFence = true; fenceMark = fence[1][0] }
      else if (fence[1][0] === fenceMark && !line.slice(fence[1].length).trim()) { inFence = false }
      continue
    }
    if (inFence) continue
    // ATX 标题：# 后必须有空格或行尾
    const m = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/.exec(line)
    if (m && m[1]) {
      out.push({ text: (m[2] ?? '').trim(), line: i + 1, level: m[1].length })
    }
  }
  return out
}
