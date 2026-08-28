import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../../database/connection'
import { notifyCheckin } from '../../lib/pushService'
import { throwErr } from '../response'

/**
 * 核心业务流程 —— 让 AI 不经过 UI 即可触发真实业务路径。
 *
 * 与 data.ts（造数据）的区别：这里走的是与模块一致的操作语义，
 * 例如打卡会真实触发远程监督推送（复用 pushService.notifyCheckin），
 * 因此可用于验证「行为 → 副作用」的完整链路。
 */

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throwErr('E_BAD_REQUEST', `缺少参数 ${name}`)
  return v
}

function localDate(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// ---------- 博客 ----------

export function blogCreate(params: Record<string, unknown>) {
  const date = requireString(params.date ?? localDate(), 'date')
  const title = typeof params.title === 'string' ? params.title : date
  const contentMd = typeof params.contentMd === 'string' ? params.contentMd : ''
  const db = getDatabase()
  const now = new Date().toISOString()

  // 与业务一致：同一天只允许一篇，已存在则直接返回
  const existing = db.exec(`SELECT id FROM entries WHERE date = ? LIMIT 1`, [date])
  if (existing.length > 0 && existing[0].values.length > 0) {
    const id = String(existing[0].values[0][0])
    return { id, date, created: false, reason: '该日期已存在日志' }
  }

  const id = randomUUID()
  db.run(
    `INSERT INTO entries (id, title, content_md, content_html, date, created_at, updated_at, word_count, states)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, '')`,
    [id, title, contentMd, date, now, now, contentMd.replace(/\s/g, '').length]
  )
  saveToDisk()
  return { id, date, created: true }
}

export function blogUpdate(params: Record<string, unknown>) {
  const id = requireString(params.id, 'id')
  const sets: string[] = ["updated_at = ?"]
  const values: unknown[] = [new Date().toISOString()]
  if (typeof params.title === 'string') {
    sets.push('title = ?')
    values.push(params.title)
  }
  if (typeof params.contentMd === 'string') {
    sets.push('content_md = ?')
    values.push(params.contentMd)
    sets.push('word_count = ?')
    values.push(params.contentMd.replace(/\s/g, '').length)
  }
  values.push(id)
  getDatabase().run(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`, values)
  saveToDisk()
  return { id, updated: true }
}

// ---------- 习惯打卡 ----------

export function habitCreate(params: Record<string, unknown>) {
  const name = requireString(params.name, 'name')
  const id = randomUUID()
  const now = new Date().toISOString()
  getDatabase().run(
    `INSERT INTO habits (id, name, color, icon, rule_type, rule_days, weekly_target, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, '#3B82F6', 'check', 'daily', '[1,2,3,4,5,6,0]', 3, ?, 0, ?, ?)`,
    [id, name, Date.now(), now, now]
  )
  saveToDisk()
  return { id, name }
}

export function habitCheck(params: Record<string, unknown>) {
  const habitId = requireString(params.habitId, 'habitId')
  const date = typeof params.date === 'string' ? params.date : localDate()
  const db = getDatabase()

  const exists = db.exec('SELECT id FROM habits WHERE id = ? LIMIT 1', [habitId])
  if (exists.length === 0 || !exists[0].values.length) {
    throwErr('E_BAD_REQUEST', '习惯不存在', { habitId })
  }

  db.run('INSERT OR IGNORE INTO habit_records (id, habit_id, date, created_at) VALUES (?, ?, ?, ?)', [
    randomUUID(),
    habitId,
    date,
    new Date().toISOString(),
  ])
  const inserted = db.getRowsModified() > 0
  saveToDisk()

  // 仅真正新打卡才推送，避免重复保存骚扰监督者
  if (inserted) void notifyCheckin(habitId, date)

  return { habitId, date, checked: inserted, alreadyChecked: !inserted, notified: inserted }
}

export function habitUncheck(params: Record<string, unknown>) {
  const habitId = requireString(params.habitId, 'habitId')
  const date = typeof params.date === 'string' ? params.date : localDate()
  getDatabase().run('DELETE FROM habit_records WHERE habit_id = ? AND date = ?', [habitId, date])
  saveToDisk()
  return { habitId, date, checked: false }
}

// ---------- 日程 ----------

export function scheduleCreateTodo(params: Record<string, unknown>) {
  const title = requireString(params.title, 'title')
  const date = typeof params.date === 'string' ? params.date : localDate()
  const quadrant = Number(params.quadrant ?? 1)
  const id = randomUUID()
  const now = new Date().toISOString()
  getDatabase().run(
    `INSERT INTO schedule_todos (id, title, description, date, quadrant, task_type, status, sort_order, end_criteria, created_at, updated_at)
     VALUES (?, ?, '', ?, ?, 'plan', 'pending', 0, '', ?, ?)`,
    [id, title, date, Number.isFinite(quadrant) ? quadrant : 1, now, now]
  )
  saveToDisk()
  return { id, title, date }
}

export function scheduleCompleteTodo(params: Record<string, unknown>) {
  const id = requireString(params.id, 'id')
  getDatabase().run(
    "UPDATE schedule_todos SET status = 'done', updated_at = ? WHERE id = ?",
    [new Date().toISOString(), id]
  )
  saveToDisk()
  return { id, status: 'done' }
}

// ---------- 番茄钟 ----------

export function pomodoroComplete(params: Record<string, unknown>) {
  const minutes = Number(params.minutes ?? 25)
  const finalMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 25
  const id = randomUUID()
  const now = new Date()
  getDatabase().run(
    `INSERT INTO pomodoro_sessions (id, minutes, date, created_at) VALUES (?, ?, ?, ?)`,
    [id, finalMinutes, localDate(), now.toISOString()]
  )
  saveToDisk()
  return { id, minutes: finalMinutes, date: localDate() }
}

// ---------- 知识库 ----------

export function knowledgeCreatePage(params: Record<string, unknown>) {
  const title = requireString(params.title, 'title')
  const contentMd = typeof params.contentMd === 'string' ? params.contentMd : ''
  const categoryId = typeof params.categoryId === 'string' ? params.categoryId : null
  const id = randomUUID()
  const now = new Date().toISOString()
  getDatabase().run(
    `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, created_at, updated_at, sort_order)
     VALUES (?, ?, ?, '', ?, ?, ?, 0)`,
    [id, title, contentMd, categoryId, now, now]
  )
  saveToDisk()
  return { id, title }
}
