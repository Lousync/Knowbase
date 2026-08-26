import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../database/connection'
import { registerTool } from './aiTools'
import type { ToolJsonSchema } from './aiTools'

/**
 * 内置只读工具首批清单（方案第六节）：给「未来 Agent」与外部 MCP 客户端的稳定契约。
 * 原则：输出面向 LLM 的紧凑结构（控制 token），不是 UI 数据结构直通；全部只读、零写库。
 * 统计口径与渲染层 habit-tracker/dateUtils.ts 同源（本地时区 YYYY-MM-DD、计划日跳过逻辑一致）。
 */

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

// ===== 六个内置工具 =====

const SEARCH_LIMIT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索关键词，多个词用空格分隔（AND 语义）' },
    limit: { type: 'number', description: '返回条数上限，默认 8，最大 50' },
  },
  required: ['query'],
} satisfies ToolJsonSchema

export function registerBuiltinTools(): void {

  // 1. builtin.knowledge.search —— 关键词搜索知识库页面
  registerTool({
    name: 'builtin.knowledge.search',
    title: '搜索知识库页面',
    description: '在个人知识库中按关键词搜索页面（匹配标题与正文），返回标题、命中摘录与页面 id。用 readKnowledgePage 阅读全文。',
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
    description: '按页面 id 读取知识库页面的 Markdown 全文。超长内容会截断（truncated=true 时可用 maxChars 参数分段读取）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id（来自 search 工具结果）' },
        maxChars: { type: 'number', description: '正文最多返回字符数，默认 8000，最大 50000' },
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
    description: '列出所有习惯及今日计划状态（今天是否计划打卡、是否已打卡）。配合 habits.stats 可查询连续天数与完成率。',
    inputSchema: { type: 'object', properties: {} },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'checkin',
  }, () => {
    const habits = queryAll('SELECT id, name, rule_type, rule_days, weekly_target, archived FROM habits ORDER BY sort_order ASC, created_at ASC')
    const today = formatLocalDate(new Date())
    const records = queryAll('SELECT habit_id, date FROM habit_records WHERE date = ?', [today])
    const checkedToday = new Set(records.map(r => str(r.habit_id)))
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
    description: '查询习惯的当前连续天数、最长连续、区间完成率与累计次数。不传 habitId 则返回全部习惯。',
    inputSchema: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: '习惯 id（来自 habits.list）；缺省统计全部' },
        days: { type: 'number', description: '完成率统计窗口天数，默认 30，最大 365' },
      },
    },
    source: 'builtin',
    enabled: true,
    readOnly: true,
    module: 'checkin',
  }, args => {
    const windowDays = clamp(Math.floor(num(args.days, 30)), 1, 365)
    const wanted = typeof args.habitId === 'string' && args.habitId ? [args.habitId] : null
    const habits = queryAll(
      'SELECT id, name, rule_type, rule_days, weekly_target FROM habits ORDER BY sort_order ASC'
    ).filter(h => !wanted || wanted.includes(str(h.id)))
    if (wanted && habits.length === 0) throw new Error(`习惯不存在: ${str(args.habitId)}`)
    const allRecords = queryAll('SELECT habit_id, date FROM habit_records')
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
    description: '在网址导航中按关键词搜索书签（匹配标题、URL 与描述），返回标题、链接与所属分类。',
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
    description: '统计最近 N 天（默认 7）每日专注分钟数与场次，以及窗口内合计。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计最近多少天（含今天），默认 7，最大 365' },
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
    const rows = queryAll(
      `SELECT date, COUNT(*) AS sessions, SUM(minutes) AS minutes
       FROM pomodoro_sessions WHERE date BETWEEN ? AND ?
       GROUP BY date ORDER BY date ASC`,
      [formatLocalDate(start), formatLocalDate(end)]
    )
    const byDate = new Map(rows.map(r => [str(r.date), r]))
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
    description: '按日期区间（含端点，本地时区 YYYY-MM-DD）查询待办事项，返回标题/日期/优先级/完成状态。',
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
    const rows = queryAll(
      `SELECT id, title, date, time, quadrant, status FROM schedule_todos
       WHERE date BETWEEN ? AND ? ORDER BY date ASC, sort_order ASC LIMIT 100`,
      [start, end]
    )
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
    description: '在知识库新建一个 Markdown 页面。可指定已有分类名（精确匹配），缺省放入未分类。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '页面标题' },
        contentMd: { type: 'string', description: 'Markdown 正文' },
        categoryName: { type: 'string', description: '可选：目标章节/文件夹名（精确匹配）' },
      },
      required: ['title', 'contentMd'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    module: 'knowledge',
  }, args => {
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
    description: '向已有页面末尾追加 Markdown 文本（不覆盖原内容）。支持按 id 或精确标题定位。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id（与 title 二选一）' },
        title: { type: 'string', description: '页面精确标题（与 id 二选一）' },
        text: { type: 'string', description: '要追加的 Markdown 文本' },
      },
      required: ['text'],
    },
    source: 'builtin',
    enabled: true,
    readOnly: false,
    requires: 'write',
    module: 'knowledge',
  }, args => {
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
    description: '在博客模块新建一篇日记。日期缺省为今天。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '日记标题（可为空字符串）' },
        contentMd: { type: 'string', description: 'Markdown 正文' },
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
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
    description: '在日程模块创建一条待办事项。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
        title: { type: 'string', description: '待办内容' },
        quadrant: { type: 'number', description: '四象限：0=紧急重要 1=重要不紧急 2=紧急不重要 3=不重要不紧急，默认 1' },
        time: { type: 'string', description: '可选 HH:mm' },
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
    description: '按名称为今天的习惯打卡（名称不区分大小写，支持部分匹配；已打卡则原样返回）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '习惯名称（或其一部分）' },
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
    const habits = queryAll('SELECT id, name FROM habits WHERE archived = 0')
    let hit = habits.find(h => str(h.name).toLowerCase() === q)
    if (!hit) hit = habits.find(h => str(h.name).toLowerCase().includes(q))
    if (!hit) throw new Error(`未找到匹配的习惯「${str(args.name)}」`)
    const date = todayLocal()
    const exist = queryAll('SELECT id FROM habit_records WHERE habit_id = ? AND date = ? LIMIT 1', [str(hit.id), date])
    if (exist.length > 0) return { ok: true, habitId: str(hit.id), name: str(hit.name), alreadyChecked: true }
    run('INSERT INTO habit_records (id, habit_id, date) VALUES (?, ?, ?)', [randomUUID(), str(hit.id), date])
    return { ok: true, habitId: str(hit.id), name: str(hit.name), checked: true }
  })
}
