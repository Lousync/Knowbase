import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

// ---- types ----
interface PasswordRow {
  id: string; title: string; url: string | null; username: string | null
  password: string; notes: string | null
  sort_order: number; created_at: string; updated_at: string
}

function rowToPassword(row: PasswordRow) {
  return {
    id: row.id, title: row.title, url: row.url || '',
    username: row.username || '', password: row.password,
    notes: row.notes || '',
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
export function registerPasswordHandlers(): void {

  ipcMain.handle('passwordVault:getAll', () => {
    const rows = queryAll<PasswordRow>(
      'SELECT * FROM toolbox_passwords ORDER BY sort_order, updated_at DESC'
    )
    return rows.map(rowToPassword)
  })

  ipcMain.handle('passwordVault:getById', (_e, id: string) => {
    const rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords WHERE id = ?', [id])
    return rows.length > 0 ? rowToPassword(rows[0]) : null
  })

  ipcMain.handle('passwordVault:create', (_e, data: {
    title?: string; url?: string; username?: string; password?: string; notes?: string
  }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const maxRow = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM toolbox_passwords'
    )
    const sortOrder = (maxRow[0]?.m ?? -1) + 1
    run(
      `INSERT INTO toolbox_passwords (id, title, url, username, password, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.title || '', data.url || '', data.username || '', data.password || '', data.notes || '', sortOrder, now, now]
    )
    const rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords WHERE id = ?', [id])
    return rowToPassword(rows[0])
  })

  ipcMain.handle('passwordVault:update', (_e, id: string, data: {
    title?: string; url?: string; username?: string; password?: string; notes?: string; sortOrder?: number
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
    run(`UPDATE toolbox_passwords SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords WHERE id = ?', [id])
    return rowToPassword(rows[0])
  })

  ipcMain.handle('passwordVault:delete', (_e, id: string) => {
    run('DELETE FROM toolbox_passwords WHERE id = ?', [id])
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
