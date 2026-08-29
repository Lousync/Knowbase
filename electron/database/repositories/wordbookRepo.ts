import { getDatabase, saveToDisk } from '../connection'

/** 生词本（迁移 051）：词条 + SRS 状态 + 每日学习量 */

export type WordbookStatus = 'learning' | 'mastered'
export type WordFeedback = 'known' | 'fuzzy' | 'unknown'

export interface WordbookEntryRow {
  word: string
  status: WordbookStatus
  source: string
  added_at: string
  first_answer_at: string | null
  last_review_at: string | null
  due_at: string
  interval_days: number
  ease: number
  streak: number
  review_count: number
  correct_count: number
  fuzzy_count: number
  wrong_count: number
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDatabase().prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

export function getWordbookEntry(word: string): WordbookEntryRow | null {
  const rows = queryAll<WordbookEntryRow>('SELECT * FROM wordbook_entries WHERE word = ?', [word])
  return rows.length > 0 ? rows[0] : null
}

export function listWordbookEntries(status?: WordbookStatus): WordbookEntryRow[] {
  if (status) {
    return queryAll<WordbookEntryRow>('SELECT * FROM wordbook_entries WHERE status = ? ORDER BY due_at ASC, word ASC', [status])
  }
  return queryAll<WordbookEntryRow>('SELECT * FROM wordbook_entries ORDER BY added_at DESC, word ASC LIMIT 2000')
}

export function countWordbookEntries(status: WordbookStatus, sourcePrefix?: string): number {
  const rows = sourcePrefix
    ? queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM wordbook_entries WHERE status = ? AND source LIKE ?', [status, sourcePrefix + '%'])
    : queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM wordbook_entries WHERE status = ?', [status])
  return rows[0]?.n ?? 0
}

export function upsertWordbookEntry(word: string, source: string): void {
  run(
    `INSERT INTO wordbook_entries (word, source) VALUES (?, ?)
     ON CONFLICT(word) DO UPDATE SET
       status = 'learning',
       due_at = datetime('now', 'localtime'),
       interval_days = 0,
       streak = 0`,
    [word, source]
  )
}

export function deleteWordbookEntry(word: string): void {
  run('DELETE FROM wordbook_entries WHERE word = ?', [word])
}

export function setWordbookMastered(word: string, mastered: boolean): void {
  if (mastered) {
    // 斩词：移出复习队列，进度保留
    run("UPDATE wordbook_entries SET status = 'mastered', due_at = '9999-12-31' WHERE word = ?", [word])
  } else {
    // 取消斩词：回到学习队列，明天再见面
    run("UPDATE wordbook_entries SET status = 'learning', due_at = datetime('now', '+1 day', 'localtime') WHERE word = ?", [word])
  }
}

/** 应用一次记忆反馈并推进 SRS（simplified SM-2）。
 *  调用方保证词条已存在：新词先 upsertWordbookEntry 再调本函数。 */
export function applyWordFeedback(word: string, feedback: WordFeedback): WordbookEntryRow | null {
  const entry = getWordbookEntry(word)
  const isNew = !entry?.first_answer_at

  // 首答决定长期间隔（墨墨式两层反馈），间隔序列 1→2→4→8→15→30→60 天
  const LADDER = [1, 2, 4, 8, 15, 30, 60]
  let interval: number
  let ease = entry?.ease ?? 2.5
  let streak = entry?.streak ?? 0

  if (feedback === 'known') {
    streak += 1
    ease = Math.min(3.0, ease + 0.03)
    if (isNew) interval = LADDER[Math.min(streak - 1, LADDER.length - 1)]
    else interval = Math.min((entry!.interval_days || 1) * ease, 365)
  } else if (feedback === 'fuzzy') {
    // 模糊：小步回退，不清零（蒙对/拼写小错≠忘记）
    streak = Math.max(0, streak - 1)
    ease = Math.max(1.3, ease - 0.05)
    interval = Math.max(1, Math.floor((entry?.interval_days || 1) * 0.6))
  } else {
    // 不认识：清零，今天内再见
    streak = 0
    ease = Math.max(1.3, ease - 0.2)
    interval = 0
  }

  const dueExpr = interval === 0 ? "datetime('now', 'localtime')" : `datetime('now', '+${Math.round(interval)} day', 'localtime')`
  run(
    `UPDATE wordbook_entries SET
       first_answer_at = COALESCE(first_answer_at, datetime('now', 'localtime')),
       last_review_at = datetime('now', 'localtime'),
       due_at = ${dueExpr},
       interval_days = ?,
       ease = ?,
       streak = ?,
       review_count = review_count + 1,
       correct_count = correct_count + ?,
       fuzzy_count = fuzzy_count + ?,
       wrong_count = wrong_count + ?
     WHERE word = ?`,
    [interval, ease, streak,
      feedback === 'known' ? 1 : 0,
      feedback === 'fuzzy' ? 1 : 0,
      feedback === 'unknown' ? 1 : 0,
      word]
  )
  return getWordbookEntry(word)
}

// ===== 每日学习量 =====

export function todayKey(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function getDailyStat(date: string): { new_words: number; reviewed: number } {
  const rows = queryAll<{ new_words: number; reviewed: number }>('SELECT new_words, reviewed FROM wordbook_daily WHERE date = ?', [date])
  return rows[0] ?? { new_words: 0, reviewed: 0 }
}

export function bumpDailyStat(date: string, isNew: boolean): void {
  run(
    `INSERT INTO wordbook_daily (date, new_words, reviewed) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       new_words = new_words + ?,
       reviewed = reviewed + ?`,
    [date, isNew ? 1 : 0, 1, isNew ? 1 : 0, 1]
  )
}

/** 最近 N 天每日学习量（含无学习日的 0，用于连续天数与趋势） */
export function listDailyStats(days: number): { date: string; new_words: number; reviewed: number }[] {
  return queryAll<{ date: string; new_words: number; reviewed: number }>(
    'SELECT * FROM wordbook_daily ORDER BY date DESC LIMIT ?', [days]
  )
}
