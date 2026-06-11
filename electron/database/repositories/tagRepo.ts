import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

interface TagRow {
  id: string
  name: string
  color: string
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

export function registerTagHandlers(): void {
  // 获取所有标签
  ipcMain.handle('db:getTags', () => {
    return queryAll<TagRow>('SELECT * FROM tags ORDER BY name')
  })

  // 创建标签
  ipcMain.handle('db:createTag', (_event, name: string, color?: string) => {
    const db = getDatabase()
    const existing = queryAll<TagRow>('SELECT * FROM tags WHERE name = ?', [name])
    if (existing.length > 0) return existing[0]

    const id = randomUUID()
    db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, name.trim(), color || '#6b7280'])
    saveToDisk()

    return { id, name: name.trim(), color: color || '#6b7280' }
  })

  // 删除标签
  ipcMain.handle('db:deleteTag', (_event, id: string) => {
    const db = getDatabase()
    db.run('DELETE FROM tags WHERE id = ?', [id])
    saveToDisk()
  })
}
