import { existsSync, lstatSync, readFileSync, readdirSync, statSync, type Dirent } from 'fs'
import { join, relative } from 'path'
import { getCurrentVault } from './vaultContext'
import { readJson, writeJson, deleteFile } from './jsonStore'
import { parseMarkdown } from './mdStore'

export type KnowledgeCategoryType = 'space' | 'notebook' | 'folder'

export interface KnowledgeCategoryIndexEntry {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
  categoryType: KnowledgeCategoryType
  /** 仓库内相对目录路径（如 学习空间/C++教学）；graph 目录 scope 依赖此字段 */
  path?: string
}

export interface KnowledgePageIndexEntry {
  id: string
  title: string
  path: string
  categoryId: string | null
  tags: string[]
  starred: boolean
  sortOrder: number
  fileType: string
  attachmentId: string
  createdAt: string
  updatedAt: string
  mtimeMs: number
  /** 正文 [[出链]] 标题集合（R2：反链面板据此反查，不必全文扫） */
  outgoingTitles: string[]
}

/** 抽取 md 正文中的 [[wiki link]] 出链标题（别名取 | 前段，去重） */
export function extractWikiOutlinks(md: string): string[] {
  const out: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    const t = m[1].split('|')[0].trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export interface KnowledgeIndex {
  schemaVersion: 3
  generatedAt: string
  source: 'vault'
  categories: KnowledgeCategoryIndexEntry[]
  pages: KnowledgePageIndexEntry[]
  byId: Record<string, KnowledgePageIndexEntry>
  warnings: string[]
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function scanMarkdownFiles(root: string, dir: string, out: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name === '_attachments' || entry.name === 'blog') continue
    const abs = join(dir, entry.name)
    try {
      if (entry.isSymbolicLink() || lstatSync(abs).isSymbolicLink()) continue
      if (entry.isDirectory()) {
        // . 开头目录 = 系统区（.knowbase 内仅有 _inbox 是知识页收件箱，其余跳过）
        if (entry.name.startsWith('.')) {
          if (entry.name === '.knowbase') {
            const inbox = join(abs, '_inbox')
            if (existsSync(inbox) && lstatSync(inbox).isDirectory()) scanMarkdownFiles(root, inbox, out)
          }
          continue
        }
        scanMarkdownFiles(root, abs, out)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(abs)
      }
    } catch {
      // A single unreadable entry must not prevent the rest of the vault indexing.
    }
  }
}

/**
 * 读取分类树。兼容两种落盘格式：
 *  - dict（vaultMigration / 迁移器产物）: { "<uuid>": { id,name,type,parent,sortOrder,...,path } }
 *  - array（早期/其它写入路径）: [{ id,name,categoryType,parentId,... }]
 * dict 优先——迁移产物是 dict 且带 path（graph 目录 scope 依赖）。
 */
function readCategories(): { categories: KnowledgeCategoryIndexEntry[]; warnings: string[] } {
  const raw = readJson<unknown>('modules/knowledge', 'categories.json', [])
  const warnings: string[] = []
  const items: Array<Record<string, unknown>> = []
  if (Array.isArray(raw)) {
    for (const it of raw as unknown[]) if (it && typeof it === 'object') items.push(it as Record<string, unknown>)
  } else if (raw && typeof raw === 'object') {
    for (const it of Object.values(raw as Record<string, unknown>)) if (it && typeof it === 'object') items.push(it as Record<string, unknown>)
  }

  const categories: KnowledgeCategoryIndexEntry[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const id = asString(item.id)
    if (!id) {
      warnings.push('发现没有 id 的分类，已跳过')
      continue
    }
    const type = asString(item.categoryType) || asString(item.type) || 'folder'
    categories.push({
      id,
      name: asString(item.name) || id,
      parentId: asString(item.parentId) || asString(item.parent) || null,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 0,
      categoryType: type === 'space' || type === 'notebook' ? type : 'folder',
      // dict 格式带仓库内相对目录路径；array 无 path 时置空（graph scope 不生效，不崩）
      path: asString(item.path) || undefined,
    })
  }
  return { categories, warnings }
}

/** 全量扫描当前 Vault，生成可供 knowledgeRepo 使用的内存索引。 */
export function rebuildKnowledgeIndex(): KnowledgeIndex {
  const current = getCurrentVault()
  const warnings: string[] = []
  if (!current) {
    return {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      source: 'vault',
      categories: [],
      pages: [],
      byId: {},
      warnings: ['当前没有打开的仓库'],
    }
  }

  const categoryResult = readCategories()
  warnings.push(...categoryResult.warnings)
  const files: string[] = []
  scanMarkdownFiles(current.rootPath, current.rootPath, files)
  const pages: KnowledgePageIndexEntry[] = []
  const byId: Record<string, KnowledgePageIndexEntry> = {}

  for (const abs of files) {
    try {
      const raw = readFileSync(abs, 'utf8')
      const doc = parseMarkdown(raw)
      const id = asString(doc.frontmatter.id)
      if (!id) {
        warnings.push(`页面缺少 frontmatter.id，已跳过：${relative(current.rootPath, abs)}`)
        continue
      }
      if (byId[id]) {
        warnings.push(`页面 id 重复，后者已跳过：${id}`)
        continue
      }
      const stat = statSync(abs)
      const entry: KnowledgePageIndexEntry = {
        id,
        title: asString(doc.frontmatter.title) || abs.slice(Math.max(abs.lastIndexOf('\\'), abs.lastIndexOf('/')) + 1).replace(/\.md$/i, ''),
        path: relative(current.rootPath, abs).replace(/\\/g, '/'),
        categoryId: asString(doc.frontmatter.category) || null,
        tags: asStringArray(doc.frontmatter.tags),
        starred: asString(doc.frontmatter.starred).toLowerCase() === 'true',
        sortOrder: Number.isFinite(Number(doc.frontmatter.sortOrder)) ? Number(doc.frontmatter.sortOrder) : 0,
        fileType: asString(doc.frontmatter.fileType),
        attachmentId: asString(doc.frontmatter.attachmentId),
        createdAt: asString(doc.frontmatter.created),
        updatedAt: asString(doc.frontmatter.updated),
        mtimeMs: stat.mtimeMs,
        outgoingTitles: extractWikiOutlinks(doc.body),
      }
      pages.push(entry)
      byId[id] = entry
    } catch {
      warnings.push(`页面读取失败，已跳过：${relative(current.rootPath, abs)}`)
    }
  }

  pages.sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, 'zh-Hans'))
  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    source: 'vault',
    categories: categoryResult.categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hans')),
    pages,
    byId,
    warnings,
  }
}

/** 读取缓存；不存在或 schema 不匹配时自动重建并落盘。 */
export function getKnowledgeIndex(forceRebuild = false): KnowledgeIndex {
  if (!forceRebuild) {
    const cached = readJson<KnowledgeIndex | null>('cache', 'knowledge-index.json', null)
    if (cached && cached.schemaVersion === 3 && cached.source === 'vault' && Array.isArray(cached.pages) && cached.byId) return cached
  }
  const fresh = rebuildKnowledgeIndex()
  writeJson('cache', 'knowledge-index.json', fresh)
  return fresh
}

/** Vault 内容发生变化时调用：只删缓存文件，下一次 getKnowledgeIndex 懒重建（P0 不依赖 watcher）。 */
export function invalidateKnowledgeIndex(): void {
  const current = getCurrentVault()
  if (!current) return
  deleteFile('cache', 'knowledge-index.json')
}

export function findKnowledgePage(id: string): KnowledgePageIndexEntry | null {
  return getKnowledgeIndex().byId[id] || null
}
