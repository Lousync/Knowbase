#!/usr/bin/env node
/**
 * 旧数据库 → 新 Vault 的一次性迁移脚本。
 *
 * 背景：Vault 化重构（阶段 0/1/3）落地后，应用有了「仓库」概念（E:\knowledge），
 * 但所有业务数据仍在 SQLite（%APPDATA%\knowbase\data\knowledge.db），两者之间没有
 * 任何同步通道——迁移属于路线图「阶段 7」。本脚本就是那个阶段 7 的第一版。
 *
 * 用法：
 *   node scripts/migrate-to-vault.mjs                       # 预演（只读，不落盘）
 *   node scripts/migrate-to-vault.mjs --apply               # 真正写入
 *   node scripts/migrate-to-vault.mjs --apply --extract-svg # 顺带把内联 SVG 抽成文件
 *   node scripts/migrate-to-vault.mjs --vault D:\other --overwrite
 *
 * 参数：
 *   --vault <dir>         仓库根目录，默认 E:\knowledge
 *   --db <file>           源数据库，默认 %APPDATA%\knowbase\data\knowledge.db
 *   --attachments <dir>   源附件目录，默认 %APPDATA%\knowbase\attachments
 *   --report <file>       报告输出路径（预演默认 tmp/migration-report.json）
 *   --apply               真正写盘；不加则只预演
 *   --extract-svg         把正文里的 data:image/svg+xml;base64 抽成独立 .svg
 *   --overwrite           目标文件已存在时覆盖（默认跳过并记入报告）
 *
 * 产物布局：
 *   <Vault>/<空间>/<笔记本>/<文件夹>/<页面>.md     知识库，带 frontmatter
 *   <Vault>/_inbox/<页面>.md                       无分类的零散页
 *   <Vault>/blog/<年>/<日期>-<标题>.md             博客
 *   <Vault>/_attachments/<owner_type>/<owner_id>/<文件名>
 *   <Vault>/.knowbase/modules/**.json              其余结构化模块
 *   <Vault>/.knowbase/migration-report.json        本次迁移报告
 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const APPDATA = process.env.APPDATA || ''
const VAULT = resolve(opt('vault', 'E:\\knowledge'))
const DB_PATH = resolve(opt('db', join(APPDATA, 'knowbase', 'data', 'knowledge.db')))
const ATT_DIR = resolve(opt('attachments', join(APPDATA, 'knowbase', 'attachments')))
const APPLY = flag('apply')
const EXTRACT_SVG = flag('extract-svg')
const OVERWRITE = flag('overwrite')
/** 只迁内容与元数据，跳过 491MB 附件复制（验证 / 重跑内容时用） */
const SKIP_ATTACHMENTS = flag('skip-attachments')
const PROJECT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const REPORT_PATH = resolve(opt('report', APPLY ? join(VAULT, '.knowbase', 'migration-report.json') : join(PROJECT, 'tmp', 'migration-report.json')))

// ---------------------------------------------------------------- 工具

const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i
const MAX_PATH = 235

/** Windows 安全文件名 */
function safeName(raw, fallback = 'untitled') {
  let s = String(raw ?? '').replace(/\r?\n/g, ' ').trim()
  s = s.replace(ILLEGAL, '_').replace(/\s+/g, ' ')
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (!s) s = fallback
  if (RESERVED.test(s)) s = `_${s}`
  return s
}

