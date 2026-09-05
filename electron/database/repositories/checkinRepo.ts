import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { isVaultDataSource } from '../dataSourceMode'
import { notifyCheckin } from '../../lib/pushService'
import type { LinkSource } from '../../lib/habitLinkService'
import {
  vaultHabitsAll,
  vaultHabitsSave,
  vaultHabitsExists,
  vaultRecordsAll,
  vaultRecordsSave,
  vaultHabitRecordAddIfAbsent,
  vaultHabitRecordRemove,
  type HabitRow,
  type RecordRow,
} from '../../lib/kbStore/habitVaultRepo'

/**
 * 打卡模块（migration 038/048）：习惯 CRUD/归档/排序 + 单日打卡 toggle + 记录查询。
 * 去库化（storageData=vault）：habits / habit_records 读写
 * `.knowbase/modules/checkin/{habits.json, records.json}`（见 habitVaultRepo），
 * 首次访问自动把 sqlite 存量整表播种到 json（之后 json 为权威源）；sqlite 路径原样保留。
 * 行结构=表行 snake_case 原样，SQL 语义（ORDER BY sort_order, created_at、
 * 删习惯连带记录、UNIQUE(habit_id,date) 的 INSERT OR IGNORE、排序批量 UPDATE）在内存复刻。
 * 注意：habit_links 不在本次迁移范围，vault 模式下联动规则仍存 sqlite（故 getAll 的 link
 * 映射、habitLink:* 的落库在两种数据源下走同一段 sqlite 代码）。
 */

interface LinkRow { habit_id: string; source: string; threshold: number; enabled: number }

export interface HabitDto {
  id: string; name: string; color: string
  ruleType: 'daily' | 'weekdays' | 'flexible'
  ruleDays: number[]; weeklyTarget: number
  sortOrder: number; archived: boolean; createdAt: string
  link?: { source: LinkSource; threshold: number; enabled: boolean } | null
}

const LINK_SOURCES: LinkSource[] = ['blog', 'pomodoro', 'schedule', 'knowledge']

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

/** 对标 sqlite datetime('now')：UTC 'YYYY-MM-DD HH:MM:SS' */
function sqlNow(): string {
  const s = new Date().toISOString()
  return `${s.slice(0, 10)} ${s.slice(11, 19)}`
}

