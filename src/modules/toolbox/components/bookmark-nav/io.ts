import type { BookmarkCategory, BookmarkItem } from '../../../../types'

/**
 * 网址导航导入导出：
 * - JSON：完整备份（分类+书签），可再导入合并
 * - HTML：Netscape 书签格式，可直接导入 Chrome / Edge / Firefox
 */

export interface ExportPayload {
  categories: { name: string; color?: string }[]
  bookmarks: { title: string; url: string; description?: string; category?: string }[]
}

// ===== 导出 =====

export function buildJsonExport(categories: BookmarkCategory[], bookmarks: BookmarkItem[]): string {
  const catName = new Map(categories.map(c => [c.id, c.name]))
  const payload = {
    app: 'knowbase',
    type: 'bookmarks',
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: categories.map(c => ({ name: c.name, color: c.color })),
    bookmarks: bookmarks.map(b => ({
      title: b.title,
      url: b.url,
      description: b.description || undefined,
      category: b.categoryId ? (catName.get(b.categoryId) ?? undefined) : undefined,
    })),
  }
  return JSON.stringify(payload, null, 2)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Netscape 书签格式（浏览器书签栏可导入） */
export function buildHtmlExport(categories: BookmarkCategory[], bookmarks: BookmarkItem[]): string {
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- Saved by Knowbase 网址导航 -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ]
  const item = (b: BookmarkItem, indent: string) => {
    const desc = b.description ? `\n${indent}    <DD>${escapeHtml(b.description)}` : ''
    lines.push(`${indent}    <DT><A HREF="${escapeHtml(b.url)}">${escapeHtml(b.title)}</A>${desc}`)
  }
  // 各分类文件夹
  for (const c of categories) {
    const items = bookmarks.filter(b => b.categoryId === c.id)
    if (items.length === 0) continue
    lines.push(`    <DT><H3>${escapeHtml(c.name)}</H3>`)
    lines.push('    <DL><p>')
    items.forEach(b => item(b, '    '))
    lines.push('    </DL><p>')
  }
  // 未分类放根级
  bookmarks.filter(b => !b.categoryId).forEach(b => item(b, ''))
  lines.push('</DL><p>')
  return lines.join('\n')
}

// ===== 导入 =====

interface RawPayload {
  app?: string
  type?: string
  categories?: { name?: unknown; color?: unknown }[]
  bookmarks?: { title?: unknown; url?: unknown; description?: unknown; category?: unknown }[]
}

export interface ParsedImport {
  payload: ExportPayload
}

/** 解析并校验 JSON 内容；结构不符时抛错 */
export function parseJsonImport(text: string): ParsedImport {
  let raw: RawPayload
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('文件不是合法的 JSON')
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bookmarks)) {
    throw new Error('文件格式不符合 Knowbase 书签导出规范')
  }

  const seenCatNames = new Set<string>()
  const categories: ExportPayload['categories'] = []
  for (const c of raw.categories ?? []) {
    if (typeof c?.name === 'string' && c.name.trim()) {
      const name = c.name.trim()
      if (!seenCatNames.has(name)) {
        seenCatNames.add(name)
        categories.push({ name, color: typeof c.color === 'string' ? c.color : undefined })
      }
    }
  }

  const bookmarks: ExportPayload['bookmarks'] = []
  for (const b of raw.bookmarks) {
    if (typeof b?.title !== 'string' && typeof b?.url !== 'string') continue
    if (typeof b.url !== 'string' || !b.url.trim()) continue
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : normalizeUrl(b.url.trim())
    bookmarks.push({
      title,
      url: b.url.trim(),
      description: typeof b.description === 'string' ? b.description : undefined,
      category: typeof b.category === 'string' && b.category.trim() ? b.category.trim() : undefined,
    })
  }

  return { payload: { categories, bookmarks } }
}

/** 无协议自动补 https:// */
export function normalizeUrl(input: string): string {
  const t = input.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

/** 简单合法性检查：必须含协议 + 域名点号，且无空白 */
export function isValidUrl(url: string): boolean {
  if (/\s/.test(url)) return false
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')
  } catch {
    return false
  }
}

/** 取展示用域名（去 www.） */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