/** 唯一名分配器（Windows 大小写不敏感） */
function makeAllocator() {
  const used = new Set()
  return (dirKey, name, ext = '') => {
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

const toPosix = (p) => p.split(sep).join('/')
const relFromVault = (abs) => toPosix(relative(VAULT, abs))

/** frontmatter 序列化——严格镜像 electron/lib/kbStore/mdStore.ts，保证可被 parseFrontmatter 读回 */
function serializeFrontmatter(fm, body) {
  const lines = []
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

const normalize = (s) => String(s ?? '').replace(/\r\n/g, '\n')

// ---------------------------------------------------------------- 计划收集

const plan = { files: [], copies: [], dirs: new Set() }
const warnings = []
const stats = {}

function planDir(abs) {
  plan.dirs.add(abs)
}
function planFile(abs, content) {
  plan.files.push({ path: abs, content })
  planDir(dirname(abs))
  return abs
}
function planCopy(from, to) {
  plan.copies.push({ from, to })
  planDir(dirname(to))
  return to
}
function planJson(abs, data) {
  return planFile(abs, JSON.stringify(data, null, 2) + '\n')
}

// ---------------------------------------------------------------- 读源库

if (!existsSync(DB_PATH)) {
  console.error(`[错误] 找不到源数据库：${DB_PATH}`)
  process.exit(1)
}
if (!existsSync(VAULT)) {
  console.error(`[错误] 仓库目录不存在：${VAULT}`)
  process.exit(1)
}
const metaPath = join(VAULT, '.knowbase', 'meta.json')
if (!existsSync(metaPath)) {
  warnings.push(`仓库缺少 .knowbase/meta.json，可能不是有效的 Vault：${VAULT}`)
}

const db = new DatabaseSync(DB_PATH, { readOnly: true })
const all = (sql, params = []) => db.prepare(sql).all(...params)

// ---------------------------------------------------------------- 1. 知识库分类树

const cats = all('select id, name, parent_id, sort_order, category_type, created_at, updated_at from knowledge_categories')
const catById = new Map(cats.map((c) => [c.id, c]))

function chainOf(id) {
  const chain = []
  let cur = id
  let guard = 0
  while (cur && catById.has(cur) && guard++ < 64) {
    const node = catById.get(cur)
    chain.unshift(node)
    cur = node.parent_id
  }
  return chain
}

const allocDir = makeAllocator()
const dirOfCat = new Map()
const catIndex = {}

for (const c of [...cats].sort((a, b) => chainOf(a.id).length - chainOf(b.id).length)) {
  const parent = c.parent_id && dirOfCat.has(c.parent_id) ? dirOfCat.get(c.parent_id) : VAULT
  const name = allocDir(parent, safeName(c.name, c.category_type || 'folder'))
  const abs = join(parent, name)
  dirOfCat.set(c.id, abs)
  catIndex[c.id] = {
    id: c.id,
    name: c.name,
    type: c.category_type,
    parent: c.parent_id || null,
    sortOrder: c.sort_order,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    path: relFromVault(abs),
  }
}
stats.categories = cats.length
stats.categoryTypes = cats.reduce((m, c) => ({ ...m, [c.category_type]: (m[c.category_type] || 0) + 1 }), {})

// ---------------------------------------------------------------- 2. 附件

const atts = all('select * from attachments where coalesce(trashed, 0) = 0')
const attByOwner = new Map()
const attById = new Map()
const allocAtt = makeAllocator()

for (const a of atts) {
  attById.set(a.id, a)
  const key = `${a.owner_type}:${a.owner_id}`
  if (!attByOwner.has(key)) attByOwner.set(key, [])
  attByOwner.get(key).push(a)

  const src = join(ATT_DIR, a.file_path)
  if (!existsSync(src)) {
    warnings.push(`附件缺失，已跳过：${a.file_name} (${a.file_path})`)
    continue
  }
  const dir = join(VAULT, '_attachments', safeName(a.owner_type, 'misc'), safeName(a.owner_id, 'unknown'))
  // 扩展名单独拆出再拼回，避免 safeName 净化后重复追加导致 .jpg.jpg
  const rawName = a.file_name || ''
  const ext = extname(rawName)
  const stem = ext ? rawName.slice(0, -ext.length) : rawName
  const name = allocAtt(dir, safeName(stem, a.id), ext)
  const dst = join(dir, name)
  if (!SKIP_ATTACHMENTS) planCopy(src, dst)
  a.__dst = dst
}
stats.attachments = atts.length
stats.attachmentBytes = atts.reduce((n, a) => n + (Number(a.size_bytes) || 0), 0)

// ---------------------------------------------------------------- 3. 知识库页面

const pages = all('select * from knowledge_pages')
const tagById = new Map(all('select id, name, color from knowledge_tags').map((t) => [t.id, t]))
const tagsOfPage = new Map()
for (const r of all('select page_id, tag_id from knowledge_page_tags')) {
  if (!tagsOfPage.has(r.page_id)) tagsOfPage.set(r.page_id, [])
  const t = tagById.get(r.tag_id)
  if (t) tagsOfPage.get(r.page_id).push(t.name)
}

const allocPage = makeAllocator()
const pageIndex = {}
let extractedSvgs = 0

for (const p of pages) {
  const dir = (p.category_id && dirOfCat.get(p.category_id)) || join(VAULT, '_inbox')
  if (!p.category_id) planDir(dir)
  const name = allocPage(dir, safeName(p.title, p.id), '.md')
  const abs = join(dir, name)

  let body = normalize(p.content_md)

  // attachment://<uuid>/ → 相对路径
  body = body.replace(/attachment:\/\/([0-9a-fA-F-]{36})\/?/g, (full, id) => {
    const a = attById.get(id)
    if (!a || !a.__dst) return full
    return toPosix(relative(dir, a.__dst))
  })

  // 内联 SVG：可选抽取
  if (EXTRACT_SVG) {
    let n = 0
    body = body.replace(/!\[([^\]]*)\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)/g, (_m, alt, b64) => {
      n += 1
      const dir2 = join(VAULT, '_attachments', 'inline', safeName(p.id))
      const fn = allocPage(dir2, `img-${n}`, '.svg')
      const dst = join(dir2, fn)
      try {
        planFile(dst, Buffer.from(b64, 'base64'))
      } catch {
        warnings.push(`SVG 解码失败，保留内联：页面「${p.title}」第 ${n} 张`)
        return _m
      }
      extractedSvgs += 1
      return `![${alt}](${toPosix(relative(dir, dst))})`
    })
  }

  const own = (attByOwner.get(`knowledge_page:${p.id}`) || []).filter((a) => a.__dst)
  const fm = {
    id: p.id,
    title: p.title,
    category: p.category_id || '',
    tags: tagsOfPage.get(p.id) || [],
    starred: Number(p.is_starred) ? 'true' : '',
    sortOrder: p.sort_order === null || p.sort_order === undefined ? '' : String(p.sort_order),
    created: p.created_at || '',
    updated: p.updated_at || '',
    attachments: own.map((a) => relFromVault(a.__dst)),
  }
  planFile(abs, serializeFrontmatter(fm, body))
  pageIndex[p.id] = {
    id: p.id,
    title: p.title,
    path: relFromVault(abs),
    category: p.category_id || null,
    tags: tagsOfPage.get(p.id) || [],
    starred: !!Number(p.is_starred),
    attachments: own.map((a) => relFromVault(a.__dst)),
  }
}
stats.pages = pages.length
stats.pagesEmpty = pages.filter((p) => !String(p.content_md || '').trim()).length
stats.extractedSvgs = extractedSvgs

// ---------------------------------------------------------------- 4. 博客

const entries = all('select * from entries')
const blogTagById = new Map(all('select id, name, color from tags').map((t) => [t.id, t]))
const tagsOfEntry = new Map()
for (const r of all('select entry_id, tag_id from entry_tags')) {
  if (!tagsOfEntry.has(r.entry_id)) tagsOfEntry.set(r.entry_id, [])
  const t = blogTagById.get(r.tag_id)
  if (t) tagsOfEntry.get(r.entry_id).push(t.name)
}
const allocBlog = makeAllocator()
const blogIndex = {}
const blogRoot = join(VAULT, 'blog')

for (const e of entries) {
  const date = String(e.date || e.created_at || '').slice(0, 10) || '1970-01-01'
  const year = date.slice(0, 4)
  const dir = join(blogRoot, year)
  const title = safeName(e.title, e.id)
  const base = title.startsWith(date) ? title : `${date}-${title}`
  const name = allocBlog(dir, base, '.md')
  const abs = join(dir, name)
  const fm = {
    id: e.id,
    title: e.title,
    date,
    tags: tagsOfEntry.get(e.id) || [],
    pinned: Number(e.is_pinned) ? 'true' : '',
    starred: Number(e.is_starred) ? 'true' : '',
    states: e.states || '',
    wordCount: e.word_count === null || e.word_count === undefined ? '' : String(e.word_count),
    created: e.created_at || '',
    updated: e.updated_at || '',
  }
  planFile(abs, serializeFrontmatter(fm, normalize(e.content_md)))
  blogIndex[e.id] = { id: e.id, title: e.title, date, path: relFromVault(abs) }
}
stats.blogEntries = entries.length

// ---------------------------------------------------------------- 5. 其余结构化模块

const K = join(VAULT, '.knowbase', 'modules')

planJson(join(K, 'knowledge', 'categories.json'), catIndex)
planJson(join(K, 'knowledge', 'pages.json'), pageIndex)
planJson(join(K, 'knowledge', 'tags.json'), all('select * from knowledge_tags'))
planJson(join(K, 'knowledge', 'page-tags.json'), all('select * from knowledge_page_tags'))
planJson(join(K, 'knowledge', 'pack-imports.json'), all('select * from knowledge_pack_imports'))

planJson(join(K, 'blog', 'entries.json'), blogIndex)
planJson(join(K, 'blog', 'tags.json'), all('select * from tags'))

planJson(join(K, 'moments', 'posts.json'), all('select * from moments_posts'))
planJson(join(K, 'moments', 'albums.json'), all('select * from moments_albums'))

planJson(join(K, 'schedule', 'todos.json'), all('select * from schedule_todos'))
planJson(join(K, 'schedule', 'tags.json'), all('select * from schedule_tags'))

planJson(join(K, 'toolbox', 'passwords.json'), all('select * from toolbox_passwords'))
planJson(join(K, 'toolbox', 'weight.json'), all('select * from toolbox_weight_records'))

planJson(join(K, 'bookmarks', 'bookmarks.json'), all('select * from bookmarks'))
planJson(join(K, 'bookmarks', 'categories.json'), all('select * from bookmark_categories'))

planJson(join(K, 'study', 'sets.json'), all('select * from study_sets'))
planJson(join(K, 'study', 'items.json'), all('select * from study_items'))

planJson(join(K, 'habits.json'), all('select * from habits'))
planJson(join(K, 'supervise', 'config.json'), all('select * from supervise_config'))
planJson(join(K, 'supervise', 'log.json'), all('select * from supervise_log'))
planJson(join(K, 'agent', 'sessions.json'), all('select * from agent_sessions'))
planJson(join(K, 'agent', 'messages.json'), all('select * from agent_messages'))
planJson(join(K, 'recycle-bin.json'), all('select * from recycle_bin'))
planJson(join(K, 'user.json'), all('select id, username, avatar_path, created_at, updated_at from user_profile'))

// ---------------------------------------------------------------- 6. 元信息

let meta = {}
if (existsSync(metaPath)) {
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
  } catch {
    warnings.push('.knowbase/meta.json 解析失败，将重建')
  }
}
const dbStat = statSync(DB_PATH)
const nextMeta = {
  ...meta,
  schemaVersion: meta.schemaVersion ?? 1,
  migratedAt: new Date().toISOString(),
  migratedFrom: {
    database: DB_PATH,
    databaseMtime: dbStat.mtime.toISOString(),
    databaseBytes: dbStat.size,
    counts: stats,
  },
}

// ---------------------------------------------------------------- 7. 冲突检查

const conflicts = []
const allTargets = [...plan.files.map((f) => f.path), ...plan.copies.map((c) => c.to)]
for (const t of allTargets) {
  if (existsSync(t) && !OVERWRITE) conflicts.push(relFromVault(t))
}
stats.targets = allTargets.length
stats.conflicts = conflicts.length

// ---------------------------------------------------------------- 8. 执行 / 预演

const report = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  vault: VAULT,
  source: { database: DB_PATH, attachments: ATT_DIR },
  options: { extractSvg: EXTRACT_SVG, overwrite: OVERWRITE, skipAttachments: SKIP_ATTACHMENTS },
  stats,
  warnings,
  conflicts: conflicts.slice(0, 200),
  sample: {
    pages: Object.values(pageIndex).slice(0, 15).map((p) => p.path),
    blog: Object.values(blogIndex).slice(0, 10).map((b) => b.path),
  },
}

