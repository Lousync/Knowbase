import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../../database/connection'
import { throwErr } from '../response'

/**
 * 测试数据的重置与构造。
 *
 * 说明：本文件独立实现数据写入（不改动既有 Repository），但严格遵循相同的
 * 表结构与约束（如博客同日期唯一、打卡 UNIQUE(habit_id, date)），
 * 以保证「构造出的场景」与各模块真实读写的数据形态一致。
 *
 * 仅 dev 数据目录可用：dev 模式数据落在 %APPDATA%/knowbase (dev)，与正式数据完全隔离。
 */

/** 业务数据表（不含 _migrations），reset 时逐张清空 */
const BUSINESS_TABLES = [
  'entry_tags',
  'entries',
  'tags',
  'schedule_todos',
  'schedule_tags',
  'knowledge_links',
  'knowledge_manual_links',
  'knowledge_page_tags',
  'knowledge_pages',
  'knowledge_tags',
  'knowledge_categories',
  'knowledge_pack_imports',
  'recycle_bin',
  'toolbox_scripts',
  'toolbox_passwords',
  'toolbox_weight_records',
  'moments_posts',
  'moments_albums',
  'attachments',
  'habit_records',
  'habits',
  'bookmarks',
  'bookmark_categories',
  'supervise_log',
  'supervise_config',
  'pomodoro_sessions',
  'blog_templates',
  'plugin_audit_log',
  'mcp_servers',
  'agent_messages',
  'agent_sessions',
] as const

function dateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return dateStr(d)
}

export interface ResetResult {
  cleared: string[]
  skipped: string[]
}

export function resetData(tables?: string[]): ResetResult {
  const targets = tables && tables.length > 0 ? tables : [...BUSINESS_TABLES]
  // 白名单校验：拒绝任何不在已知表清单里的名字，防止拼错或注入
  const allowed = new Set<string>([...BUSINESS_TABLES])
  const unknown = targets.filter((t) => !allowed.has(t))
  if (unknown.length > 0) {
    throwErr('E_BAD_REQUEST', '未知表名', { unknown })
  }

  const db = getDatabase()
  const cleared: string[] = []
  const skipped: string[] = []
  db.run('BEGIN')
  try {
    for (const t of targets) {
      try {
        db.run(`DELETE FROM ${t}`)
        cleared.push(t)
      } catch {
        skipped.push(t)
      }
    }
    db.run('COMMIT')
  } catch (e) {
    try {
      db.run('ROLLBACK')
    } catch {
      /* ignore */
    }
    throwErr('E_ACTION_FAILED', '重置失败，已回滚', { message: String(e) })
  }
  saveToDisk()
  return { cleared, skipped }
}

export type Scenario = 'blog30d' | 'habits' | 'knowledge' | 'full'

const SCENARIOS: Scenario[] = ['blog30d', 'habits', 'knowledge', 'full']

function seedBlogs(days: number): number {
  const db = getDatabase()
  const now = new Date().toISOString()
  let count = 0
  for (let i = days - 1; i >= 0; i--) {
    const date = daysAgo(i)
    const existing = db.exec(`SELECT id FROM entries WHERE date = '${date}' LIMIT 1`)
    if (existing.length > 0 && existing[0].values.length > 0) continue
    const content = `## ${date}\n\n这是第 ${days - i} 天的测试日志。\n\n- 完成了若干事项\n- 记录一些想法\n`
    db.run(
      `INSERT INTO entries (id, title, content_md, content_html, date, created_at, updated_at, word_count, states)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, '')`,
      [randomUUID(), date, content, date, now, now, content.replace(/\s/g, '').length]
    )
    count++
  }
  saveToDisk()
  return count
}

function seedHabits(days: number): { habits: number; records: number } {
  const db = getDatabase()
  const now = new Date().toISOString()
  const created: string[] = []
  const defs = [
    { name: '写日志', color: '#3B82F6' },
    { name: '早起', color: '#10B981' },
    { name: '阅读', color: '#F59E0B' },
  ]
  for (let i = 0; i < defs.length; i++) {
    const id = randomUUID()
    db.run(
      `INSERT INTO habits (id, name, color, icon, rule_type, rule_days, weekly_target, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, 'check', 'daily', '[1,2,3,4,5,6,0]', 3, ?, 0, ?, ?)`,
      [id, defs[i].name, defs[i].color, i, now, now]
    )
    created.push(id)
  }

  let records = 0
  // 第一个习惯连续全勤；第二个隔天（制造中断，便于验证连击与完成率）；第三个随机
  for (let d = days - 1; d >= 0; d--) {
    const date = daysAgo(d)
    const idx = days - 1 - d
    if (created[0]) {
      db.run('INSERT OR IGNORE INTO habit_records (id, habit_id, date, created_at) VALUES (?,?,?,?)', [
        randomUUID(),
        created[0],
        date,
        now,
      ])
      records++
    }
    if (created[1] && idx % 2 === 0) {
      db.run('INSERT OR IGNORE INTO habit_records (id, habit_id, date, created_at) VALUES (?,?,?,?)', [
        randomUUID(),
        created[1],
        date,
        now,
      ])
      records++
    }
    if (created[2] && idx % 3 === 0) {
      db.run('INSERT OR IGNORE INTO habit_records (id, habit_id, date, created_at) VALUES (?,?,?,?)', [
        randomUUID(),
        created[2],
        date,
        now,
      ])
      records++
    }
  }
  saveToDisk()
  return { habits: created.length, records }
}

function seedKnowledge(pages: number): { spaces: number; notebooks: number; pages: number } {
  const db = getDatabase()
  const now = new Date().toISOString()
  const spaceId = randomUUID()
  db.run(
    `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type, created_at, updated_at)
     VALUES (?, '测试空间', NULL, 0, 'space', ?, ?)`,
    [spaceId, now, now]
  )
  const notebookId = randomUUID()
  db.run(
    `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type, created_at, updated_at)
     VALUES (?, '测试笔记本', ?, 0, 'notebook', ?, ?)`,
    [notebookId, spaceId, now, now]
  )
  const chapterId = randomUUID()
  db.run(
    `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type, created_at, updated_at)
     VALUES (?, '第一章', ?, 0, 'folder', ?, ?)`,
    [chapterId, notebookId, now, now]
  )

  for (let i = 1; i <= pages; i++) {
    const content = `# 测试页面 ${i}\n\n正文内容，引用 [[测试页面 ${((i % pages) + 1)}]] 形成双链。\n`
    db.run(
      `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, '', ?, ?, ?, ?)`,
      [randomUUID(), `测试页面 ${i}`, content, chapterId, now, now, i]
    )
  }
  saveToDisk()
  return { spaces: 1, notebooks: 1, pages }
}

export interface SeedResult {
  scenario: Scenario
  days: number
  detail: Record<string, number>
}

export function seedData(scenario: Scenario, days = 30): SeedResult {
  if (!SCENARIOS.includes(scenario)) {
    throwErr('E_BAD_REQUEST', '未知场景', { scenario, allowed: SCENARIOS })
  }

  const detail: Record<string, number> = {}
  if (scenario === 'blog30d' || scenario === 'full') {
    detail.entries = seedBlogs(days)
  }
  if (scenario === 'habits' || scenario === 'full') {
    const r = seedHabits(days)
    detail.habits = r.habits
    detail.habitRecords = r.records
  }
  if (scenario === 'knowledge' || scenario === 'full') {
    const r = seedKnowledge(Math.max(5, Math.min(days, 20)))
    detail.spaces = r.spaces
    detail.notebooks = r.notebooks
    detail.knowledgePages = r.pages
  }
  return { scenario, days, detail }
}
