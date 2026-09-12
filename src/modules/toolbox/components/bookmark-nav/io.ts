import type { BookmarkCategory, BookmarkItem } from '../../../../types'

/**
 * 网址导航导入导出：
 * - JSON：完整备份（分类+书签），可再导入合并
 * - HTML：Netscape 书签格式——导出可直接导入 Chrome / Edge / Firefox；
 *   导入支持浏览器「导出收藏夹」生成的同格式 HTML 文件
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
    '<!-- Saved by Phrontis 网址导航 -->',
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
    throw new Error('文件格式不符合 Phrontis 书签导出规范')
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

// ===== 浏览器书签 HTML 导入（Netscape Bookmark 格式）=====

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => {
      const code = Number(d)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&amp;/g, '&') // 必须最后反转义
}

interface HtmlFolderNode {
  name: string
  children: HtmlFolderNode[]
  bookmarks: { title: string; url: string; description?: string }[]
}

/** 浏览器导出时代表「根栏位」的文件夹名——拍平时跳过，不进入分类路径 */
const STANDARD_ROOT_NAMES = new Set([
  '收藏夹栏', '书签栏', '收藏夹',
  'bookmarks bar', 'bookmark bar', 'favorites bar', 'favorites', 'bookmarks',
])

function isStandardRootName(name: string): boolean {
  return STANDARD_ROOT_NAMES.has(name.trim().toLowerCase())
}

const A_TAG_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/i
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i

/**
 * 解析浏览器导出的收藏夹 HTML（Chrome / Edge / Firefox 的 Netscape 书签格式）。
 * 映射规则：文件夹 → 分类（「收藏夹栏 / 书签栏」等标准根名跳过；嵌套文件夹拍平为「父/子」路径名）；
 * 无文件夹归属的书签 → 未分类；仅保留 http(s) 链接，其余（javascript:、place: 等）跳过。
 */
export function parseHtmlImport(text: string): ParsedImport {
  const root: HtmlFolderNode = { name: '', children: [], bookmarks: [] }
  const stack: HtmlFolderNode[] = [root]
  let pending: HtmlFolderNode | null = null // 已见 <H3>、待其 <DL> 开启的文件夹
  let last: HtmlFolderNode['bookmarks'][number] | null = null // 供 <DD> 描述挂靠

  for (const line of text.split(/\r?\n/)) {
    const h3 = line.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    if (h3) {
      pending = { name: unescapeHtml(h3[1]).trim(), children: [], bookmarks: [] }
    }

    if (/<dl\b/i.test(line)) {
      const parent = stack[stack.length - 1]
      const folder = pending ?? { name: '', children: [], bookmarks: [] }
      parent.children.push(folder)
      pending = null
      stack.push(folder)
    }

    if (/<\/dl/i.test(line)) {
      if (stack.length > 1) stack.pop()
      last = null
    }

    const a = line.match(A_TAG_RE)
    if (a) {
      const href = a[1].match(HREF_RE)
      const rawUrl = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
      const url = normalizeUrl(unescapeHtml(rawUrl))
      if (url && isValidUrl(url)) {
        const title = unescapeHtml(a[2]).replace(/\s+/g, ' ').trim()
        last = { title: title || domainOf(url), url }
        stack[stack.length - 1].bookmarks.push(last)
      }
    }

    const dd = line.match(/<dd\b[^>]*>([\s\S]*)$/i)
    if (dd && last) {
      const desc = unescapeHtml(dd[1]).replace(/\s+/g, ' ').trim()
      if (desc) last.description = desc
    }
  }

  // 拍平：文件夹路径 → 分类名
  const imported: ExportPayload['bookmarks'] = []
  const walk = (folder: HtmlFolderNode, path: string[]) => {
    const category = path.length > 0 ? path.join('/') : undefined
    for (const b of folder.bookmarks) {
      imported.push({ title: b.title, url: b.url, description: b.description, category })
    }
    for (const child of folder.children) {
      walk(child, child.name && !isStandardRootName(child.name) ? [...path, child.name] : path)
    }
  }
  walk(root, [])

  if (imported.length === 0) {
    throw new Error('未识别到书签，请确认是浏览器「导出收藏夹」生成的 HTML 文件')
  }

  // 收集分类（保持出现顺序，同名自动合并）
  const categories: ExportPayload['categories'] = []
  const seenCats = new Set<string>()
  for (const b of imported) {
    if (b.category && !seenCats.has(b.category)) {
      seenCats.add(b.category)
      categories.push({ name: b.category })
    }
  }

  return { payload: { categories, bookmarks: imported } }
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