if (!APPLY) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8')
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
  console.log(`\n预演完成（未写盘）。仓库：${VAULT}\n`)
  console.log(`  知识库分类   ${stats.categories}  ${JSON.stringify(stats.categoryTypes)}`)
  console.log(`  知识库页面   ${stats.pages}（空页 ${stats.pagesEmpty}）`)
  console.log(`  博客文章     ${stats.blogEntries}`)
  console.log(`  附件         ${stats.attachments} 个 · ${mb(stats.attachmentBytes)}`)
  console.log(`  内联 SVG     抽取 ${stats.extractedSvgs} 处`)
  console.log(`  计划写入     ${stats.targets} 个文件`)
  console.log(`  路径冲突     ${stats.conflicts}（加 --overwrite 覆盖）`)
  if (warnings.length) {
    console.log(`  警告 ${warnings.length} 条：`)
    for (const w of warnings.slice(0, 10)) console.log(`    - ${w}`)
  }
  console.log(`\n  页面示例：`)
  for (const p of report.sample.pages.slice(0, 8)) console.log(`    ${p}`)
  console.log(`\n  报告：${REPORT_PATH}`)
  console.log(`  确认无误后加 --apply 执行。\n`)
  process.exit(0)
}

// 真正写盘
let written = 0
let copied = 0
let skipped = 0

