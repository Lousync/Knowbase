import { existsSync, lstatSync, readFileSync, readdirSync, statSync, type Dirent } from 'fs'
import { join, relative } from 'path'
import { randomUUID } from 'crypto'
import { getCurrentVault, KB_INBOX_DIR } from './vaultContext'
import { readJson, writeJson, deleteFile } from './jsonStore'
import { parseMarkdown } from './mdStore'
import { getVaultIgnore, isDirIgnored, type VaultIgnoreResult } from './ignoreFile'
import type { Ignore } from 'ignore'

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
  /** 页面状态（草稿/归档双态）：draft=草稿（知识库正式列表隐藏、图谱虚化/双链仍可引用）；published=归档（默认） */
  status: 'draft' | 'published'
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

/**
 * 扫描仓库 .md（P5a 嵌套防护）：全仓库最多一个 `.knowbase`（仓库根直属那个）；
 * 深层再出现 `.knowbase` 视为布局违规——跳过不扫描，并经 warnings 提示（D4/§1 完整性规则）。
 *
 * .ignore 过滤层（docs/ignore-filter-design.md）：叠加在系统区跳过之后——
 * 系统目录（. 开头 / _inbox / _attachments / 嵌套 .knowbase）先按固有规则跳过，
 * 用户规则对系统区无效（不可被 ! 取反救回）；目录命中 → 整棵剪枝不递归。
 */
