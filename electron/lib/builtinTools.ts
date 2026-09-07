import { randomUUID } from 'crypto'
import { readdirSync, lstatSync, readFileSync, statSync, mkdirSync } from 'fs'
import { join, relative, extname, sep, dirname } from 'path'
import { getDatabase, saveToDisk } from '../database/connection'
import { registerTool, getSettingReader } from './aiTools'
import { webSearch, webReadPage } from './webSearch'
import { resolveSafe, detectConflict, writeWorkspaceFile, renameWorkspacePath, trashWorkspacePath, invalidateIndexIfCurrentVault } from './workspaceManager'
import { getCurrentVault } from './kbStore/vaultContext'
import { pomoSessionsAll } from './kbStore/pomoVaultRepo'
import { getKnowledgeIndex } from './kbStore/knowledgeIndex'
import { vaultSearchPages as vaultSearchKnowledgePages, vaultGetPageById } from './kbStore/knowledgeVaultRepo'
import { vaultCreateEntry } from './kbStore/blogVaultRepo'
import { vaultBookmarksAll } from './kbStore/bookmarkVaultRepo'
import { vaultHabitsAll, vaultRecordsAll, vaultHabitRecordAddIfAbsent } from './kbStore/habitVaultRepo'
import { vaultTodosAll, vaultCreateTodo } from './kbStore/scheduleVaultRepo'
import { extractDocText } from './docsReader'
import type { ToolJsonSchema } from './aiTools'

/**
 * 内置 AI 工具清单：给 AgentRunner 与外部 MCP 客户端的稳定契约。
 * 原则：输出面向 LLM 的紧凑结构（控制 token），不是 UI 数据结构直通。
 *
 * ⚠️ 数据归属约定（2026-09-03 B0 起强制）：
 * 工具按模块走「该模块当前的真相源」——已去库化模块（storageKnowledge/storageBlog/storageData=vault）
 * 的读工具必须调用对应 kbStore vault repo，写工具走该模块受控写层；严禁绕过模块分流直连 sql.js 旧表
 * （曾致 AI 建页写停更旧库、UI 不可见的静默分叉）。仍在 sqlite 的模块保持直查表。
 * 统计口径与渲染层 habit-tracker/dateUtils.ts 同源（本地时区 YYYY-MM-DD、计划日跳过逻辑一致）。
 */

// ---- 模块读源开关：storageX=vault 表示该模块已去库化，工具走 vault repo ----

function storageIs(kind: 'knowledge' | 'blog' | 'data'): boolean {
  const key = kind === 'knowledge' ? 'storageKnowledge' : kind === 'blog' ? 'storageBlog' : 'storageData'
  return getSettingReader()(key) === 'vault'
}

/** 习惯行按 sort_order ASC, created_at ASC（码位序）排序；vault/sqlite 读源共用（P5c 消费方接线） */
function sortHabitRows<T extends { sort_order?: number; created_at?: string }>(rows: T[]): T[] {
  const bin = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  return rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || bin(String(a.created_at ?? ''), String(b.created_at ?? '')))
}

// ---- 本地日期工具（与 src/modules/toolbox/components/habit-tracker/dateUtils.ts 语义一致） ----

function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() + n)
  return r
}

// ---- DB 访问 ----

interface DbRow { [key: string]: unknown }

function queryAll(sql: string, params: unknown[] = []): DbRow[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: DbRow[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as DbRow)
  stmt.free()
  return rows
}

/** 写操作统一入口（与 repo 层一致：写后立即持久化） */
function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

function todayLocal(): string {
  return formatLocalDate(new Date())
}