/** vault 行序：ORDER BY sort_order ASC, created_at ASC（created_at 按 BINARY 比较，与 sqlite 一致） */
function vaultHabitsOrdered(): HabitRow[] {
  return vaultHabitsAll().sort((a, b) =>
    ((a.sort_order ?? 0) - (b.sort_order ?? 0))
    || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
}

/** vault 模式下联动规则仍在 sqlite；库异常时按无规则处理，不阻断打卡数据读取 */
function linkRowsSafe(): LinkRow[] {
  try {
    return queryAll<LinkRow>('SELECT habit_id, source, threshold, enabled FROM habit_links')
  } catch { return [] }
}

/**
 * 首次进入 vault 模式：把 sqlite 的 habits / habit_records 整表播种到 json。
 * 判据 = habits.json 是否存在（存在即已播种，空数组也算，幂等）；表缺失/库异常按空表处理。
 */
export function ensureCheckinVaultSeeded(): void {
  if (!isVaultDataSource()) return
  if (vaultHabitsExists()) return
  let habits: HabitRow[] = []
  let records: RecordRow[] = []
  try { habits = queryAll<HabitRow>('SELECT * FROM habits') } catch { habits = [] }
  try { records = queryAll<RecordRow>('SELECT id, habit_id, date, source FROM habit_records') } catch { records = [] }
  vaultHabitsSave(habits)
  vaultRecordsSave(records)
}

export function registerCheckinHandlers(): void {

  ipcMain.handle('habit:getAll', () => {
    if (isVaultDataSource()) {
      ensureCheckinVaultSeeded()
      const habits = vaultHabitsOrdered().map(rowToHabit)
      const records = vaultRecordsAll().map(r => ({
        id: r.id, habitId: r.habit_id, date: r.date, source: r.source,
      }))
      const links = linkRowsSafe()
      const linkMap = new Map(links.map(l => [l.habit_id, {
        source: l.source as LinkSource,
        threshold: l.threshold,
        enabled: l.enabled === 1,
      }]))
      for (const h of habits) h.link = linkMap.get(h.id) ?? null
      return { habits, records }
    }
    const habits = queryAll<HabitRow>('SELECT * FROM habits ORDER BY sort_order ASC, created_at ASC').map(rowToHabit)
    const records = queryAll<RecordRow>('SELECT id, habit_id, date, source FROM habit_records').map(r => ({
      id: r.id, habitId: r.habit_id, date: r.date, source: r.source,
    }))
    // 联动规则随习惯一起下发,前端编辑器据此回显
    const links = queryAll<LinkRow>('SELECT habit_id, source, threshold, enabled FROM habit_links')
    const linkMap = new Map(links.map(l => [l.habit_id, {
      source: l.source as LinkSource,
      threshold: l.threshold,
      enabled: l.enabled === 1,
    }]))
    for (const h of habits) h.link = linkMap.get(h.id) ?? null
    return { habits, records }
  })

  ipcMain.handle('habit:create', (_e, data: {
    name: string; color?: string; ruleType?: 'daily' | 'weekdays' | 'flexible'
    ruleDays?: number[]; weeklyTarget?: number; sortOrder?: number
  }) => {
    const id = randomUUID()
    if (isVaultDataSource()) {
      ensureCheckinVaultSeeded()
      const now = sqlNow()
      const row: HabitRow = {
        id,
        name: data.name,
        color: data.color || '#3B82F6',
        icon: 'check',
        rule_type: data.ruleType || 'daily',
        rule_days: JSON.stringify(data.ruleDays && data.ruleDays.length > 0 ? data.ruleDays : [1, 2, 3, 4, 5]),
        weekly_target: Math.min(7, Math.max(1, data.weeklyTarget ?? 3)),
        sort_order: data.sortOrder ?? Date.now(),
        archived: 0,
        created_at: now,
        updated_at: now,
      }
      vaultHabitsSave([...vaultHabitsAll(), row])
      return rowToHabit(row)
    }
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
    if (isVaultDataSource()) {
      ensureCheckinVaultSeeded()
      const rows = vaultHabitsAll()
      const i = rows.findIndex(r => r.id === id)
      if (i >= 0) {
        const cur = rows[i]
        rows[i] = {
          ...cur,
          name: data.name !== undefined ? data.name : cur.name,
          color: data.color !== undefined ? data.color : cur.color,
          rule_type: data.ruleType !== undefined ? data.ruleType : cur.rule_type,
          rule_days: data.ruleDays !== undefined ? JSON.stringify(data.ruleDays) : cur.rule_days,
          weekly_target: data.weeklyTarget !== undefined ? Math.min(7, Math.max(1, data.weeklyTarget)) : cur.weekly_target,
          sort_order: data.sortOrder !== undefined ? data.sortOrder : cur.sort_order,
          archived: data.archived !== undefined ? (data.archived ? 1 : 0) : cur.archived,
          updated_at: sqlNow(),
        }
        vaultHabitsSave(rows)
      }
      // 与 sqlite 语义一致：无此习惯 → UPDATE 0 行，回读为空（rowToHabit 抛出 → ipc 拒绝）
      return rowToHabit(vaultHabitsAll().find(r => r.id === id) as HabitRow)
    }
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
    if (isVaultDataSource()) {
      ensureCheckinVaultSeeded()
      // 删除习惯连带记录（与 sqlite 语义一致）；habit_links 仍在 sqlite，顺带清掉避免残留
      vaultRecordsSave(vaultRecordsAll().filter(r => r.habit_id !== id))
      vaultHabitsSave(vaultHabitsAll().filter(h => h.id !== id))
      try { run('DELETE FROM habit_links WHERE habit_id = ?', [id]) } catch { /* 联动表未就绪时忽略 */ }
      return
    }
    run('DELETE FROM habit_records WHERE habit_id = ?', [id])
    run('DELETE FROM habit_links WHERE habit_id = ?', [id])
    run('DELETE FROM habits WHERE id = ?', [id])
  })

  ipcMain.handle('habit:toggleCheck', (_e, habitId: string, date: string) => {
    if (isVaultDataSource()) {
      ensureCheckinVaultSeeded()
      const has = vaultRecordsAll().some(r => r.habit_id === habitId && r.date === date)
      if (has) {
        vaultHabitRecordRemove(habitId, date)
        return { checked: false }
      }
      vaultHabitRecordAddIfAbsent(habitId, date, 'manual')
      // 远程监督：打卡成功后异步推送（静默失败，不影响打卡本身）
      void notifyCheckin(habitId, date)
      return { checked: true }
    }
    const existing = queryAll<RecordRow>(
      'SELECT id FROM habit_records WHERE habit_id = ? AND date = ? LIMIT 1',
      [habitId, date]
    )
    if (existing.length > 0) {
      run('DELETE FROM habit_records WHERE id = ?', [existing[0].id])
      return { checked: false }
    }
    run(
      "INSERT INTO habit_records (id, habit_id, date, source) VALUES (?, ?, ?, 'manual')",
      [randomUUID(), habitId, date]
    )
    // 远程监督：打卡成功后异步推送（静默失败，不影响打卡本身）
    void notifyCheckin(habitId, date)
    return { checked: true }
  })

  ipcMain.handle('habit:reorder', (_e, orderedIds: string[]) => {
    if (isVaultDataSource()) {
      ensureCheckinVaultSeeded()
      // 与 sqlite 语义一致：仅命中的 id 批量更新 sort_order（i + now - len），其余保持
      const now = Date.now()
      const rank = new Map(orderedIds.map((id, i) => [id, i]))
      const rows = vaultHabitsAll()
      for (const r of rows) {
        const i = rank.get(r.id)
        if (i !== undefined) r.sort_order = i + now - orderedIds.length
      }
      vaultHabitsSave(rows)
      return
    }
    const now = Date.now()
    orderedIds.forEach((id, i) => {
      run('UPDATE habits SET sort_order = ? WHERE id = ?', [i + now - orderedIds.length, id])
    })
  })

  // 联动规则:link 为 null 表示解除绑定;UNIQUE(habit_id) → 一个习惯至多一条规则
  // （habit_links 表不在迁移范围：规则本身两种数据源都落 sqlite，vault 下仅存在性校验改查 json）
  ipcMain.handle('habitLink:save', (_e, habitId: string, link: { source: LinkSource; threshold: number; enabled: boolean } | null) => {
    if (isVaultDataSource()) {
      ensureCheckinVaultSeeded()
      if (link === null) {
        run('DELETE FROM habit_links WHERE habit_id = ?', [habitId])
        return
      }
      if (!LINK_SOURCES.includes(link.source)) throw new Error(`未知的联动来源: ${link.source}`)
      if (!vaultHabitsAll().some(h => h.id === habitId)) throw new Error('习惯不存在')
      const threshold = Math.max(1, Math.round(link.threshold || 1))
      run('DELETE FROM habit_links WHERE habit_id = ?', [habitId])
      run(
        'INSERT INTO habit_links (id, habit_id, source, threshold, enabled) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), habitId, link.source, threshold, link.enabled ? 1 : 0]
      )
      return
    }
    if (link === null) {
      run('DELETE FROM habit_links WHERE habit_id = ?', [habitId])
      return
    }
    if (!LINK_SOURCES.includes(link.source)) throw new Error(`未知的联动来源: ${link.source}`)
    const habit = queryAll<HabitRow>('SELECT id FROM habits WHERE id = ?', [habitId])
    if (habit.length === 0) throw new Error('习惯不存在')
    const threshold = Math.max(1, Math.round(link.threshold || 1))
    run('DELETE FROM habit_links WHERE habit_id = ?', [habitId])
    run(
      'INSERT INTO habit_links (id, habit_id, source, threshold, enabled) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), habitId, link.source, threshold, link.enabled ? 1 : 0]
    )
  })

  ipcMain.handle('habitLink:remove', (_e, habitId: string) => {
    // habit_links 仍在 sqlite，两种数据源下同语义
    run('DELETE FROM habit_links WHERE habit_id = ?', [habitId])
  })
}
