import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { notifyCheckin } from '../../lib/pushService'

interface HabitRow {
  id: string; name: string; color: string; icon: string
  rule_type: string; rule_days: string; weekly_target: number
  sort_order: number; archived: number
  created_at: string; updated_at: string
}

interface RecordRow { id: string; habit_id: string; date: string }

export interface HabitDto {
  id: string; name: string; color: string
  ruleType: 'daily' | 'weekdays' | 'flexible'
  ruleDays: number[]; weeklyTarget: number
  sortOrder: number; archived: boolean; createdAt: string
}

function parseDays(json: string): number[] {
  try { const v = JSON.parse(json); if (Array.isArray(v)) return v.map(Number) } catch { /* ignore */ }
  return [1, 2, 3, 4, 5]
}

function rowToHabit(row: HabitRow): HabitDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    ruleType: (row.rule_type as HabitDto['ruleType']) || 'daily',
    ruleDays: parseDays(row.rule_days),
    weeklyTarget: row.weekly_target ?? 3,
    sortOrder: row.sort_order ?? 0,
    archived: !!row.archived,
    createdAt: row.created_at,
  }
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
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

export function registerCheckinHandlers(): void {

  ipcMain.handle('habit:getAll', () => {
    const habits = queryAll<HabitRow>('SELECT * FROM habits ORDER BY sort_order ASC, created_at ASC').map(rowToHabit)
    const records = queryAll<RecordRow>('SELECT id, habit_id, date FROM habit_records').map(r => ({
      id: r.id, habitId: r.habit_id, date: r.date,
    }))
    return { habits, records }
  })

  ipcMain.handle('habit:create', (_e, data: {
    name: string; color?: string; ruleType?: 'daily' | 'weekdays' | 'flexible'
    ruleDays?: number[]; weeklyTarget?: number; sortOrder?: number
  }) => {
    const id = randomUUID()
    run(
      `INSERT INTO habits (id, name, color, icon, rule_type, rule_days, weekly_target, sort_order, archived)
       VALUES (?, ?, ?, 'check', ?, ?, ?, ?, 0)`,
      [
        id,
        data.name,
        data.color || '#3B82F6',
        data.ruleType || 'daily',
        JSON.stringify(data.ruleDays && data.ruleDays.length > 0 ? data.ruleDays : [1, 2, 3, 4, 5]),
        Math.min(7, Math.max(1, data.weeklyTarget ?? 3)),
        data.sortOrder ?? Date.now(),
      ]
    )
    return rowToHabit(queryAll<HabitRow>('SELECT * FROM habits WHERE id = ?', [id])[0])
  })

  ipcMain.handle('habit:update', (_e, id: string, data: {
    name?: string; color?: string
    ruleType?: 'daily' | 'weekdays' | 'flexible'
    ruleDays?: number[]; weeklyTarget?: number
    sortOrder?: number; archived?: boolean
  }) => {
    const sets: string[] = ["updated_at = datetime('now')"]
    const params: unknown[] = []
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name) }
    if (data.color !== undefined) { sets.push('color = ?'); params.push(data.color) }
    if (data.ruleType !== undefined) { sets.push('rule_type = ?'); params.push(data.ruleType) }
    if (data.ruleDays !== undefined) { sets.push('rule_days = ?'); params.push(JSON.stringify(data.ruleDays)) }
    if (data.weeklyTarget !== undefined) { sets.push('weekly_target = ?'); params.push(Math.min(7, Math.max(1, data.weeklyTarget))) }
    if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(data.sortOrder) }
    if (data.archived !== undefined) { sets.push('archived = ?'); params.push(data.archived ? 1 : 0) }
    params.push(id)
    run(`UPDATE habits SET ${sets.join(', ')} WHERE id = ?`, params)
    return rowToHabit(queryAll<HabitRow>('SELECT * FROM habits WHERE id = ?', [id])[0])
  })

  ipcMain.handle('habit:delete', (_e, id: string) => {
    run('DELETE FROM habit_records WHERE habit_id = ?', [id])
    run('DELETE FROM habits WHERE id = ?', [id])
  })

  ipcMain.handle('habit:toggleCheck', (_e, habitId: string, date: string) => {
    const existing = queryAll<RecordRow>(
      'SELECT id FROM habit_records WHERE habit_id = ? AND date = ? LIMIT 1',
      [habitId, date]
    )
    if (existing.length > 0) {
      run('DELETE FROM habit_records WHERE id = ?', [existing[0].id])
      return { checked: false }
    }
    run(
      'INSERT INTO habit_records (id, habit_id, date) VALUES (?, ?, ?)',
      [randomUUID(), habitId, date]
    )
    // 远程监督：打卡成功后异步推送（静默失败，不影响打卡本身）
    void notifyCheckin(habitId, date)
    return { checked: true }
  })

  ipcMain.handle('habit:reorder', (_e, orderedIds: string[]) => {
    const now = Date.now()
    orderedIds.forEach((id, i) => {
      run('UPDATE habits SET sort_order = ? WHERE id = ?', [i + now - orderedIds.length, id])
    })
  })
}