function scanMarkdownFiles(root: string, dir: string, out: string[], warnings?: string[], ign?: Ignore | null): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  const atRoot = dir === root
  for (const entry of entries) {
    // D3（P4）：'blog' 不再是内部目录名（博客已收进 .knowbase/blog，由「.」前缀规则跳过）；
    // '_attachments' = 历史遗留根级附件目录，继续跳过
    if (entry.name === '_attachments') continue
    // 收件箱（迁移器草稿区遗留语义）永不入索引：与文件树 APP_INTERNAL_DIRS 同口径
    // （大小写不敏感、任意深度）；.knowbase/_inbox 的显式放行见下方 dot 分支，不受本行影响
    // 注：Web 剪藏草稿已迁至 .knowbase/_draft/clipper（随 . 前缀规则天然跳过，不依赖本行）
    if (entry.isDirectory() && entry.name.toLowerCase() === '_inbox') continue
    const abs = join(dir, entry.name)
    // .ignore 过滤：目录命中整棵剪枝；文件命中不入扫描结果（rel = 仓库内 posix 相对路径）
    if (ign) {
      const rel = relative(root, abs).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (isDirIgnored(ign, rel)) continue
      } else if (entry.isFile() && ign.ignores(rel)) {
        continue
      }
    }
    try {
      if (entry.isSymbolicLink() || lstatSync(abs).isSymbolicLink()) continue
      if (entry.isDirectory()) {
        // P5a：嵌套 .knowbase（非仓库根直属）→ 忽略 + 提示
        if (entry.name === '.knowbase' && !atRoot) {
          warnings?.push(`忽略嵌套仓库目录：${relative(root, abs)}（一个仓库最多一个 .knowbase）`)
          continue
        }
        // . 开头目录 = 系统区（.knowbase 内仅有 _inbox 是知识页收件箱，其余跳过）
        if (entry.name.startsWith('.')) {
          if (entry.name === '.knowbase') {
            const inbox = join(abs, '_inbox')
            if (existsSync(inbox) && lstatSync(inbox).isDirectory()) scanMarkdownFiles(root, inbox, out, warnings, ign)
          }
          continue
        }
        scanMarkdownFiles(root, abs, out, warnings, ign)
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
 *  - dict（迁移器产物）: { "<uuid>": { id,name,type,parent,sortOrder,...,path } }
 *  - array（早期/其它写入路径）: [{ id,name,categoryType,parentId,... }]
 * dict 优先——迁移产物是 dict 且带 path（graph 目录 scope 依赖）。
 */
interface ReadCategoriesResult {
  categories: KnowledgeCategoryIndexEntry[]
  warnings: string[]
  /** 原始条目（按 id）：写回时以此为基底，避免丢掉迁移产物自带的 createdAt 等字段 */
  rawById: Map<string, Record<string, unknown>>
  /** 落盘格式：false = dict（迁移器产物），true = array */
  isArray: boolean
}

function readCategories(): ReadCategoriesResult {
  const raw = readJson<unknown>('modules/knowledge', 'categories.json', [])
  const warnings: string[] = []
  const items: Array<Record<string, unknown>> = []
  const rawById = new Map<string, Record<string, unknown>>()
  let isArray = false
  if (Array.isArray(raw)) {
    isArray = true
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
    if (!rawById.has(id)) rawById.set(id, item)
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
  return { categories, warnings, rawById, isArray }
}

/** 页面仓库相对路径 → 所在目录（posix，根目录为空串） */
function dirRelOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i === -1 ? '' : relPath.slice(0, i)
}

/**
 * 目录即分类：为给定目录链逐段确保分类节点存在（按 path 精确匹配，缺失才建）。
 * 已在 categories 上原地补充；返回新建节点数与「原绑定目录已消失」的失效节点 id。
 *
 * 对账规则（目录被移动 / 重命名 / 删除后仍不产生僵尸或重复节点）：
 *  1. 先失效解绑：path 指向的目录已不存在 → 解绑 path，等后续按「父级 + 目录名」认领
 *  2. 认领优先：同级同名且已解绑（或历史无 path）的节点 → 复用其 id（保住 notebook/space 类型与排序）
 *  3. 仍无节点才新建，一律 folder（语义升级交给用户在知识库改类型）
 */
function ensureDirCategories(
  dirs: string[],
  categories: KnowledgeCategoryIndexEntry[],
  root: string
): { created: number; claimed: number; staleIds: Set<string> } {
  const isDir = (rel: string): boolean => {
    try { return statSync(join(root, rel)).isDirectory() } catch { return false }
  }
  const staleIds = new Set<string>()
  for (const c of categories) {
    if (c.path && !isDir(c.path)) {
      staleIds.add(c.id)
      c.path = undefined
    }
  }

  let created = 0
  let claimed = 0
  for (const dir of dirs) {
    let parentId: string | null = null
    let prefix = ''
    for (const seg of dir.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${seg}` : seg
      let node = categories.find((c) => c.path === prefix)
      if (!node) {
        // 认领：同名且尚未绑定目录的节点（同级优先，其次跨父级——目录被移动到别处时保住原节点 id 与类型）
        node = categories.find((c) => (c.parentId ?? null) === parentId && c.name === seg && !c.path)
          ?? categories.find((c) => c.name === seg && !c.path)
        if (node) {
          node.path = prefix
          if ((node.parentId ?? null) !== parentId) node.parentId = parentId
          claimed++
        }
      }
      if (!node) {
        const maxOrder = categories
          .filter((c) => (c.parentId ?? null) === parentId)
          .reduce((m, c) => Math.max(m, c.sortOrder), -1)
        node = {
          id: randomUUID(),
          name: seg,
          parentId,
          sortOrder: maxOrder + 1,
          categoryType: 'folder',
          path: prefix,
        }
        categories.push(node)
        created++
      }
      parentId = node.id
    }
  }
  return { created, claimed, staleIds }
}

/** 收集分类子树 id（含自身），用于整棵删除已消失的目录分支 */
function collectCategorySubtree(id: string, categories: KnowledgeCategoryIndexEntry[], out: Set<string>): void {
  if (out.has(id)) return
  out.add(id)
  for (const c of categories) if (c.parentId === id) collectCategorySubtree(c.id, categories, out)
}

/** 写回 categories.json：保持原落盘格式（dict/array），以原始条目为基底避免丢字段 */
function writeCategories(
  categories: KnowledgeCategoryIndexEntry[],
  rawById: Map<string, Record<string, unknown>>,
  isArray: boolean
): void {
  if (isArray) {
    const rows = categories.map((c) => {
      const base = rawById.get(c.id) ?? {}
      const row: Record<string, unknown> = {
        ...base,
        id: c.id,
        name: c.name,
        categoryType: c.categoryType,
        parentId: c.parentId,
        sortOrder: c.sortOrder,
      }
      if (c.path) row.path = c.path
      return row
    })
    writeJson('modules/knowledge', 'categories.json', rows)
    return
  }
  const dict: Record<string, unknown> = {}
  for (const c of categories) {
    const base = rawById.get(c.id) ?? {}
    const row: Record<string, unknown> = {
      ...base,
      id: c.id,
      name: c.name,
      type: c.categoryType,
      parent: c.parentId,
      sortOrder: c.sortOrder,
    }
    if (c.path) row.path = c.path
    dict[c.id] = row
  }
  writeJson('modules/knowledge', 'categories.json', dict)
}

/** 删除目录条目（含子孙）并写回 categories.json；磁盘文件夹处置与索引失效由调用方负责（2026-09-07 知识库开放目录删除） */
export function removeCategoryEntries(id: string): void {
  const { categories, rawById, isArray } = readCategories()
  const doomed = new Set<string>()
  collectCategorySubtree(id, categories, doomed)
  writeCategories(categories.filter((c) => !doomed.has(c.id)), rawById, isArray)
}

/** 追加目录条目并写回 categories.json（sortOrder 缺省=同父级末尾）；索引失效由调用方负责（2026-09-07 创建学习空间） */
export function appendCategoryEntry(entry: { id: string; name: string; categoryType: KnowledgeCategoryType; parentId: string | null; sortOrder?: number; path?: string }): void {
  const { categories, rawById, isArray } = readCategories()
  const siblings = categories.filter((c) => (c.parentId ?? null) === (entry.parentId ?? null))
  const sortOrder = entry.sortOrder ?? (siblings.length ? Math.max(...siblings.map((c) => c.sortOrder)) + 1 : 0)
  const node: KnowledgeCategoryIndexEntry = { ...entry, sortOrder }
  rawById.set(entry.id, {})
  writeCategories([...categories, node], rawById, isArray)
}

/** 更新单个目录条目字段并写回（虚拟条目改名等轻量场景）；索引失效由调用方负责 */
export function updateCategoryEntry(id: string, patch: { name?: string; path?: string; sortOrder?: number }): void {
  const { categories, rawById, isArray } = readCategories()
  const c = categories.find((x) => x.id === id)
  if (!c) return
  if (patch.name !== undefined) c.name = patch.name
  if (patch.path !== undefined) c.path = patch.path
  if (patch.sortOrder !== undefined) c.sortOrder = patch.sortOrder
  writeCategories(categories, rawById, isArray)
}

/** 目录改名级联：改条目 name/path，并把子孙条目 path 前缀同步替换；索引失效由调用方负责（2026-09-07 重命名放行） */
export function renameCategoryCascade(id: string, newName: string, oldPath: string, newPath: string): void {
  const { categories, rawById, isArray } = readCategories()
  for (const c of categories) {
    if (c.id === id) { c.name = newName; c.path = newPath }
    else if (oldPath && c.path && c.path.startsWith(oldPath + '/')) c.path = newPath + c.path.slice(oldPath.length)
  }
  writeCategories(categories, rawById, isArray)
}

/** 目录排序（同父级内规范化重编号后与相邻项互换）；索引失效由调用方负责（2026-09-07 排序放行） */
export function moveCategoryOrderInDict(id: string, direction: 'up' | 'down'): void {
  const { categories, rawById, isArray } = readCategories()
  const me = categories.find((c) => c.id === id)
  if (!me) return
  const siblings = categories
    .filter((c) => (c.parentId ?? null) === (me.parentId ?? null))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hans'))
  const i = siblings.findIndex((c) => c.id === id)
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= siblings.length) return
  ;[siblings[i], siblings[j]] = [siblings[j], siblings[i]]
  siblings.forEach((c, order) => { c.sortOrder = order })
  writeCategories(categories, rawById, isArray)
}

/** 目录 → categoryId（path 为准；根目录与未分类收件箱 → null） */
function resolveCategoryIdByPath(relPath: string, categories: KnowledgeCategoryIndexEntry[]): string | null {
  const dir = dirRelOf(relPath)
  if (!dir || dir === KB_INBOX_DIR) return null
  return categories.find((c) => c.path === dir)?.id ?? null
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
  const categories = categoryResult.categories
  let categoriesDirty = false
  const files: string[] = []
  // .ignore 过滤层：规则解析警告随索引 warnings 透出；命中文件/目录不参与索引（连带不参与目录派生分类）
  const ignoreResult: VaultIgnoreResult = getVaultIgnore()
  warnings.push(...ignoreResult.warnings)
  scanMarkdownFiles(current.rootPath, current.rootPath, files, warnings, ignoreResult.ign)

  // 第一遍：读入全部 md（目录派生需先知道「所有知识页所在目录」，再统一补建分类）
  const docs: Array<{ abs: string; rel: string; doc: ReturnType<typeof parseMarkdown> }> = []
  for (const abs of files) {
    try {
      docs.push({
        abs,
        rel: relative(current.rootPath, abs).replace(/\\/g, '/'),
        doc: parseMarkdown(readFileSync(abs, 'utf8')),
      })
    } catch {
      warnings.push(`页面读取失败，已跳过：${relative(current.rootPath, abs)}`)
    }
  }

  // 目录即分类（2026-09-04）：为知识页所在目录补建分类节点，随后按 path 定归属。
  // 编辑器是唯一写入方（vault 模式知识库只读），位置变化一律由文件路径表达。
  const dirs = [...new Set(docs.map((d) => dirRelOf(d.rel)).filter((d) => d && d !== KB_INBOX_DIR))].sort()
  const { created, claimed, staleIds } = ensureDirCategories(dirs, categories, current.rootPath)
  if (created > 0) {
    categoriesDirty = true
    warnings.push(`已按仓库目录补建 ${created} 个分类节点（目录即分类）`)
  }
  // 认领同样要落盘：目录被移动/改名后，节点的 path 与 parentId 已变（不写盘则磁盘与内存分叉）
  if (claimed > 0) categoriesDirty = true

  // 对账收尾：目录已被移动/重命名/删除且无人认领的分类节点 → 整棵子树移除（避免僵尸分类堆积）
  const removedIds = new Set<string>()
  for (const id of staleIds) {
    const node = categories.find((c) => c.id === id)
    if (node && !node.path) collectCategorySubtree(id, categories, removedIds)
  }
  if (removedIds.size > 0) {
    for (const id of removedIds) {
      const i = categories.findIndex((c) => c.id === id)
      if (i !== -1) categories.splice(i, 1)
    }
    categoriesDirty = true
    warnings.push(`已清理 ${removedIds.size} 个目录已消失的分类节点`)
  }
  if (categoriesDirty) writeCategories(categories, categoryResult.rawById, categoryResult.isArray)

  const pages: KnowledgePageIndexEntry[] = []
  const byId: Record<string, KnowledgePageIndexEntry> = {}

  for (const { abs, rel, doc } of docs) {
    try {
      const id = asString(doc.frontmatter.id)
      if (!id) {
        warnings.push(`页面缺少 frontmatter.id，已跳过：${rel}`)
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
        path: rel,
        // path 为准：分类归属由文件所在目录派生，frontmatter.category 不再参与（历史字段，读取即忽略）
        categoryId: resolveCategoryIdByPath(rel, categories),
        tags: asStringArray(doc.frontmatter.tags),
        starred: asString(doc.frontmatter.starred).toLowerCase() === 'true',
        sortOrder: Number.isFinite(Number(doc.frontmatter.sortOrder)) ? Number(doc.frontmatter.sortOrder) : 0,
        fileType: asString(doc.frontmatter.fileType),
        attachmentId: asString(doc.frontmatter.attachmentId),
        createdAt: asString(doc.frontmatter.created),
        updatedAt: asString(doc.frontmatter.updated),
        status: asString(doc.frontmatter.status).toLowerCase() === 'draft' ? 'draft' : 'published',
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
