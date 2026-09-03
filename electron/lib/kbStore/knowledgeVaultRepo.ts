import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getCurrentVault } from './vaultContext'
import { getKnowledgeIndex, invalidateKnowledgeIndex, type KnowledgePageIndexEntry } from './knowledgeIndex'
import { createLinkResolver, getGraphIndex } from './graphIndex'
import { parseMarkdown, serializeMarkdown } from './mdStore'

/**
 * 知识库 vault 读源（读写分工定稿，见 .AGENT/docs/读写分工设计.md）：
 * 知识库模块 = 阅读器（读走 knowledgeIndex），编辑器模块 = 唯一写入方。
 * 本文件只提供「读 + 星标小编辑」两类能力，纯函数可冒烟、不依赖 Electron。
 * payload 形状对齐 knowledgeRepo.mapPage，渲染层无感切换。
 */

export interface VaultTag { id: string; name: string; color: string }

export interface VaultPage {
  id: string
  title: string
  contentMd: string
  contentHtml: string
  annotationMd: string
  categoryId: string | null
  isStarred: boolean
  sortOrder: number
  fileType: string
  attachmentId: string
  createdAt: string
  updatedAt: string
  tags: VaultTag[]
  /** 仓库内相对路径（渲染层跳转编辑器用，绝不含绝对路径） */
  path: string
  /** frontmatter attachments 数组：仓库内相对路径（如 .knowbase/_attachments/knowledge_page/<id>/<file>） */
  attachments: string[]
}

function requireRoot(): string {
  const cur = getCurrentVault()
  if (!cur) throw new Error('当前没有打开的仓库')
  return cur.rootPath
}

function tagsOf(entry: KnowledgePageIndexEntry): VaultTag[] {
  return entry.tags.map((name) => ({ id: name, name, color: '' }))
}

