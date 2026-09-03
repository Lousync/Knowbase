import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, extname, join, relative, sep } from 'path'
import { randomUUID } from 'crypto'
import { getDatabase, getDbPath } from '../database/connection'
import { getAttachmentsDir } from '../database/paths'
import { getCurrentVault, KB_INBOX_DIR, KB_ATTACHMENTS_DIR } from './kbStore/vaultContext'
import { invalidateKnowledgeIndex } from './kbStore/knowledgeIndex'
import { invalidateGraphIndex } from './kbStore/graphIndex'
import { parseMarkdown } from './kbStore/mdStore'

/**
 * 旧 SQLite → 当前 Vault 的一次性迁移（去库化 P0 收官件）。
 * 逻辑逐行移植自 scripts/migrate-to-vault.mjs（已对真实仓库 430 文件验证），
 * 三处应用内适配：
 *  1. 读源从 node:sqlite 改为 getDatabase()（sql.js 内存库，saveToDisk 原子写保证磁盘库完整可救）
 *  2. 目标仓库 = 当前仓库（getCurrentVault），不再吃 CLI 参数
 *  3. 进度经 onProgress 回调外推（repo 层转 webContents.send），本模块不依赖 Electron
 * 安全底线（.AGENT/docs/去库化迁移方案.md §六）：
 *  导入前自动备份 knowledge.db → .pre-vault.bak（改名零拷贝）；全程只读源库；
 *  默认跳过已存在文件（overwrite 才覆盖）；绝不删库。
 */

// ---------------------------------------------------------------- 工具（移植）

const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i
const MAX_PATH = 235

function safeName(raw: unknown, fallback = 'untitled'): string {
  let s = String(raw ?? '').replace(/\r?\n/g, ' ').trim()
  s = s.replace(ILLEGAL, '_').replace(/\s+/g, ' ')
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (!s) s = fallback
  if (RESERVED.test(s)) s = `_${s}`
  return s
}

/** 唯一名分配器（Windows 大小写不敏感） */
function makeAllocator() {
  const used = new Set<string>()
  return (dirKey: string, name: string, ext = ''): string => {
    let base = name
    let n = 1
    let candidate = base + ext
    const budget = MAX_PATH - String(dirKey).length - 1
    if (candidate.length > budget) {
      base = base.slice(0, Math.max(1, budget - ext.length))
      candidate = base + ext
    }
    while (used.has(`${dirKey.toLowerCase()}/${candidate.toLowerCase()}`)) {
      n += 1
      const suffix = ` (${n})`
      const cut = Math.max(1, budget - ext.length - suffix.length)
      candidate = base.slice(0, cut) + suffix + ext
    }
    used.add(`${dirKey.toLowerCase()}/${candidate.toLowerCase()}`)
    return candidate
  }
}

const toPosix = (p: string): string => p.split(sep).join('/')

