/**
 * 禅模式字数统计（纯函数，可冒烟）。
 * 口径（docs/zen-mode-design.md §10-7 推荐项）：字数 = CJK 字符数 + 非 CJK 单词数；
 * chars = 正文非空白字符总数。frontmatter（--- 包裹）不计入。
 */

/** CJK 统一表意 + 扩展A + 兼容 + 日文假名 + 谚文 */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g
/** 去掉行首 --- 包裹的 frontmatter（无 frontmatter 时原样返回） */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
}

export function countWords(raw: string): { words: number; chars: number } {
  const body = stripFrontmatter(raw)
  const cjk = body.match(CJK_RE)?.length ?? 0
  // CJK 已单独计数，替换为空白后按空白分词；含字母/数字的段才算单词（纯标点不计）
  const nonCjk = body.replace(CJK_RE, ' ')
  let words = cjk
  for (const w of nonCjk.split(/\s+/)) {
    if (w.length > 0 && /[A-Za-z0-9_]/.test(w)) words++
  }
  const chars = body.replace(/\s/g, '').length
  return { words, chars }
}