/** 读页面文件：单次读盘同时给出正文与 frontmatter attachments（避免双读） */
function readPageDoc(entry: KnowledgePageIndexEntry): { contentMd: string; attachments: string[] } {
  try {
    const abs = join(requireRoot(), entry.path)
    const doc = parseMarkdown(readFileSync(abs, 'utf-8'))
    const a = doc.frontmatter.attachments
    return {
      contentMd: doc.body,
      attachments: Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return { contentMd: '', attachments: [] }
  }
}

function entryToPage(entry: KnowledgePageIndexEntry, contentMd = '', attachments: string[] = []): VaultPage {
  return {
    id: entry.id,
    title: entry.title,
    contentMd,
    contentHtml: '',
    annotationMd: '',
    categoryId: entry.categoryId,
    isStarred: entry.starred,
    sortOrder: entry.sortOrder,
    fileType: entry.fileType,
    attachmentId: entry.attachmentId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tags: tagsOf(entry),
    path: entry.path,
    attachments,
  }
}

/** 原子写仓库根内文件（tmp + rename，与 jsonStore 同策略） */
function writeVaultFile(relPath: string, content: string): boolean {
  try {
    const abs = join(requireRoot(), relPath)
    const dir = dirname(abs)
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    writeFileSync(tmp, content, 'utf-8')
    try {
      renameSync(tmp, abs)
    } catch {
      if (existsSync(abs)) unlinkSync(abs)
      renameSync(tmp, abs)
    }
    return true
  } catch {
    return false
  }
}

export function vaultGetCategories(): Array<{ id: string; name: string; parentId: string | null; sortOrder: number; categoryType: string; path?: string }> {
  return getKnowledgeIndex().categories.map((c) => ({
    id: c.id, name: c.name, parentId: c.parentId, sortOrder: c.sortOrder, categoryType: c.categoryType,
    // 图谱目录 scope：仓库内相对目录（迁移产物 dict 带 path；array 缺省）
    ...(c.path ? { path: c.path } : {}),
  }))
}

/** 语义对齐 knowledge:getPages：truthy=按分类，null=未分类，undefined=全部 */
export function vaultGetPages(categoryId?: string | null): VaultPage[] {
  const idx = getKnowledgeIndex()
  let list = idx.pages
  if (categoryId) list = list.filter((e) => e.categoryId === categoryId)
  else if (categoryId === null) list = list.filter((e) => e.categoryId === null)
  return list.map((e) => {
    const doc = readPageDoc(e)
    return entryToPage(e, doc.contentMd, doc.attachments)
  })
}

export function vaultGetPageById(id: string): VaultPage | null {
  const entry = getKnowledgeIndex().byId[id]
  if (!entry) return null
  const doc = readPageDoc(entry)
  return entryToPage(entry, doc.contentMd, doc.attachments)
}

/** 星标小编辑（读写分工拍板的例外）：frontmatter 重写、正文不动 */
export function vaultToggleStar(id: string): VaultPage | null {
  const entry = getKnowledgeIndex().byId[id]
  if (!entry) return null
  const abs = join(requireRoot(), entry.path)
  const doc = parseMarkdown(readFileSync(abs, 'utf-8'))
  const cur = String(doc.frontmatter.starred ?? '').toLowerCase() === 'true'
  doc.frontmatter.starred = cur ? 'false' : 'true'
  if (!writeVaultFile(entry.path, serializeMarkdown(doc.frontmatter, doc.body))) {
    throw new Error('星标写入失败')
  }
  invalidateKnowledgeIndex()
  const fresh = getKnowledgeIndex().byId[id]
  return fresh ? entryToPage(fresh, doc.body) : null
}

export function vaultGetStarredPages(): VaultPage[] {
  return getKnowledgeIndex().pages
    .filter((e) => e.starred)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((e) => entryToPage(e))
}

export function vaultGetTags(): VaultTag[] {
  const seen = new Map<string, VaultTag>()
  for (const p of getKnowledgeIndex().pages) {
    for (const name of p.tags) {
      if (!seen.has(name)) seen.set(name, { id: name, name, color: '#6b7280' })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'))
}

/** 粗剥 markdown 记号 → 纯文本（与 knowledgeRepo 内同名逻辑一致） */
function mdToPlain(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[>*`~_|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildExcerpt(plain: string, terms: string[], radius = 60): string {
  if (!plain) return ''
  const lower = plain.toLowerCase()
  let idx = -1
  for (const t of terms) {
    if (!t) continue
    idx = lower.indexOf(t.toLowerCase())
    if (idx >= 0) break
  }
  if (idx < 0) return ''
  const start = Math.max(0, idx - radius)
  const end = Math.min(plain.length, idx + radius)
  return (start > 0 ? '…' : '') + plain.slice(start, end).trim() + (end < plain.length ? '…' : '')
}

/** 全文搜索：每个词都须命中（标题/标签/正文），最多 50 条，摘录不回传大字段 */
export function vaultSearchPages(q: string): Array<VaultPage & { excerpt: string }> {
  const terms = q.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const idx = getKnowledgeIndex()
  const root = requireRoot()
  const out: Array<VaultPage & { excerpt: string }> = []
  for (const entry of idx.pages) {
    let body = ''
    try {
      body = parseMarkdown(readFileSync(join(root, entry.path), 'utf-8')).body
    } catch {
      body = ''
    }
    const titleHit = terms.every((t) => entry.title.toLowerCase().includes(t.toLowerCase()))
    const tagHit = terms.every((t) => entry.tags.some((tag) => tag.toLowerCase().includes(t.toLowerCase())))
    const bodyHit = terms.every((t) => body.toLowerCase().includes(t.toLowerCase()))
    if (!titleHit && !tagHit && !bodyHit) continue
    const { path: _p, ...slim } = entryToPage(entry, '')
    void _p
    out.push({ ...slim, path: entry.path, excerpt: buildExcerpt(mdToPlain(body), terms) || entry.title })
    if (out.length >= 50) break
  }
  return out
}

// ===== R2/R4 反链：GraphIndex 统一链接解析（resolved incoming，不再按标题字符串匹配） =====

export interface VaultBacklinkContextItem {
  id: string
  title: string
  fileType: string
  updatedAt: string
  excerpt: string
}

/** 反链源页列表（knowledge:getBacklinks vault 分支，DTO 对齐 sqlite 版 mapPage 的骨架字段） */
export function vaultGetBacklinks(pageId: string): VaultPage[] {
  const idx = getKnowledgeIndex()
  const page = idx.byId[pageId]
  if (!page) return []
  const srcIds = getGraphIndex().incoming[pageId] || []
  const rows = srcIds
    .map((id) => idx.byId[id])
    .filter((p): p is KnowledgePageIndexEntry => !!p && p.id !== pageId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return rows.map((e) => entryToPage(e, ''))
}

/** 反链上下文摘录：定位源页正文中 resolve 到本页的 [[引用]] 处，取前后约 60 字符（与图谱同一解析口径） */
export function vaultGetBacklinkContext(pageId: string): VaultBacklinkContextItem[] {
  const idx = getKnowledgeIndex()
  const root = requireRoot()
  const page = idx.byId[pageId]
  if (!page) return []
  const srcIds = getGraphIndex().incoming[pageId] || []
  if (srcIds.length === 0) return []
  const resolver = createLinkResolver(idx)
  const out: VaultBacklinkContextItem[] = []
  const sources = srcIds
    .map((id) => idx.byId[id])
    .filter((p): p is KnowledgePageIndexEntry => !!p && p.id !== pageId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  for (const src of sources) {
    let excerpt = ''
    try {
      const raw = readFileSync(join(root, src.path), 'utf-8')
      const re = /\[\[([^\]]+)\]\]/g
      let m: RegExpExecArray | null
      let hitIdx = -1
      while ((m = re.exec(raw)) !== null) {
        if (resolver.resolve(m[1].split('|')[0]) === pageId) {
          hitIdx = m.index
          break
        }
      }
      if (hitIdx >= 0) {
        const start = Math.max(0, hitIdx - 60)
        const end = Math.min(raw.length, hitIdx + 70)
        excerpt = ((start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '')).replace(/\s+/g, ' ').trim()
      }
    } catch {
      /* 文件读失败时只给条目不带摘录 */
    }
    out.push({
      id: src.id,
      title: src.title,
      fileType: src.fileType.replace(/^\./, '').toLowerCase(),
      updatedAt: src.updatedAt,
      excerpt,
    })
  }
  return out
}