for (const dir of [...plan.dirs].sort((a, b) => a.length - b.length)) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
for (const f of plan.files) {
  if (existsSync(f.path) && !OVERWRITE) {
    skipped += 1
    continue
  }
  const tmp = join(dirname(f.path), `.${randomUUID()}.tmp`)
  writeFileSync(tmp, f.content, 'utf-8')
  try {
    renameSync(tmp, f.path)
  } catch {
    if (existsSync(f.path)) unlinkSync(f.path)
    renameSync(tmp, f.path)
  }
  written += 1
}
for (const c of plan.copies) {
  if (existsSync(c.to) && !OVERWRITE) {
    skipped += 1
    continue
  }
  copyFileSync(c.from, c.to)
  copied += 1
}
writeFileSync(metaPath, JSON.stringify(nextMeta, null, 2) + '\n')

mkdirSync(dirname(REPORT_PATH), { recursive: true })
const finalReport = { ...report, result: { written, copied, skipped } }
writeFileSync(REPORT_PATH, JSON.stringify(finalReport, null, 2), 'utf-8')

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
console.log(`\n迁移完成 → ${VAULT}`)
console.log(`  写入 .md/.json  ${written} 个`)
console.log(`  复制附件        ${copied} 个 · ${mb(stats.attachmentBytes)}`)
console.log(`  跳过（已存在）  ${skipped} 个`)
console.log(`  警告            ${warnings.length} 条`)
console.log(`  报告            ${REPORT_PATH}\n`)
