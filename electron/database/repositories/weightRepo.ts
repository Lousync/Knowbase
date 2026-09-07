import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { vaultWeightAll, vaultWeightSave } from '../../lib/kbStore/weightVaultRepo'

interface WeightRow {
  id: string; weight: number; date: string; series: string
  note: string | null; created_at: string
}

/** weight:update 可更新字段白名单（undefined 忽略） */
type WeightUpdateData = { weight?: number; date?: string; series?: string; note?: string }

function rowToWeight(row: WeightRow) {
  return {
    id: row.id, weight: row.weight, date: row.date,
    series: row.series, note: row.note || '',
    createdAt: row.created_at
  }
}

/** 部分更新：仅这四个字段，undefined 忽略 */
function applyWeightWhitelist(target: WeightRow, data: WeightUpdateData): WeightRow {
  const next: WeightRow = { ...target }
  for (const col of ['weight', 'date', 'series', 'note'] as const) {
    const v = data[col]
    if (v !== undefined) (next as unknown as Record<string, unknown>)[col] = v
  }
  return next
}

/** R6 去库化：真相源 = .knowbase/modules/weight/records.json（sql.js 路径已移除，D9） */
export function registerWeightHandlers(): void {

  ipcMain.handle('weight:getAll', () => vaultWeightAll().map(rowToWeight))

  ipcMain.handle('weight:getSeries', () => {
    const seen = new Set<string>()
    for (const r of vaultWeightAll()) seen.add(r.series || 'default')
    return Array.from(seen).sort()
  })

  ipcMain.handle('weight:create', (_e, data: {
    weight: number; date: string; series?: string; note?: string
  }) => {
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
  })

  ipcMain.handle('weight:update', (_e, id: string, data: WeightUpdateData) => {
    const rows = vaultWeightAll()
    const i = rows.findIndex((r) => r.id === id)
    if (i < 0) return null
    const next = applyWeightWhitelist(rows[i], data)
    rows[i] = next
    vaultWeightSave(rows)
    return rowToWeight(next)
  })

  ipcMain.handle('weight:delete', (_e, id: string) => {
    vaultWeightSave(vaultWeightAll().filter((r) => r.id !== id))
  })
}