/** frontmatter 序列化——严格镜像 kbStore/mdStore.ts，保证可被 parseFrontmatter 读回 */
function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      if (v.every((x) => typeof x === 'string' && !/[:,]/.test(x) && !x.includes("'"))) {
        lines.push(`${k}: [${v.join(', ')}]`)
      } else {
        lines.push(`${k}:`)
        for (const it of v) lines.push(`  - ${String(it).replace(/\n/g, ' ')}`)
      }
    } else if (typeof v === 'string') {
      lines.push(`${k}: ${/^[\w\u4e00-\u9fa5\s.\-]+$/.test(v) ? v : JSON.stringify(v)}`)
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  if (lines.length === 0) return body
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

/**
 * 旧迁移产物补写（P1 博客）：早期迁移器导出的 blog/*.md 缺 tags/states/pinned/
 * starred/wordCount/updated frontmatter → 从 sqlite entries/entry_tags 补写。
 * 幂等：字段齐全的文件跳过；仅补缺失键，不覆盖既有内容。
 */
function backfillLegacyBlogMeta(rootPath: string): number {
  const blogDir = join(rootPath, 'blog')
  if (!existsSync(blogDir)) return 0
  const hasBlogTable = tableExists('entries')
  if (!hasBlogTable) return 0
  const srcById = new Map<string, Record<string, unknown>>()
  for (const r of all<Record<string, unknown>>('select id, states, is_pinned, is_starred, word_count, updated_at from entries')) {
    srcById.set(String(r.id), r)
  }
  const tagNameById = new Map<string, string>()
  if (tableExists('tags')) {
    for (const r of all<{ id: string; name: string }>('select id, name from tags')) tagNameById.set(r.id, r.name)
  }
  const tagsByEntry = new Map<string, string[]>()
  if (tableExists('entry_tags')) {
    for (const r of all<{ entry_id: string; tag_id: string }>('select entry_id, tag_id from entry_tags')) {
      const nm = tagNameById.get(r.tag_id)
      if (!nm) continue
      if (!tagsByEntry.has(r.entry_id)) tagsByEntry.set(r.entry_id, [])
      tagsByEntry.get(r.entry_id)!.push(nm)
    }
  }
  let touched = 0
  const walk = (dir: string): void => {
    let names: string[] = []
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      const p = join(dir, n)
      let isDir = false
      try { isDir = statSync(p).isDirectory() } catch { continue }
      if (isDir) { walk(p); continue }
      if (!n.toLowerCase().endsWith('.md')) continue
      try {
        const md = parseMarkdown(readFileSync(p, 'utf-8'))
        const id = md.frontmatter?.id
        if (typeof id !== 'string' || !srcById.has(id)) continue
        const src = srcById.get(id)!
        const fm = { ...md.frontmatter }
        const missing = (k: string): boolean => !(k in fm) || fm[k] === undefined || fm[k] === null
        // 仅补「有实际值却缺失」的键：空 states / false pinned / false starred / wordCount 0 在 md 中本就省略
        const tags = tagsByEntry.get(id) ?? []
        const states = String(src.states || '')
        const pinned = Number(src.is_pinned) !== 0
        const starred = Number(src.is_starred) !== 0
        const word = src.word_count === null || src.word_count === undefined ? 0 : Number(src.word_count)
        const updated = String(src.updated_at || '')
        const wantTags = tags.length > 0 && missing('tags')
        const wantStates = !!states && missing('states')
        const wantPinned = pinned && missing('pinned')
        const wantStarred = starred && missing('starred')
        const wantWord = word > 0 && missing('wordCount')
        const wantUpdated = !!updated && missing('updated')
        if (!wantTags && !wantStates && !wantPinned && !wantStarred && !wantWord && !wantUpdated) continue
        if (wantTags) fm.tags = tags
        if (wantStates) fm.states = states
        if (wantPinned) fm.pinned = 'true'
        if (wantStarred) fm.starred = 'true'
        if (wantWord) fm.wordCount = String(word)
        if (wantUpdated) fm.updated = updated
        const tmp = join(dir, `.${randomUUID()}.tmp`)
        writeFileSync(tmp, serializeFrontmatter(fm, md.body), 'utf-8')
        try { renameSync(tmp, p) } catch { if (existsSync(p)) unlinkSync(p); renameSync(tmp, p) }
        touched++
      } catch { /* 跳过坏文件 */ }
    }
  }
  walk(blogDir)
  return touched
}
const normalize = (s: unknown): string => String(s ?? '').replace(/\r\n/g, '\n')

