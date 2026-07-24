import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

interface WeightRow {
  id: string; weight: number; date: string; series: string
  note: string | null; created_at: string
}

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

export function registerWeightHandlers(): void {

  ipcMain.handle('weight:getAll', () => {
    const rows = queryAll<WeightRow>(
      'SELECT * FROM toolbox_weight_records ORDER BY date ASC'
    )
    return rows.map(rowToWeight)
  })

  ipcMain.handle('weight:getSeries', () => {
    const rows = queryAll<{ series: string }>(
      'SELECT DISTINCT series FROM toolbox_weight_records ORDER BY series'
    )
    return rows.map(r => r.series)
  })

  ipcMain.handle('weight:create', (_e, data: {
    weight: number; date: string; series?: string; note?: string
  }) => {
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

  ipcMain.handle('weight:update', (_e, id: string, data: {
    weight?: number; date?: string; series?: string; note?: string
  }) => {
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        sets.push(`${camelToSnake(k)} = ?`)
        params.push(v)
      }
    }
    params.push(id)
    run(`UPDATE toolbox_weight_records SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<WeightRow>('SELECT * FROM toolbox_weight_records WHERE id = ?', [id])
    return rowToWeight(rows[0])
  })

  ipcMain.handle('weight:delete', (_e, id: string) => {
    run('DELETE FROM toolbox_weight_records WHERE id = ?', [id])
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