/** 粗剥 markdown 记号 → 纯文本（与 knowledgeRepo.mdToPlain 同源） */
function mdToPlain(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[>*`~_|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 定位首个命中词，取前后各 radius 字符的摘录 */
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

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

function parseDays(json: string): number[] {
  try {
    const v = JSON.parse(json)
    if (Array.isArray(v)) return v.map(Number)
  } catch { /* ignore */ }
  return [1, 2, 3, 4, 5]
}

/** habit 在 date 是否有打卡计划（flexible 视为每天可打卡） */
function isPlannedOn(ruleType: string, ruleDays: number[], d: Date): boolean {
  switch (ruleType) {
    case 'daily': return true
    case 'weekdays': return ruleDays.includes(d.getDay())
    case 'flexible': return true
    default: return true
  }
}

function currentStreak(ruleType: string, ruleDays: number[], done: Set<string>, today = new Date()): number {
  let streak = 0
  let d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (isPlannedOn(ruleType, ruleDays, d) && !done.has(formatLocalDate(d))) d = addDays(d, -1)
  for (let i = 0; i < 3650; i++) {
    const ds = formatLocalDate(d)
    if (done.has(ds)) { streak++; d = addDays(d, -1); continue }
    if (!isPlannedOn(ruleType, ruleDays, d)) { d = addDays(d, -1); continue }
    break
  }
  return streak
}

function longestStreak(ruleType: string, ruleDays: number[], done: Set<string>, today = new Date()): number {
  const dates = [...done].sort()
  if (dates.length === 0) return 0
  let longest = 0
  let cur = 0
  const [y, m, dd] = dates[0].split('-').map(Number)
  let d = new Date(y, (m || 1) - 1, dd || 1)
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  while (d <= end) {
    const ds = formatLocalDate(d)
    if (done.has(ds)) { cur++; if (cur > longest) longest = cur }
    else if (isPlannedOn(ruleType, ruleDays, d)) cur = 0
    d = addDays(d, 1)
  }
  return longest
}

/** 区间完成率：计划日中已完成的占比（flexible 按打卡次数 / 天数计） */
function completionRate(ruleType: string, ruleDays: number[], done: Set<string>, daysWindow: number, today = new Date()): number {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = addDays(end, -(daysWindow - 1))
  let planned = 0
  let did = 0
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const ds = formatLocalDate(d)
    if (done.has(ds)) { planned++; did++ }
    else if (ruleType !== 'flexible' && isPlannedOn(ruleType, ruleDays, d)) planned++
  }
  if (planned === 0) return 0
  return Math.round((did / planned) * 100)
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']
function ruleSummary(ruleType: string, ruleDays: number[], weeklyTarget: number): string {
  if (ruleType === 'daily') return '每天'
  if (ruleType === 'flexible') return `每周 ${weeklyTarget} 次`
  const days = [...ruleDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  if (days.length === 0) return '未设置计划日'
  return '每周' + days.map(d => WEEKDAY_NAMES[d]).join('、')
}

// ===== vault.* 仓库文件工具（B1，F1 只读三件）：AI 视角文件系统 =====
// 可见性（2026-09-02 拍板）：仓库 .md/.txt 全可见；.knowbase/modules/*.json 只读可见（结构化数据）；
// .knowbase 其余（cache/config/plugins/密钥/_attachments 等）完全不可见；隐藏文件/目录不可见。
// 守卫复用 workspaceManager.resolveSafe（防越界/符号链接逃逸），越界与受限区一律拒。

const VAULT_DOT_DIR = '.knowbase'
const VAULT_MODULES_DIR = 'modules'
const MAX_VAULT_FILE = 10 * 1024 * 1024 // read >10MB 拒
const MAX_VAULT_SEARCH_FILE = 1024 * 1024 // search 只扫 ≤1MB 文本
const MAX_VAULT_SEARCH_FILES = 400
const MAX_VAULT_LIST_ENTRIES = 200

function vaultRootPath(): string {
  const cur = getCurrentVault()
  if (!cur || !cur.rootPath) throw new Error('当前没有打开的仓库：请先在应用中打开知识仓库')
  return cur.rootPath
}

/** 取路径最后一段（兼容 / 与 \ 分隔，非文件系统语义，纯字符串） */
function baseNameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}

function vaultRelParts(root: string, abs: string): string[] {
  const rel = relative(root, abs)
  return rel ? rel.split(sep).filter(Boolean) : []
}

/** .knowbase/modules/.../<file>.json（AI 只读可见的结构化模块数据） */
function isModulesJson(parts: string[]): boolean {
  return parts.length >= 3 && parts[0] === VAULT_DOT_DIR && parts[1] === VAULT_MODULES_DIR &&
    parts[parts.length - 1].toLowerCase().endsWith('.json')
}

/** 子路径是否 AI 允许（目录枚举用）：点目录一律拒，.knowbase 仅 modules 子树放行 */
function childAiAllowed(root: string, childAbs: string): boolean {
  const parts = vaultRelParts(root, childAbs)
  if (parts.length === 0) return false
  const first = parts[0]
  if (first.startsWith('.')) {
    if (first !== VAULT_DOT_DIR) return false
    return parts.length === 1 || parts[1] === VAULT_MODULES_DIR
  }
  return true
}

/** 读白名单：.md/.txt（可见区任意处）+ .json（仅 .knowbase/modules） */
function isAiReadableFile(root: string, abs: string): boolean {
  const parts = vaultRelParts(root, abs)
  if (parts.length === 0) return false
  if (!childAiAllowed(root, abs)) return false
  const ext = extname(abs).slice(1).toLowerCase()
  if (ext === 'json') return isModulesJson(parts)
  return ext === 'md' || ext === 'txt'
}

/** 递归收集可搜索文本文件（.knowbase 只深入 modules；隐藏区跳过；数量预算封顶） */
function walkAiFiles(root: string, dirAbs: string, out: string[], budget: { count: number }): void {
  if (budget.count >= MAX_VAULT_SEARCH_FILES) return
  let names: string[] = []
  try { names = readdirSync(dirAbs) } catch { return }
  for (const name of names) {
    if (budget.count >= MAX_VAULT_SEARCH_FILES) return
    const full = join(dirAbs, name)
    if (!childAiAllowed(root, full)) continue
    let st: ReturnType<typeof lstatSync>
    try { st = lstatSync(full) } catch { continue }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) { walkAiFiles(root, full, out, budget); continue }
    if (!st.isFile()) continue
    if (st.size > MAX_VAULT_SEARCH_FILE) continue
    if (!isAiReadableFile(root, full)) continue
    budget.count++
    out.push(full)
  }
}

/** 写白名单（B2）：普通可见区 .md/.txt；.knowbase 全面禁写（modules/*.json 只读、cache/config 等本就不可见） */
function isAiWritableFile(root: string, abs: string): boolean {
  const parts = vaultRelParts(root, abs)
  if (parts.length === 0) return false
  if (parts[0].startsWith('.')) return false // 含 .knowbase：任何写操作都拒
  const ext = extname(abs).slice(1).toLowerCase()
  return ext === 'md' || ext === 'txt'
}

/** 文档白名单（docs.read-text）：普通可见区 .pdf/.pptx（.knowbase 内部暂不开放） */
function isAiDocFile(root: string, abs: string): boolean {
  const parts = vaultRelParts(root, abs)
  if (parts.length === 0) return false
  if (parts[0].startsWith('.')) return false
  const ext = extname(abs).slice(1).toLowerCase()
  return ext === 'pdf' || ext === 'pptx'
}

/** 写前守卫：writable 判定 + 大小 + mtime 冲突（expectedMtimeMs 来自 vault.read 基线） */
function assertAiWritable(root: string, abs: string, expectedMtimeMs: unknown): void {
  if (!isAiWritableFile(root, abs)) {
    throw new Error('该位置不可写：AI 仅可新建/修改仓库内普通 .md/.txt 文件（.knowbase 内部数据只读保护）')
  }
  let existing = false
  let size = 0
  try { const st = statSync(abs); existing = st.isFile(); size = st.size } catch { /* 新建 */ }
  if (existing && size > MAX_VAULT_FILE) throw new Error(`文件过大（${size} 字节 > 10MB），拒绝写入: ${abs}`)
  const expected = Number(expectedMtimeMs)
  if (existing && Number.isFinite(expected) && expected > 0) {
    const c = detectConflict(abs, expected)
    if (c.conflict) {
      throw new Error(`文件已被外部修改（磁盘 mtime ${Math.round(c.diskMtimeMs ?? 0)} 与基线不符）。请先 vault.read 重取最新内容再写入`)
    }
  }
}

/** 写入成功后广播「外部变更」（编辑器若正打开该文件会弹三选），沿用 plugin:installed-changed 模式 */
function broadcastExternalWrite(relPath: string, mtimeMs?: number): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserWindow } = require('electron') as typeof import('electron')
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('ws:external-change', { relPath, mtimeMs })
    }
  } catch { /* 广播失败不影响写入结果 */ }
}

// ===== 六个内置工具 =====

const SEARCH_LIMIT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '关键词, 空格分隔为 AND' },
    limit: { type: 'number', description: '上限, 默认8' },
  },
  required: ['query'],
} satisfies ToolJsonSchema

export function registerBuiltinTools(): void {

  // 1. builtin.knowledge.search —— 关键词搜索知识库页面
  registerTool({
    name: 'builtin.knowledge.search',
    title: '搜索知识库页面',
    description: '关键词搜索知识库页面, 返回 id/标题/摘录',
    inputSchema: SEARCH_LIMIT_SCHEMA,
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'knowledge',
  }, args => {
    const q = str(args.query).trim()
    const limit = clamp(Math.floor(num(args.limit, 8)), 1, 50)
    const terms = q.split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []
    if (storageIs('knowledge')) {
      // vault 读源：与知识库 UI 同一份磁盘 .md（此前直查 sqlite 旧表导致 AI 搜不到 vault 页）
      try {
        return vaultSearchKnowledgePages(q).slice(0, limit).map(r => ({
          id: r.id,
          title: r.title,
          excerpt: r.excerpt || r.title,
          updatedAt: r.updatedAt,
        }))
      } catch (err) {
        throw new Error(`知识库搜索失败（仓库未就绪？）：${String((err as Error)?.message ?? err)}`)
      }
    }
    const conds = terms.map(() => '(title LIKE ? OR content_md LIKE ?)').join(' AND ')
    const params: unknown[] = []
    for (const t of terms) params.push(`%${t}%`, `%${t}%`)
    const rows = queryAll(
      `SELECT id, title, content_md, updated_at FROM knowledge_pages
       WHERE ${conds} ORDER BY updated_at DESC LIMIT ${limit}`,
      params
    )
    return rows.map(r => ({
      id: str(r.id),
      title: str(r.title),
      excerpt: buildExcerpt(mdToPlain(str(r.content_md)), terms),
      updatedAt: str(r.updated_at),
    }))
  })

  // 2. builtin.knowledge.read —— 按 id 读页面全文
  registerTool({
    name: 'builtin.knowledge.read',
    title: '阅读知识库页面',
    description: '按 id 读页面 Markdown 全文, 超长截断',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id' },
        maxChars: { type: 'number', description: '最多返回字符, 默认8000' },
      },
      required: ['id'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'knowledge',
  }, args => {
    const id = str(args.id)
    const maxChars = clamp(Math.floor(num(args.maxChars, 8000)), 200, 50000)
    if (storageIs('knowledge')) {
      // vault 读源：与知识库 UI 同一份磁盘 .md（id 为页面 frontmatter id，与 search 返回同体系）
      let page
      try {
        page = vaultGetPageById(id)
      } catch (err) {
        throw new Error(`读取失败（仓库未就绪？）：${String((err as Error)?.message ?? err)}`)
      }
      if (!page) throw new Error(`页面不存在: ${id}`)
      const content = page.contentMd
      const truncated = content.length > maxChars
      return {
        id: page.id,
        title: page.title,
        contentMd: truncated ? content.slice(0, maxChars) : content,
        truncated,
        totalChars: content.length,
        updatedAt: page.updatedAt,
      }
    }
    const rows = queryAll(
      'SELECT id, title, content_md, updated_at FROM knowledge_pages WHERE id = ?',
      [id]
    )
    if (rows.length === 0) throw new Error(`页面不存在: ${id}`)
    const r = rows[0]
    const content = str(r.content_md)
    const truncated = content.length > maxChars
    return {
      id: str(r.id),
      title: str(r.title),
      contentMd: truncated ? content.slice(0, maxChars) : content,
      truncated,
      totalChars: content.length,
      updatedAt: str(r.updated_at),
    }
  })

  // 3. builtin.habits.list —— 列习惯与今日状态
  registerTool({
    name: 'builtin.habits.list',
    title: '列出打卡习惯',
    description: '列出全部习惯与今日打卡状态',
    inputSchema: { type: 'object', properties: {} },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'checkin',
  }, () => {
    const today = formatLocalDate(new Date())
    // P5c 消费方接线：storageData=vault → 读 .knowbase/modules/checkin/*.json（排序语义同 SQL）
    const habits: DbRow[] = storageIs('data')
      ? sortHabitRows(vaultHabitsAll()) as unknown as DbRow[]
      : queryAll('SELECT id, name, rule_type, rule_days, weekly_target, archived FROM habits ORDER BY sort_order ASC, created_at ASC')
    const checkedToday = storageIs('data')
      ? new Set(vaultRecordsAll().filter(r => r.date === today).map(r => str(r.habit_id)))
      : new Set(queryAll('SELECT habit_id, date FROM habit_records WHERE date = ?', [today]).map(r => str(r.habit_id)))
    return habits.map(h => {
      const ruleType = str(h.rule_type, 'daily')
      const ruleDays = parseDays(str(h.rule_days, '[]'))
      return {
        id: str(h.id),
        name: str(h.name),
        rule: ruleSummary(ruleType, ruleDays, num(h.weekly_target, 3)),
        plannedToday: !h.archived && isPlannedOn(ruleType, ruleDays, new Date()),
        checkedToday: checkedToday.has(str(h.id)),
        archived: !!h.archived,
      }
    })
  })

  // 4. builtin.habits.stats —— 连续天数 / 完成率
  registerTool({
    name: 'builtin.habits.stats',
    title: '习惯统计数据',
    description: '习惯连续天数/最长连续/完成率/累计次数',
    inputSchema: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: '习惯 id, 缺省全部' },
        days: { type: 'number', description: '统计窗口天数, 默认30' },
      },
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'checkin',
  }, args => {
    const windowDays = clamp(Math.floor(num(args.days, 30)), 1, 365)
    const wanted = typeof args.habitId === 'string' && args.habitId ? [args.habitId] : null
    // P5c 消费方接线：vault 读源（含归档习惯，与 sqlite 路径一致）
    const habits: DbRow[] = (storageIs('data')
      ? sortHabitRows(vaultHabitsAll()) as unknown as DbRow[]
      : queryAll('SELECT id, name, rule_type, rule_days, weekly_target FROM habits ORDER BY sort_order ASC')
    ).filter(h => !wanted || wanted.includes(str(h.id)))
    if (wanted && habits.length === 0) throw new Error(`习惯不存在: ${str(args.habitId)}`)
    const allRecords: DbRow[] = storageIs('data')
      ? vaultRecordsAll() as unknown as DbRow[]
      : queryAll('SELECT habit_id, date FROM habit_records')
    return habits.map(h => {
      const done = new Set<string>()
      for (const rec of allRecords) {
        if (str(rec.habit_id) === str(h.id)) done.add(str(rec.date))
      }
      const ruleType = str(h.rule_type, 'daily')
      const ruleDays = parseDays(str(h.rule_days, '[]'))
      return {
        id: str(h.id),
        name: str(h.name),
        rule: ruleSummary(ruleType, ruleDays, num(h.weekly_target, 3)),
        currentStreak: currentStreak(ruleType, ruleDays, done),
        longestStreak: longestStreak(ruleType, ruleDays, done),
        completionRatePct: completionRate(ruleType, ruleDays, done, windowDays),
        totalCount: done.size,
        windowDays,
      }
    })
  })

  // 5. builtin.bookmarks.search —— 搜索书签
  registerTool({
    name: 'builtin.bookmarks.search',
    title: '搜索书签',
    description: '关键词搜索书签, 返回标题/URL/分类',
    inputSchema: SEARCH_LIMIT_SCHEMA,
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'bookmarks',
  }, args => {
    const q = str(args.query).trim()
    const limit = clamp(Math.floor(num(args.limit, 10)), 1, 50)
    const terms = q.split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []
    if (storageIs('data')) {
      // 结构化模块 vault 读源（灰度）：与 UI 同一份 .knowbase/modules/bookmarks/*.json，内存过滤
      const all = vaultBookmarksAll()
      const catName = new Map(all.categories.map(c => [c.id, c.name]))
      const hits = all.bookmarks.filter(b => {
        const hay = `${b.title} ${b.url} ${b.description} ${catName.get(b.categoryId) ?? ''}`.toLowerCase()
        return terms.every(t => hay.includes(t.toLowerCase()))
      }).slice(0, limit)
      return hits.map(b => ({
        title: b.title,
        url: b.url,
        description: b.description,
        category: catName.get(b.categoryId) || '未分类',
      }))
    }
    const conds = terms.map(() => '(b.title LIKE ? OR b.url LIKE ? OR b.description LIKE ?)').join(' AND ')
    const params: unknown[] = []
    for (const t of terms) { const p = `%${t}%`; params.push(p, p, p) }
    const rows = queryAll(
      `SELECT b.title, b.url, b.description, c.name AS category
       FROM bookmarks b LEFT JOIN bookmark_categories c ON c.id = b.category_id
       WHERE ${conds} ORDER BY b.sort_order ASC LIMIT ${limit}`,
      params
    )
    return rows.map(r => ({
      title: str(r.title),
      url: str(r.url),
      description: str(r.description),
      category: str(r.category) || '未分类',
    }))
  })

  // 6. builtin.pomodoro.summary —— 近 N 天专注统计
  registerTool({
    name: 'builtin.pomodoro.summary',
    title: '番茄钟专注统计',
    description: '近 N 天每日专注分钟与场次',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '最近天数, 默认7' },
      },
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'pomodoro',
  }, args => {
    const days = clamp(Math.floor(num(args.days, 7)), 1, 365)
    const end = new Date()
    const start = addDays(end, -(days - 1))
    // R6 去库化：pomodoro 场次读 .knowbase/modules/pomodoro/sessions.json
    const sessions = pomoSessionsAll().filter((r) => r.date >= formatLocalDate(start) && r.date <= formatLocalDate(end))
    const byDate = new Map<string, { sessions: number; minutes: number }>()
    for (const r of sessions) {
      const hit = byDate.get(r.date) ?? { sessions: 0, minutes: 0 }
      hit.sessions += 1
      hit.minutes += Number(r.minutes) || 0
      byDate.set(r.date, hit)
    }
    const out: { date: string; minutes: number; sessions: number }[] = []
    let totalMinutes = 0
    let totalSessions = 0
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const ds = formatLocalDate(d)
      const hit = byDate.get(ds)
      const minutes = hit ? num(hit.minutes, 0) : 0
      const sessions = hit ? num(hit.sessions, 0) : 0
      out.push({ date: ds, minutes, sessions })
      totalMinutes += minutes
      totalSessions += sessions
    }
    return { windowDays: days, totalMinutes, totalSessions, days: out }
  })

  // 7. builtin.schedule.list-todos —— 日程待办查询（读）
  registerTool({
    name: 'builtin.schedule.list-todos',
    title: '查询日程待办',
    description: '按日期区间查询待办',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: '开始日期 YYYY-MM-DD，默认今天' },
        end: { type: 'string', description: '结束日期 YYYY-MM-DD，默认与 start 相同' },
      },
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'schedule',
  }, args => {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(str(args.start)) ? str(args.start) : todayLocal()
    const end = /^\d{4}-\d{2}-\d{2}$/.test(str(args.end)) ? str(args.end) : start
    let rows: DbRow[]
    if (storageIs('data')) {
      // P5c 消费方接线：读 .knowbase/modules/schedule/todos.json（date BETWEEN + 排序 + LIMIT 100 同 SQL）
      rows = vaultTodosAll()
        .filter(r => typeof r.date === 'string' && r.date >= start && r.date <= end)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.sort_order ?? 0) - (b.sort_order ?? 0)))
        .slice(0, 100) as unknown as DbRow[]
    } else {
      rows = queryAll(
        `SELECT id, title, date, time, quadrant, status FROM schedule_todos
         WHERE date BETWEEN ? AND ? ORDER BY date ASC, sort_order ASC LIMIT 100`,
        [start, end]
      )
    }
    const QUADRANT = ['紧急重要', '重要不紧急', '紧急不重要', '不重要不紧急']
    return rows.map(r => {
      const q = num(r.quadrant, 1)
      return {
        id: str(r.id),
        title: str(r.title),
        date: str(r.date),
        time: str(r.time),
        quadrant: q,
        quadrantLabel: QUADRANT[q] ?? '重要不紧急',
        status: str(r.status, 'pending'),
      }
    })
  })

  // ===== 以下为写入类工具（requires:'write'，受模块权限开关控制，操作真实生效并留审计） =====

  // 8. builtin.knowledge.create-page
  registerTool({
    name: 'builtin.knowledge.create-page',
    title: '创建知识库页面',
    description: '新建知识库页面(可指定分类名)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题' },
        contentMd: { type: 'string', description: 'Markdown 正文' },
        categoryName: { type: 'string', description: '分类名(精确, 可选)' },
      },
      required: ['title', 'contentMd'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    module: 'knowledge',
  }, args => {
    if (storageIs('knowledge')) {
      // vault 读源下知识内容=仓库文件、编辑器为唯一写入方：绝不静默写 sqlite 旧表（曾致 AI 建页 UI 不可见的分叉）
      throw new Error('知识库内容现由仓库文件管理（编辑器为唯一写入方），AI 建页将在「vault 写工具」上线后开放；当前请用编辑器新建，或到 设置 → 通用 将知识库数据形态切回「数据库(sqlite)」')
    }
    const title = str(args.title).trim()
    const contentMd = str(args.contentMd)
    if (!title) throw new Error('标题不能为空')
    let categoryId: string | null = null
    const catName = str(args.categoryName).trim()
    if (catName) {
      const cat = queryAll("SELECT id FROM knowledge_categories WHERE name = ? AND category_type <> 'space' LIMIT 1", [catName])
      if (cat.length === 0) throw new Error(`未找到分类「${catName}」，可省略 categoryName 存入未分类`)
      categoryId = str(cat[0].id)
    }
    const id = randomUUID()
    run(
      `INSERT INTO knowledge_pages (id, title, content_md, category_id) VALUES (?, ?, ?, ?)`,
      [id, title, contentMd, categoryId]
    )
    return { ok: true, id, title }
  })

  // 9. builtin.knowledge.append-page
  registerTool({
    name: 'builtin.knowledge.append-page',
    title: '追加内容到知识库页面',
    description: '向页面末尾追加文本(按 id 或标题定位)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id(与title二选一)' },
        title: { type: 'string', description: '精确标题(与id二选一)' },
        text: { type: 'string', description: '追加的文本' },
      },
      required: ['text'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    module: 'knowledge',
  }, args => {
    if (storageIs('knowledge')) {
      throw new Error('知识库内容现由仓库文件管理（编辑器为唯一写入方），AI 追加内容将在「vault 写工具」上线后开放；当前请用编辑器修改，或到 设置 → 通用 将知识库数据形态切回「数据库(sqlite)」')
    }
    const text = str(args.text)
    const id = str(args.id)
    const title = str(args.title)
    let page: DbRow | undefined
    if (id) page = queryAll('SELECT id, title FROM knowledge_pages WHERE id = ?', [id])[0]
    else if (title) page = queryAll('SELECT id, title FROM knowledge_pages WHERE title = ? ORDER BY updated_at DESC LIMIT 1', [title])[0]
    else throw new Error('需要提供 id 或 title 之一')
    if (!page) throw new Error('页面不存在')
    run(
      "UPDATE knowledge_pages SET content_md = content_md || char(10) || ?, updated_at = datetime('now') WHERE id = ?",
      [text, str(page.id)]
    )
    return { ok: true, id: str(page.id), title: str(page.title), appendedChars: text.length }
  })

  // 10. builtin.blog.create-entry
  registerTool({
    name: 'builtin.blog.create-entry',
    title: '写一篇日记',
    description: '新建日记(日期默认今天,每天一篇)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '日记标题（可为空字符串）' },
        contentMd: { type: 'string', description: 'Markdown 正文' },
        date: { type: 'string', description: 'YYYY-MM-DD, 默认今天' },
      },
      required: ['contentMd'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    module: 'blog',
  }, args => {
    const contentMd = str(args.contentMd)
    if (!contentMd.trim()) throw new Error('正文不能为空')
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(args.date)) ? str(args.date) : todayLocal()
    if (storageIs('blog')) {
      // 博客 vault 读源（灰度）：与 UI 同一份 blog/*.md（vaultCreateEntry 自带每天一篇防重）
      const e = vaultCreateEntry({ title: str(args.title).trim(), contentMd, date })
      if (e.contentMd !== contentMd) throw new Error(`${date} 已存在日记（应用限制每天一篇），可改用其他日期`)
      return { ok: true, id: e.id, date }
    }
    const dup = queryAll('SELECT id FROM entries WHERE date = ? LIMIT 1', [date])
    if (dup.length > 0) throw new Error(`${date} 已存在日记（应用限制每天一篇），可改用其他日期`)
    const id = randomUUID()
    run(
      `INSERT INTO entries (id, title, content_md, date, word_count) VALUES (?, ?, ?, ?, ?)`,
      [id, str(args.title).trim(), contentMd, date, contentMd.replace(/\s/g, '').length]
    )
    return { ok: true, id, date }
  })

  // 11. builtin.schedule.create-todo
  registerTool({
    name: 'builtin.schedule.create-todo',
    title: '创建日程待办',
    description: '创建待办',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD, 默认今天' },
        title: { type: 'string', description: '待办内容' },
        quadrant: { type: 'number', description: '0紧急重要/1重要不紧急/2紧急不重要/3不重要, 默认1' },
        time: { type: 'string', description: 'HH:mm 可选' },
      },
      required: ['title'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    module: 'schedule',
  }, args => {
    const title = str(args.title).trim()
    if (!title) throw new Error('待办内容不能为空')
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(args.date)) ? str(args.date) : todayLocal()
    const quadrant = clamp(Math.floor(num(args.quadrant, 1)), 0, 3)
    const time = /^\d{1,2}:\d{2}$/.test(str(args.time)) ? str(args.time) : null
    const id = randomUUID()
    if (storageIs('data')) {
      // P5c 消费方接线：写 .knowbase/modules/schedule/todos.json（默认值同表列：plan/pending/sort 0）
      const now = new Date().toISOString()
      vaultCreateTodo({
        id, title, description: '', date, time, quadrant,
        task_type: 'plan', tag_id: null, status: 'pending', sort_order: 0,
        end_criteria: '', parent_id: null, created_at: now, updated_at: now,
      })
      return { ok: true, id, date, quadrant }
    }
    run(
      `INSERT INTO schedule_todos (id, title, date, time, quadrant) VALUES (?, ?, ?, ?, ?)`,
      [id, title, date, time, quadrant]
    )
    return { ok: true, id, date, quadrant }
  })

  // 12. builtin.checkin.check-habit
  registerTool({
    name: 'builtin.checkin.check-habit',
    title: '习惯打卡',
    description: '按名称为今天打卡(支持部分匹配,幂等)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '习惯名(可部分匹配)' },
      },
      required: ['name'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    module: 'checkin',
  }, args => {
    const q = str(args.name).trim().toLowerCase()
    if (!q) throw new Error('习惯名称不能为空')
    const date = todayLocal()
    if (storageIs('data')) {
      // P5c 消费方接线：查/写 .knowbase/modules/checkin/*.json（幂等=UNIQUE(habit_id,date) 语义）
      const hs = sortHabitRows(vaultHabitsAll().filter(h => !h.archived))
      const hit = hs.find(h => h.name.toLowerCase() === q) ?? hs.find(h => h.name.toLowerCase().includes(q))
      if (!hit) throw new Error(`未找到匹配的习惯「${str(args.name)}」`)
      const isNew = vaultHabitRecordAddIfAbsent(hit.id, date, 'manual')
      return isNew
        ? { ok: true, habitId: hit.id, name: hit.name, checked: true }
        : { ok: true, habitId: hit.id, name: hit.name, alreadyChecked: true }
    }
    const habits = queryAll('SELECT id, name FROM habits WHERE archived = 0')
    let hit = habits.find(h => str(h.name).toLowerCase() === q)
    if (!hit) hit = habits.find(h => str(h.name).toLowerCase().includes(q))
    if (!hit) throw new Error(`未找到匹配的习惯「${str(args.name)}」`)
    const exist = queryAll('SELECT id FROM habit_records WHERE habit_id = ? AND date = ? LIMIT 1', [str(hit.id), date])
    if (exist.length > 0) return { ok: true, habitId: str(hit.id), name: str(hit.name), alreadyChecked: true }
    run('INSERT INTO habit_records (id, habit_id, date) VALUES (?, ?, ?)', [randomUUID(), str(hit.id), date])
    return { ok: true, habitId: str(hit.id), name: str(hit.name), checked: true }
  })

  // 13. builtin.web.search —— 联网搜索（跨模块通用能力，不设 module：不受 aiModulePermissions 限制）
  registerTool({
    name: 'builtin.web.search',
    title: '联网搜索',
    description: '搜索互联网（DuckDuckGo / Bing），返回标题/链接/摘要。用于需要时效性信息、本地知识库之外的内容、或用户询问实时事实时',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，越具体越好（可带引号或日期）' },
        limit: { type: 'number', description: '返回条数，默认 8，最大 20' },
      },
      required: ['query'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    // 不设 module：联网搜索不归属任何业务模块
  }, async args => {
    const q = str(args.query)
    const limit = clamp(Math.floor(num(args.limit, 8)), 1, 20)
    const { source, results } = await webSearch(q, limit)
    return { source, count: results.length, results }
  })

  // ===== vault.* 仓库文件只读工具（B1）：受 vaultFile 权限域（设置 → AI 工具 → 权限 → 仓库文件）控制 =====

  // 14. builtin.vault.list —— 列仓库目录（AI 视角，禁区自动隐藏）
  registerTool({
    name: 'builtin.vault.list',
    title: '列仓库目录',
    description: '列当前知识仓库某目录下的条目（目录与可读文本文件）；隐藏区(.knowbase 内部非 modules)不出现。用于让 AI 了解仓库结构',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库内相对目录路径，省略或空串 = 仓库根目录' },
      },
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    requires: 'read',
    vaultFile: 'read',
  }, args => {
    const rel = str(args.path).trim()
    const root = vaultRootPath()
    const abs = resolveSafe(root, rel)
    if (!abs) throw new Error(`路径非法或越出仓库: ${rel || '.'}`)
    let isDir = false
    try { isDir = statSync(abs).isDirectory() } catch { throw new Error(`路径不存在: ${rel || '.'}`) }
    if (!isDir) throw new Error('vault.list 只接受目录路径（读文件请用 vault.read）')
    const entries: Array<{ name: string; type: 'dir' | 'file'; size?: number }> = []
    let names: string[] = []
    try { names = readdirSync(abs) } catch { throw new Error('目录读取失败') }
    for (const name of names) {
      if (entries.length >= MAX_VAULT_LIST_ENTRIES) break
      const full = join(abs, name)
      if (!childAiAllowed(root, full)) continue
      let st: ReturnType<typeof lstatSync>
      try { st = lstatSync(full) } catch { continue }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) entries.push({ name, type: 'dir' })
      else if (st.isFile() && isAiReadableFile(root, full)) entries.push({ name, type: 'file', size: st.size })
    }
    entries.sort((a, b) => a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return { path: rel || '.', total: entries.length, entries }
  })

  // 15. builtin.vault.read —— 读仓库内文本文件（.md/.txt 与 .knowbase/modules/*.json）
  registerTool({
    name: 'builtin.vault.read',
    title: '读仓库文件',
    description: '读取仓库内文本文件全文（.md/.txt；.knowbase/modules/*.json 结构化数据只读）。返回 mtimeMs 供后续写回冲突校验。二进制/图片/PDF/>10MB/保护区文件拒绝',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库内相对文件路径（如 笔记/内存管理.md）' },
        maxChars: { type: 'number', description: '最多返回字符，默认8000' },
      },
      required: ['path'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    requires: 'read',
    vaultFile: 'read',
  }, args => {
    const rel = str(args.path).trim()
    if (!rel) throw new Error('缺少必填参数: path')
    const maxChars = clamp(Math.floor(num(args.maxChars, 8000)), 200, 50000)
    const root = vaultRootPath()
    const abs = resolveSafe(root, rel)
    if (!abs) throw new Error(`路径非法或越出仓库: ${rel}`)
    let st: ReturnType<typeof statSync>
    try { st = statSync(abs) } catch { throw new Error(`文件不存在: ${rel}`) }
    if (!st.isFile()) throw new Error('vault.read 只接受文件路径（列目录请用 vault.list）')
    if (!isAiReadableFile(root, abs)) {
      throw new Error(`文件不可读：仅支持 .md/.txt（仓库内）与 .knowbase/modules/*.json（只读）；该文件位于保护区或类型不在白名单: ${rel}`)
    }
    if (st.size > MAX_VAULT_FILE) throw new Error(`文件过大（${st.size} 字节 > 10MB），拒绝读取: ${rel}`)
    const text = readFileSync(abs, 'utf-8')
    const truncated = text.length > maxChars
    return {
      path: rel,
      size: st.size,
      mtimeMs: st.mtimeMs,
      content: truncated ? text.slice(0, maxChars) : text,
      truncated,
      totalChars: text.length,
    }
  })

  // 16. builtin.vault.search —— 仓库内内容搜索（文本 grep 语义）
  registerTool({
    name: 'builtin.vault.search',
    title: '搜索仓库内容',
    description: '在当前知识仓库内按关键词搜索可读文本文件（.md/.txt 与 .knowbase/modules/*.json）内容，返回命中文件与上下文摘录。用于在仓库内定位内容',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，空格分隔为 AND' },
        limit: { type: 'number', description: '命中上限, 默认20' },
      },
      required: ['query'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    requires: 'read',
    vaultFile: 'read',
  }, args => {
    const q = str(args.query).trim()
    const limit = clamp(Math.floor(num(args.limit, 20)), 1, 50)
    const terms = q.split(/\s+/).filter(Boolean)
    if (terms.length === 0) throw new Error('缺少关键词 query')
    const root = vaultRootPath()
    const files: string[] = []
    const budget = { count: 0 }
    walkAiFiles(root, root, files, budget)
    const hits: Array<{ relPath: string; excerpt: string; size: number }> = []
    for (const f of files) {
      let text = ''
      try { text = readFileSync(f, 'utf-8') } catch { continue }
      const lower = text.toLowerCase()
      if (!terms.every(t => lower.includes(t.toLowerCase()))) continue
      hits.push({
        relPath: vaultRelParts(root, f).join('/'),
        excerpt: buildExcerpt(text.replace(/\s+/g, ' '), terms) || text.replace(/\s+/g, ' ').slice(0, 100),
        size: text.length,
      })
      if (hits.length >= limit) break
    }
    return { query: q, total: hits.length, scannedFiles: budget.count, hits }
  })

  // ===== vault.* 写工具（B2/F2）：受 vaultFile=write 权限 + AgentRunner 会话写上限控制 =====

  // 17. builtin.vault.write —— 新建/整文件覆写 .md/.txt
  registerTool({
    name: 'builtin.vault.write',
    title: '写入仓库文件',
    description: '新建或整文件覆写仓库内 .md/.txt（原子写）。覆写已有文件时需带 vault.read 返回的 expectedMtimeMs 防冲突。不可写 .knowbase 内部数据。建议优先用 vault.edit 做小改动。注意：要在知识库列表/图谱中出现的知识页，内容必须以 frontmatter 开头并含 id:（稳定唯一标识，缺失则仅作为普通文件存在），格式可先 vault.read 一个既有 .md 参考',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库内相对文件路径（父目录须已存在或为已读目录）' },
        content: { type: 'string', description: '完整文件内容（Markdown）' },
        expectedMtimeMs: { type: 'number', description: '覆写已存在文件时的 mtime 基线（来自 vault.read），省略则不做冲突校验' },
      },
      required: ['path', 'content'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    vaultFile: 'write',
  }, args => {
    const rel = str(args.path).trim()
    const content = str(args.content)
    if (!rel) throw new Error('缺少必填参数: path')
    if (content.length > 2_000_000) throw new Error('内容过大（>2MB），拒绝写入')
    const root = vaultRootPath()
    const abs = resolveSafe(root, rel)
    if (!abs) throw new Error(`路径非法或越出仓库: ${rel}`)
    if (content.includes('\u0000')) throw new Error('内容含 NUL 字符，拒绝写入')
    let existing = false
    try { existing = statSync(abs).isFile() } catch { /* 新建 */ }
    assertAiWritable(root, abs, existing ? args.expectedMtimeMs : null)
    if (!existing) {
      try { mkdirSync(dirname(abs), { recursive: true }) } catch { /* 目录已存在 */ }
    }
    writeWorkspaceFile(abs, content)
    if (rel.toLowerCase().endsWith('.md')) invalidateIndexIfCurrentVault(getCurrentVault()?.rootId ?? '') // 与 ws:writeFile 同规则：.md 落盘即失效，知识列表/图谱立即可见
    const st = statSync(abs)
    broadcastExternalWrite(rel, st.mtimeMs)
    return { ok: true, path: rel, created: !existing, size: st.size, mtimeMs: st.mtimeMs }
  })

  // 18. builtin.vault.edit —— 精确替换（oldText→newText，整文件最多 1 处/次，防全量重写大文件）
  registerTool({
    name: 'builtin.vault.edit',
    title: '精确替换文件片段',
    description: '在仓库内 .md/.txt 中做一次精确替换（oldText 必须在文中唯一命中；newText 传空串即删除该片段，可用于解除 [[双链]]）。改动局部内容请用本工具而非 vault.write。需带 vault.read 返回的 expectedMtimeMs 防冲突',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库内相对文件路径' },
        oldText: { type: 'string', description: '要被替换的原文片段（必须唯一命中）' },
        newText: { type: 'string', description: '替换后的文本；传空串 "" 即删除该片段（如解除 [[双链]] 引用）', allowEmpty: true },
        expectedMtimeMs: { type: 'number', description: 'mtime 基线（来自 vault.read）' },
      },
      required: ['path', 'oldText', 'newText'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    vaultFile: 'write',
  }, args => {
    const rel = str(args.path).trim()
    const oldText = str(args.oldText)
    const newText = str(args.newText)
    if (!rel || !oldText) throw new Error('缺少必填参数: path / oldText')
    const root = vaultRootPath()
    const abs = resolveSafe(root, rel)
    if (!abs) throw new Error(`路径非法或越出仓库: ${rel}`)
    let st: ReturnType<typeof statSync>
    try { st = statSync(abs) } catch { throw new Error(`文件不存在: ${rel}`) }
    if (!st.isFile()) throw new Error('vault.edit 只接受文件路径')
    assertAiWritable(root, abs, args.expectedMtimeMs)
    const text = readFileSync(abs, 'utf-8')
    const first = text.indexOf(oldText)
    if (first < 0) throw new Error(`未找到待替换片段（截取前 60 字符）: ${oldText.slice(0, 60)}… 可先 vault.read 确认当前内容`)
    if (text.indexOf(oldText, first + oldText.length) >= 0) throw new Error('待替换片段在文件中出现多处，请提供更长更精确的 oldText（本工具一次只替换一处）')
    const next = text.slice(0, first) + newText + text.slice(first + oldText.length)
    writeWorkspaceFile(abs, next)
    if (rel.toLowerCase().endsWith('.md')) invalidateIndexIfCurrentVault(getCurrentVault()?.rootId ?? '') // 同上：edit 后索引/图谱同步刷新
    const after = statSync(abs)
    broadcastExternalWrite(rel, after.mtimeMs)
    return {
      ok: true,
      path: rel,
      mtimeMs: after.mtimeMs,
      oldChars: oldText.length,
      newChars: newText.length,
    }
  })

  // 19. builtin.vault.resolve-ref —— 校验知识页引用名（场景 A：AI 写 [[链接]] 前确认目标标题）
  registerTool({
    name: 'builtin.vault.resolve-ref',
    title: '校验页面引用名',
    description: '输入拟引用的标题（可带 [[ ]]），返回知识库中存在的页面标题/id 与是否精确命中。写 [[链接]] 前先调用本工具确认，避免死链',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '拟引用标题，如 内存管理 或 [[内存管理]]' },
      },
      required: ['ref'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    requires: 'read',
    vaultFile: 'read',
  }, args => {
    const raw = str(args.ref).trim()
    if (!raw) throw new Error('缺少必填参数: ref')
    const want = raw.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim()
    if (!want) throw new Error('引用名为空')
    let pages: Array<{ id: string; title: string; path: string }> = []
    try {
      pages = getKnowledgeIndex().pages
        .filter(p => p.status !== 'draft')
        .map(p => ({ id: p.id, title: p.title, path: p.path }))
    } catch { /* 索引未就绪时按空处理 */ }
    const exact = pages.filter(p => p.title === want)
    const fuzzy = pages.filter(p => p.title.includes(want)).slice(0, 10)
    const matched = exact.length > 0 ? exact.slice(0, 5) : fuzzy
    return {
      ref: want,
      exact: exact.length > 0,
      totalPages: pages.length,
      matches: matched,
      hint: matched.length === 0 ? '未找到匹配页面标题；可用 vault.search 搜内容定位后用其标题作为引用' : undefined,
    }
  })

  // ===== vault.* 高危整理工具（B3/F3）：rename/trash 走回收站语义，全程审计 =====

  // 20. builtin.vault.rename —— 重命名/移动 .md/.txt（跨目录；目标已存在拒绝）
  registerTool({
    name: 'builtin.vault.rename',
    title: '重命名/移动仓库文件',
    description: '重命名或移动仓库内 .md/.txt 文件（同 ws:rename 语义）。若 newPath 是已存在目录则移入该目录；否则按新文件名改名。危险操作：全程审计且不可自动回滚（回收站可恢复需先 trash）',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '当前仓库内相对文件路径' },
        newPath: { type: 'string', description: '目标：新相对路径（含新文件名），或已存在目录（表示移入）' },
      },
      required: ['path', 'newPath'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    vaultFile: 'write',
  }, args => {
    const rel = str(args.path).trim()
    const newRel = str(args.newPath).trim()
    if (!rel || !newRel) throw new Error('缺少必填参数: path / newPath')
    const root = vaultRootPath()
    const oldAbs = resolveSafe(root, rel)
    if (!oldAbs) throw new Error(`源路径非法或越出仓库: ${rel}`)
    const newAbs = resolveSafe(root, newRel)
    if (!newAbs) throw new Error(`目标路径非法或越出仓库: ${newRel}`)
    // 源必须是普通区 .md/.txt（目录或 .knowbase 内一律不开放 AI rename）
    if (!isAiWritableFile(root, oldAbs)) throw new Error('仅可重命名/移动仓库内普通 .md/.txt 文件（.knowbase 内部数据禁动）')
    let targetIsDir = false
    try { targetIsDir = statSync(newAbs).isDirectory() } catch { /* 目标不存在=改名 */ }
    let finalNewRel = newRel
    if (targetIsDir) {
      // 移入目录：保持文件名
      finalNewRel = join(relative(root, newAbs), baseNameOf(rel)).replace(/\\/g, '/')
      if (!finalNewRel) throw new Error('目标目录与源在同一位置')
    } else {
      // 改名/移动到新文件名：目标也须普通区 .md/.txt
      const probe = newAbs
      if (!isAiWritableFile(root, probe)) throw new Error('目标须为仓库内普通 .md/.txt 路径')
    }
    const finalAbs = resolveSafe(root, finalNewRel)
    if (!finalAbs) throw new Error('目标路径非法')
    const rootId = getCurrentVault()?.rootId
    if (!rootId) throw new Error('仓库上下文未就绪')
    try { mkdirSync(dirname(finalAbs), { recursive: true }) } catch { /* 目录已存在 */ }
    renameWorkspacePath(rootId, rel, finalNewRel)
    return { ok: true, from: rel, to: finalNewRel }
  })

  // 21. builtin.vault.trash —— 移入系统回收站（绝不删除）
  registerTool({
    name: 'builtin.vault.trash',
    title: '移入回收站',
    description: '把仓库内 .md/.txt 移入系统回收站（可恢复，非永久删除）。危险操作：全程审计；执行前确认用户明确要求删除该文件',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库内相对文件路径' },
      },
      required: ['path'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    vaultFile: 'write',
  }, async args => {
    const rel = str(args.path).trim()
    if (!rel) throw new Error('缺少必填参数: path')
    const root = vaultRootPath()
    const abs = resolveSafe(root, rel)
    if (!abs) throw new Error(`路径非法或越出仓库: ${rel}`)
    if (!isAiWritableFile(root, abs)) throw new Error('仅可移入回收站普通区 .md/.txt 文件（.knowbase 内部数据禁动）')
    let isFile = false
    try { isFile = statSync(abs).isFile() } catch { throw new Error(`文件不存在: ${rel}`) }
    if (!isFile) throw new Error('vault.trash 仅支持文件（目录整理请用编辑器）')
    const rootId = getCurrentVault()?.rootId
    if (!rootId) throw new Error('仓库上下文未就绪')
    await trashWorkspacePath(rootId, rel)
    return { ok: true, trashed: rel }
  })

  // ===== web.read：通读 https 网页正文（场景 B「吃资料」，跨模块通用，不设 module） =====

  // 22. builtin.web.read —— 读指定网页全文（防 SSRF：仅 https，拒内网/IP）
  registerTool({
    name: 'builtin.web.read',
    title: '读取网页全文',
    description: '打开用户指定的 https 网页并读取正文纯文本（自动去导航/去标签、长度截断保护）。用于通读资料文章后总结、教学或提炼。仅 https；内网/私网/IP 直连与 http 一律拒绝',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整网页地址（必须以 https:// 开头）' },
        maxChars: { type: 'number', description: '最多返回字符，默认 8000' },
      },
      required: ['url'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
  }, async args => {
    const url = str(args.url).trim()
    if (!url) throw new Error('缺少必填参数: url')
    const maxChars = clamp(Math.floor(num(args.maxChars, 8000)), 200, 50000)
    const out = await webReadPage(url, maxChars)
    return {
      url: out.url,
      title: out.title,
      content: out.content,
      truncated: out.truncated,
      totalChars: out.totalChars,
    }
  })

  // ===== docs.read-text：仓库内 PDF/PPT 文本提取（场景 B「复习资料」，vaultFile=read） =====

  // 23. builtin.docs.read-text —— 提取仓库内 .pdf/.pptx 的文本
  registerTool({
    name: 'builtin.docs.read-text',
    title: '提取 PDF/PPT 文本',
    description: '从仓库内 .pdf/.pptx 提取文字内容（纯文本，供通读总结/出复习资料）。扫描版 PDF（纯图片）提取结果为空属预期；.md/.txt 请用 vault.read；Word 暂不支持',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库内相对文件路径（.pdf 或 .pptx）' },
        maxChars: { type: 'number', description: '最多返回字符，默认 12000' },
      },
      required: ['path'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    requires: 'read',
    vaultFile: 'read',
  }, async args => {
    const rel = str(args.path).trim()
    if (!rel) throw new Error('缺少必填参数: path')
    const maxChars = clamp(Math.floor(num(args.maxChars, 12000)), 200, 50000)
    const root = vaultRootPath()
    const abs = resolveSafe(root, rel)
    if (!abs) throw new Error(`路径非法或越出仓库: ${rel}`)
    if (!isAiDocFile(root, abs)) {
      throw new Error('仅支持仓库内普通目录的 .pdf/.pptx（.md/.txt 用 vault.read；其他类型与保护区拒绝）')
    }
    let out: { kind: 'pdf' | 'pptx'; text: string; pages: number; totalChars: number }
    try {
      out = await extractDocText(abs)
    } catch (err) {
      throw new Error(`文档解析失败：${String((err as Error)?.message ?? err).slice(0, 200)}`)
    }
    const truncated = out.totalChars > maxChars
    return {
      kind: out.kind,
      path: rel,
      pages: out.pages,
      totalChars: out.totalChars,
      text: truncated ? out.text.slice(0, maxChars) : out.text,
      truncated,
    }
  })
}
