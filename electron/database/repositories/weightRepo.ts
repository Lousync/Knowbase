import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { buildUpdateSet } from '../../lib/safeUpdate'
import { isVaultDataSource } from '../dataSourceMode'
import { vaultWeightAll, vaultWeightSave, vaultWeightExists } from '../../lib/kbStore/weightVaultRepo'

interface WeightRow {
  id: string; weight: number; date: string; series: string
  note: string | null; created_at: string
}

/** weight:update 可更新字段 = buildUpdateSet 列白名单（vault 分支沿用同一集合） */
type WeightUpdateData = { weight?: number; date?: string; series?: string; note?: string }

function rowToWeight(row: WeightRow) {
  return {
    id: row.id, weight: row.weight, date: row.date,
    series: row.series, note: row.note || '',
    createdAt: row.created_at
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

// ---- vault 路由（去库化 P2）：storageData=vault 时真相源 = .knowbase/modules/weight/records.json ----
// 行结构与表一致（snake_case），sqlite 路径原样保留以兼容旧数据源。

/** 首次访问 vault 时把 sqlite 存量整表播种到 json（幂等：json 文件已存在即跳过；表/库不可用则从空开始） */
export function ensureWeightVaultSeeded(): void {
  if (vaultWeightExists()) return
  let rows: WeightRow[] = []
  try {
    rows = queryAll<WeightRow>('SELECT * FROM toolbox_weight_records').map(toVaultRow)
  } catch {
    rows = []
  }
  vaultWeightSave(rows)
}

/** 表行 → json 行：字段原样搬，仅补齐非空列的默认值（与建表 DEFAULT 一致） */
function toVaultRow(r: WeightRow): WeightRow {
  return {
    id: r.id,
    weight: r.weight,
    date: r.date,
    series: r.series || 'default',
    note: r.note ?? '',
    created_at: r.created_at,
  }
}

/** 部分更新：与 sqlite 路径（buildUpdateSet 白名单）同语义——仅这四个列，undefined 忽略 */
function applyWeightWhitelist(target: WeightRow, data: WeightUpdateData): WeightRow {
  const next: WeightRow = { ...target }
  for (const col of ['weight', 'date', 'series', 'note'] as const) {
    const v = data[col]
    if (v !== undefined) (next as unknown as Record<string, unknown>)[col] = v
  }
  return next
}

export function registerWeightHandlers(): void {

  ipcMain.handle('weight:getAll', () => {
    if (isVaultDataSource()) {
      ensureWeightVaultSeeded()
      return vaultWeightAll().map(rowToWeight)
    }
    const rows = queryAll<WeightRow>(
      'SELECT * FROM toolbox_weight_records ORDER BY date ASC'
    )
    return rows.map(rowToWeight)
  })

  ipcMain.handle('weight:getSeries', () => {
    if (isVaultDataSource()) {
      ensureWeightVaultSeeded()
      const seen = new Set<string>()
      for (const r of vaultWeightAll()) seen.add(r.series || 'default')
      return Array.from(seen).sort()
    }
    const rows = queryAll<{ series: string }>(
      'SELECT DISTINCT series FROM toolbox_weight_records ORDER BY series'
    )
    return rows.map(r => r.series)
  })

  ipcMain.handle('weight:create', (_e, data: {
    weight: number; date: string; series?: string; note?: string
  }) => {
    if (isVaultDataSource()) {
      ensureWeightVaultSeeded()
      const row: WeightRow = {
        id: randomUUID(),
        weight: data.weight,
        date: data.date,
        series: data.series || 'default',
        note: data.note || '',
        created_at: new Date().toISOString(),
      }
      vaultWeightSave([...vaultWeightAll(), row])
      return rowToWeight(row)
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    run(
      `INSERT INTO toolbox_weight_records (id, weight, date, series, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.weight, data.date, data.series || 'default', data.note || '', now]
    )
    const rows = queryAll<WeightRow>('SELECT * FROM toolbox_weight_records WHERE id = ?', [id])
    return rowToWeight(rows[0])
  })

  ipcMain.handle('weight:update', (_e, id: string, data: WeightUpdateData) => {
    if (isVaultDataSource()) {
      ensureWeightVaultSeeded()
      const rows = vaultWeightAll()
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return null
      const next = applyWeightWhitelist(rows[i], data)
      rows[i] = next
      vaultWeightSave(rows)
      return rowToWeight(next)
    }
    // 列名白名单:渲染层传入的 key 不直接拼 SQL(防注入)
    const { sets, params } = buildUpdateSet(data, ['weight', 'date', 'series', 'note'])
    if (sets.length === 0) {
      const rows = queryAll<WeightRow>('SELECT * FROM toolbox_weight_records WHERE id = ?', [id])
      return rows.length > 0 ? rowToWeight(rows[0]) : null
    }
    params.push(id)
    run(`UPDATE toolbox_weight_records SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<WeightRow>('SELECT * FROM toolbox_weight_records WHERE id = ?', [id])
    return rowToWeight(rows[0])
  })

  ipcMain.handle('weight:delete', (_e, id: string) => {
    if (isVaultDataSource()) {
      ensureWeightVaultSeeded()
      vaultWeightSave(vaultWeightAll().filter((r) => r.id !== id))
      return
    }
    run('DELETE FROM toolbox_weight_records WHERE id = ?', [id])
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