function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDatabase().prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function tableExists(name: string): boolean {
  try {
    return all(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [name]).length > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 公共类型

interface CatRow {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
  category_type: string
  created_at: string
  updated_at: string
}

export interface LegacySummary {
  hasLegacy: boolean
  categories: number
  pages: number
  pagesEmpty: number
  blogEntries: number
  attachments: number
  attachmentBytes: number
}

export interface ImportOptions {
  overwrite?: boolean
  extractSvg?: boolean
  /** 跳过附件复制（只迁内容与元数据，验证/重跑用） */
  skipAttachments?: boolean
}

export interface ImportProgress {
  phase: 'plan' | 'backup' | 'write' | 'copy' | 'done' | 'error'
  current: number
  total: number
  message?: string
}

export interface MigrationReport {
  generatedAt: string
  vault: string
  options: ImportOptions
  stats: Record<string, unknown>
  warnings: string[]
  conflicts: string[]
  result: { written: number; copied: number; skipped: number }
}

// ---------------------------------------------------------------- 旧数据摘要

/** 旧 SQLite 数据摘要（供引导页/设置页展示；表缺失按 0 计，兼容新旧库） */
export function legacySummary(): LegacySummary {
  const count = (table: string): number => (tableExists(table) ? Number((all(`SELECT COUNT(*) AS n FROM ${table}`)[0] as Record<string, unknown>)?.n ?? 0) : 0)
  const pages = Number(count('knowledge_pages'))
  const attachments = Number(count('attachments'))
  let attachmentBytes = 0
  if (tableExists('attachments')) {
    try {
      attachmentBytes = Number(all('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM attachments')[0]?.n ?? 0)
    } catch { /* ignore */ }
  }
  return {
    hasLegacy: pages > 0 || Number(count('entries')) > 0,
    categories: Number(count('knowledge_categories')),
    pages,
    pagesEmpty: tableExists('knowledge_pages')
      ? Number(all(`SELECT COUNT(*) AS n FROM knowledge_pages WHERE COALESCE(TRIM(content_md), '') = ''`)[0]?.n ?? 0)
      : 0,
    blogEntries: Number(count('entries')),
    attachments,
    attachmentBytes,
  }
}

// ---------------------------------------------------------------- 迁移主流程

interface PlannedFile { path: string; content: string | Buffer }
interface PlannedCopy { from: string; to: string }

export function runLegacyImport(opts: ImportOptions = {}, onProgress?: (p: ImportProgress) => void): MigrationReport {
  const { overwrite = false, extractSvg = false, skipAttachments = false } = opts
  const current = getCurrentVault()
  if (!current) throw new Error('当前没有打开的仓库，无法导入')
  const VAULT = current.rootPath
  const relFromVault = (abs: string): string => toPosix(relative(VAULT, abs))
  const progress = (phase: ImportProgress['phase'], cur: number, total: number, message?: string): void => {
    try { onProgress?.({ phase, current: cur, total, message }) } catch { /* 回调异常不中断迁移 */ }
  }

  // 源库完整性与仓库有效性
  const metaPath = join(VAULT, '.knowbase', 'meta.json')
  const warnings: string[] = []
  if (!existsSync(metaPath)) warnings.push('仓库缺少 .knowbase/meta.json，可能不是有效的 Vault')

  const stats: Record<string, unknown> = {}
  const plan: { files: PlannedFile[]; copies: PlannedCopy[]; dirs: Set<string> } = { files: [], copies: [], dirs: new Set() }
  const planDir = (abs: string): void => { plan.dirs.add(abs) }
  const planFile = (abs: string, content: string | Buffer): string => {
    plan.files.push({ path: abs, content })
    planDir(dirname(abs))
    return abs
  }
  const planCopy = (from: string, to: string): string => { plan.copies.push({ from, to }); planDir(dirname(to)); return to }
  const planJson = (abs: string, data: unknown): string => planFile(abs, JSON.stringify(data, null, 2) + '\n')
  const planTable = (table: string, abs: string): void => {
    if (!tableExists(table)) { warnings.push(`源库缺少表 ${table}，已跳过`); return }
    try { planJson(abs, all(`SELECT * FROM ${table}`)) } catch (e) { warnings.push(`读取表 ${table} 失败：${(e as Error).message}`) }
  }

  // ===== 0. 导入前备份：knowledge.db → knowledge.db.pre-vault.bak（改名零拷贝）=====
  progress('backup', 0, 1, '备份旧数据库')
  const bakPath = backupLegacyDatabase(getDbPath())
  if (bakPath) warnings.push(`旧数据库已备份为 ${bakPath.split(/[\\/]/).pop()}（导入完成后仍可回滚 sqlite 读源）`)
  const ATT_DIR = getAttachmentsDir()

  // ===== 1. 知识库分类树 =====
  progress('plan', 0, 4, '读取分类树')
  const cats = all<CatRow>(
    'select id, name, parent_id, sort_order, category_type, created_at, updated_at from knowledge_categories'
  )
  const catEntries: Array<[string, CatRow]> = cats.map((c) => [c.id, c])
  const catById = new Map<string, CatRow>(catEntries)
  const chainOf = (id: string): CatRow[] => {
    const chain: CatRow[] = []
    let cur: string | null = id
    let guard = 0
    while (cur && guard++ < 64) {
      const cat = catById.get(cur)
      if (!cat) break
      chain.unshift(cat)
      cur = cat.parent_id
    }
    return chain
  }
  const allocDir = makeAllocator()
  const dirOfCat = new Map<string, string>()
  const catIndex: Record<string, unknown> = {}
  for (const c of [...cats].sort((a, b) => chainOf(a.id).length - chainOf(b.id).length)) {
    const parent = (c.parent_id && dirOfCat.get(c.parent_id)) || VAULT
    const name = allocDir(parent, safeName(c.name, c.category_type || 'folder'))
    const abs = join(parent, name)
    dirOfCat.set(c.id, abs)
    catIndex[c.id] = {
      id: c.id, name: c.name, type: c.category_type, parent: c.parent_id || null,
      sortOrder: c.sort_order, createdAt: c.created_at, updatedAt: c.updated_at, path: relFromVault(abs),
    }
  }
  stats.categories = cats.length

  // ===== 2. 附件 =====
  progress('plan', 1, 4, '规划附件')
  const atts = tableExists('attachments')
    ? all<{ id: string; owner_type: string; owner_id: string; file_path: string; file_name: string; size_bytes: number; trashed: number }>(
      'select * from attachments where coalesce(trashed, 0) = 0'
    )
    : []
  const attByOwner = new Map<string, typeof atts>()
  const attById = new Map<string, (typeof atts)[number]>()
  const allocAtt = makeAllocator()
  for (const a of atts) {
    attById.set(a.id, a)
    const key = `${a.owner_type}:${a.owner_id}`
    if (!attByOwner.has(key)) attByOwner.set(key, [])
    attByOwner.get(key)!.push(a)
    const src = join(ATT_DIR, a.file_path)
    if (!existsSync(src)) { warnings.push(`附件缺失，已跳过：${a.file_name} (${a.file_path})`); continue }
    const dir = join(VAULT, KB_ATTACHMENTS_DIR, safeName(a.owner_type, 'misc'), safeName(a.owner_id, 'unknown'))
    // 扩展名先拆再拼回，避免 safeName 净化后重复追加导致 .jpg.jpg
    const rawName = a.file_name || ''
    const ext = extname(rawName)
    const stem = ext ? rawName.slice(0, -ext.length) : rawName
    const name = allocAtt(dir, safeName(stem, a.id), ext)
    const dst = join(dir, name)
    if (!skipAttachments) planCopy(src, dst)
    ;(a as Record<string, unknown>).__dst = dst
  }
  stats.attachments = atts.length
  stats.attachmentBytes = atts.reduce((n, a) => n + (Number(a.size_bytes) || 0), 0)

  // ===== 3. 知识库页面 =====
  progress('plan', 2, 4, '规划知识页')
  const pages = tableExists('knowledge_pages')
    ? all<{ id: string; title: string; content_md: string; category_id: string | null; is_starred: number; sort_order: number; created_at: string; updated_at: string }>(
      'select * from knowledge_pages'
    )
    : []
  const tagById = new Map(
    (tableExists('knowledge_tags') ? all<{ id: string; name: string }>('select id, name from knowledge_tags') : []).map((t) => [t.id, t])
  )
  const tagsOfPage = new Map<string, string[]>()
  for (const r of tableExists('knowledge_page_tags') ? all<{ page_id: string; tag_id: string }>('select page_id, tag_id from knowledge_page_tags') : []) {
    if (!tagsOfPage.has(r.page_id)) tagsOfPage.set(r.page_id, [])
    const t = tagById.get(r.tag_id)
    if (t) tagsOfPage.get(r.page_id)!.push(t.name)
  }
  const allocPage = makeAllocator()
  const pageIndex: Record<string, unknown> = {}
  let extractedSvgs = 0
  for (const p of pages) {
    const dir = (p.category_id && dirOfCat.get(p.category_id)) || join(VAULT, KB_INBOX_DIR)
    if (!p.category_id) planDir(dir)
    const name = allocPage(dir, safeName(p.title, p.id), '.md')
    const abs = join(dir, name)
    let body = normalize(p.content_md)
    body = body.replace(/attachment:\/\/([0-9a-fA-F-]{36})\/?/g, (full, id: string) => {
      const a = attById.get(id) as (Record<string, unknown> & { __dst?: string }) | undefined
      if (!a || !a.__dst) return full
      return toPosix(relative(dir, a.__dst))
    })
    if (extractSvg) {
      let n = 0
      body = body.replace(/!\[([^\]]*)\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)/g, (m, alt: string, b64: string) => {
        n += 1
        const dir2 = join(VAULT, KB_ATTACHMENTS_DIR, 'inline', safeName(p.id))
        const fn = allocPage(dir2, `img-${n}`, '.svg')
        const dst = join(dir2, fn)
        try {
          planFile(dst, Buffer.from(b64, 'base64').toString('binary'))
        } catch {
          warnings.push(`SVG 解码失败，保留内联：页面「${p.title}」第 ${n} 张`)
          return m
        }
        extractedSvgs += 1
        return `![${alt}](${toPosix(relative(dir, dst))})`
      })
    }
    const own = (attByOwner.get(`knowledge_page:${p.id}`) || []).filter((a) => (a as Record<string, unknown>).__dst)
    const fm: Record<string, unknown> = {
      id: p.id,
      title: p.title,
      category: p.category_id || '',
      tags: tagsOfPage.get(p.id) || [],
      starred: Number(p.is_starred) ? 'true' : '',
      sortOrder: p.sort_order === null || p.sort_order === undefined ? '' : String(p.sort_order),
      created: p.created_at || '',
      updated: p.updated_at || '',
      attachments: own.map((a) => relFromVault((a as Record<string, unknown>).__dst as string)),
    }
    planFile(abs, serializeFrontmatter(fm, body))
    pageIndex[p.id] = {
      id: p.id, title: p.title, path: relFromVault(abs), category: p.category_id || null,
      tags: tagsOfPage.get(p.id) || [], starred: !!Number(p.is_starred),
      attachments: own.map((a) => relFromVault((a as Record<string, unknown>).__dst as string)),
    }
  }
  stats.pages = pages.length
  stats.pagesEmpty = pages.filter((p) => !String(p.content_md || '').trim()).length
  stats.extractedSvgs = extractedSvgs

  // ===== 4. 博客 =====
  progress('plan', 3, 4, '规划博客')
  const entries = tableExists('entries')
    ? all<{ id: string; title: string; content_md: string; date: string; is_pinned: number; is_starred: number; states: string; word_count: number | null; created_at: string; updated_at: string }>(
      'select * from entries'
    )
    : []
  const blogTagById = new Map(
    (tableExists('tags') ? all<{ id: string; name: string }>('select id, name from tags') : []).map((t) => [t.id, t])
  )
  const tagsOfEntry = new Map<string, string[]>()
  for (const r of tableExists('entry_tags') ? all<{ entry_id: string; tag_id: string }>('select entry_id, tag_id from entry_tags') : []) {
    if (!tagsOfEntry.has(r.entry_id)) tagsOfEntry.set(r.entry_id, [])
    const t = blogTagById.get(r.tag_id)
    if (t) tagsOfEntry.get(r.entry_id)!.push(t.name)
  }
  const allocBlog = makeAllocator()
  const blogIndex: Record<string, unknown> = {}
  const blogRoot = join(VAULT, 'blog')
  for (const e of entries) {
    const date = String(e.date || e.created_at || '').slice(0, 10) || '1970-01-01'
    const year = date.slice(0, 4)
    const dir = join(blogRoot, year)
    const title = safeName(e.title, e.id)
    const base = title.startsWith(date) ? title : `${date}-${title}`
    const name = allocBlog(dir, base, '.md')
    const abs = join(dir, name)
    const fm: Record<string, unknown> = {
      id: e.id, title: e.title, date, tags: tagsOfEntry.get(e.id) || [],
      pinned: Number(e.is_pinned) ? 'true' : '', starred: Number(e.is_starred) ? 'true' : '',
      states: e.states || '',
      wordCount: e.word_count === null || e.word_count === undefined ? '' : String(e.word_count),
      created: e.created_at || '', updated: e.updated_at || '',
    }
    planFile(abs, serializeFrontmatter(fm, normalize(e.content_md)))
    blogIndex[e.id] = { id: e.id, title: e.title, date, path: relFromVault(abs) }
  }
  stats.blogEntries = entries.length

  // ===== 5. 其余结构化模块 =====
  progress('plan', 4, 4, '规划模块数据')
  const K = join(VAULT, '.knowbase', 'modules')
  planJson(join(K, 'knowledge', 'categories.json'), catIndex)
  planJson(join(K, 'knowledge', 'pages.json'), pageIndex)
  planTable('knowledge_tags', join(K, 'knowledge', 'tags.json'))
  planTable('knowledge_page_tags', join(K, 'knowledge', 'page-tags.json'))
  planTable('knowledge_pack_imports', join(K, 'knowledge', 'pack-imports.json'))
  planJson(join(K, 'blog', 'entries.json'), blogIndex)
  planTable('tags', join(K, 'blog', 'tags.json'))
  planTable('moments_posts', join(K, 'moments', 'posts.json'))
  planTable('moments_albums', join(K, 'moments', 'albums.json'))
  planTable('schedule_todos', join(K, 'schedule', 'todos.json'))
  planTable('schedule_tags', join(K, 'schedule', 'tags.json'))
  planTable('toolbox_passwords', join(K, 'toolbox', 'passwords.json'))
  planTable('toolbox_weight_records', join(K, 'toolbox', 'weight.json'))
  planTable('bookmarks', join(K, 'bookmarks', 'bookmarks.json'))
  planTable('bookmark_categories', join(K, 'bookmarks', 'categories.json'))
  planTable('study_sets', join(K, 'study', 'sets.json'))
  planTable('study_items', join(K, 'study', 'items.json'))
  planTable('habits', join(K, 'habits.json'))
  planTable('supervise_config', join(K, 'supervise', 'config.json'))
  planTable('supervise_log', join(K, 'supervise', 'log.json'))
  planTable('agent_sessions', join(K, 'agent', 'sessions.json'))
  planTable('agent_messages', join(K, 'agent', 'messages.json'))
  planTable('recycle_bin', join(K, 'recycle-bin.json'))
  if (tableExists('user_profile')) {
    try { planJson(join(K, 'user.json'), all('select id, username, avatar_path, created_at, updated_at from user_profile')) } catch { /* ignore */ }
  }

  // ===== 6. 元信息 =====
  let meta: Record<string, unknown> = {}
  try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch { /* 不存在或损坏 → 重建 */ }

  // ===== 7. 冲突检查 =====
  const conflicts: string[] = []
  const allTargets = [...plan.files.map((f) => f.path), ...plan.copies.map((c) => c.to)]
  for (const t of allTargets) {
    if (existsSync(t) && !overwrite) conflicts.push(relFromVault(t))
  }
  stats.targets = allTargets.length
  stats.conflicts = conflicts.length

  // ===== 8. 写盘 =====
  let written = 0
  let copied = 0
  let skipped = 0
  progress('write', 0, plan.files.length, '写入内容文件')
  for (const dir of [...plan.dirs].sort((a, b) => a.length - b.length)) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  let i = 0
  for (const f of plan.files) {
    if (existsSync(f.path) && !overwrite) { skipped += 1; continue }
    const tmp = join(dirname(f.path), `.${randomUUID()}.tmp`)
    writeFileSync(tmp, f.content, 'utf-8')
    try { renameSync(tmp, f.path) } catch {
      if (existsSync(f.path)) unlinkSync(f.path)
      renameSync(tmp, f.path)
    }
    written += 1
    i += 1
    if (i % 20 === 0 || i === plan.files.length) progress('write', i, plan.files.length, '写入内容文件')
  }
  progress('copy', 0, plan.copies.length, '复制附件')
  let j = 0
  for (const c of plan.copies) {
    if (existsSync(c.to) && !overwrite) { skipped += 1; continue }
    copyFileSync(c.from, c.to)
    copied += 1
    j += 1
    if (j % 10 === 0 || j === plan.copies.length) progress('copy', j, plan.copies.length, '复制附件')
  }
  // ===== 9. 旧产物补写（早期迁移器导出缺 tags/states 等的 blog md，幂等只补缺失键）=====
  let backfilledBlog = 0
  try { backfilledBlog = backfillLegacyBlogMeta(VAULT) } catch { /* 补写失败不阻断导入 */ }
  if (backfilledBlog > 0) warnings.push(`博客 frontmatter 补写完成：${backfilledBlog} 篇`)

  const nextMeta = {
    ...meta,
    schemaVersion: (meta.schemaVersion as number | undefined) ?? 1,
    migratedAt: new Date().toISOString(),
    migratedFrom: { counts: stats },
  }
  mkdirSync(dirname(metaPath), { recursive: true })
  writeFileSync(metaPath, JSON.stringify(nextMeta, null, 2) + '\n')

  const report: MigrationReport = {
    generatedAt: new Date().toISOString(),
    // 渲染层永不接触绝对路径：报告只带仓库名，绝对路径只落盘 .knowbase/migration-report.json
    vault: current.name,
    options: { overwrite, extractSvg, skipAttachments },
    stats,
    warnings,
    conflicts: conflicts.slice(0, 200),
    result: { written, copied, skipped },
  }
  mkdirSync(dirname(join(VAULT, '.knowbase', 'migration-report.json')), { recursive: true })
  writeFileSync(join(VAULT, '.knowbase', 'migration-report.json'), JSON.stringify(report, null, 2), 'utf-8')
  // 导入改变了仓库内容，知识索引立即失效
  invalidateKnowledgeIndex()
  invalidateGraphIndex()
  progress('done', 1, 1, `写入 ${written} · 复制 ${copied} · 跳过 ${skipped}`)
  return report
}

/** 导入前备份：磁盘上的 knowledge.db 改名为 .pre-vault.bak（零拷贝；sql.js 内存库不受影响，下次 saveToDisk 会重建文件） */
export function backupLegacyDatabase(dbPath: string): string | null {
  const bak = `${dbPath}.pre-vault.bak`
  if (!existsSync(dbPath)) return null
  if (existsSync(bak)) return bak // 已有备份不覆盖
  try {
    renameSync(dbPath, bak)
    return bak
  } catch {
    try { copyFileSync(dbPath, bak); return bak } catch { return null }
  }
}
