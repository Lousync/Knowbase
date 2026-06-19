import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

// ---- types ----
interface ScriptRow {
  id: string; name: string; description: string | null; content: string
  language: string; sort_order: number; created_at: string; updated_at: string
}

function rowToScript(row: ScriptRow) {
  return {
    id: row.id, name: row.name, description: row.description || '',
    content: row.content, language: row.language,
    sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at
  }
}

// ---- helpers ----
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

// ---- IPC handlers ----
export function registerToolboxHandlers(): void {

  ipcMain.handle('toolbox:getScripts', () => {
    const rows = queryAll<ScriptRow>(
      'SELECT * FROM toolbox_scripts ORDER BY sort_order, created_at'
    )
    return rows.map(rowToScript)
  })

  ipcMain.handle('toolbox:getScriptById', (_e, id: string) => {
    const rows = queryAll<ScriptRow>('SELECT * FROM toolbox_scripts WHERE id = ?', [id])
    return rows.length > 0 ? rowToScript(rows[0]) : null
  })

  ipcMain.handle('toolbox:createScript', (_e, data: {
    name?: string; description?: string; content?: string; language?: string
  }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    // Get next sort_order
    const maxRow = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM toolbox_scripts'
    )
    const sortOrder = (maxRow[0]?.m ?? -1) + 1
    run(
      `INSERT INTO toolbox_scripts (id, name, description, content, language, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name || '未命名脚本', data.description || '', data.content || '', data.language || 'plaintext', sortOrder, now, now]
    )
    const rows = queryAll<ScriptRow>('SELECT * FROM toolbox_scripts WHERE id = ?', [id])
    return rowToScript(rows[0])
  })

  ipcMain.handle('toolbox:updateScript', (_e, id: string, data: {
    name?: string; description?: string; content?: string; language?: string; sortOrder?: number
  }) => {
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [new Date().toISOString()]
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        sets.push(`${camelToSnake(k)} = ?`)
        params.push(v)
      }
    }
    params.push(id)
    run(`UPDATE toolbox_scripts SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<ScriptRow>('SELECT * FROM toolbox_scripts WHERE id = ?', [id])
    return rowToScript(rows[0])
  })

  ipcMain.handle('toolbox:deleteScript', (_e, id: string) => {
    run('DELETE FROM toolbox_scripts WHERE id = ?', [id])
  })

  ipcMain.handle('toolbox:reorderScripts', (_e, orderedIds: string[]) => {
    const stmt = getDatabase().prepare('UPDATE toolbox_scripts SET sort_order = ? WHERE id = ?')
    orderedIds.forEach((id, idx) => {
      stmt.run([idx, id])
    })
    stmt.free()
    saveToDisk()
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
