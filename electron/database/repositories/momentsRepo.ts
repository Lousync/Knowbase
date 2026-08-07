import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

interface MomentsRow {
  id: string
  content_md: string
  content_html: string | null
  image_data_url: string | null
  is_pinned: number
  created_at: string
  updated_at: string
}

function rowToMoments(row: MomentsRow) {
  return {
    id: row.id,
    contentMd: row.content_md,
    contentHtml: row.content_html || '',
    imageDataUrl: row.image_data_url || '',
    isPinned: row.is_pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}

export function registerMomentsHandlers(): void {
  ipcMain.handle('moments:getAll', () => {
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts ORDER BY is_pinned DESC, created_at DESC')
    return rows.map(rowToMoments)
  })

  ipcMain.handle('moments:getById', (_e, id: string) => {
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    return rows.length > 0 ? rowToMoments(rows[0]) : null
  })

  ipcMain.handle('moments:create', (_e, data: { contentMd?: string; contentHtml?: string; imageDataUrl?: string; isPinned?: boolean }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    run(
      `INSERT INTO moments_posts (id, content_md, content_html, image_data_url, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.contentMd || '', data.contentHtml || '', data.imageDataUrl || '', data.isPinned ? 1 : 0, now, now]
    )
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    return rowToMoments(rows[0])
  })

  ipcMain.handle('moments:update', (_e, id: string, data: { contentMd?: string; contentHtml?: string; imageDataUrl?: string; isPinned?: boolean }) => {
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [new Date().toISOString()]
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        sets.push(`${camelToSnake(k)} = ?`)
        params.push(k === 'isPinned' ? (v ? 1 : 0) : v)
      }
    }
    params.push(id)
    run(`UPDATE moments_posts SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    return rowToMoments(rows[0])
  })

  ipcMain.handle('moments:togglePin', (_e, id: string) => {
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    if (rows.length === 0) return null
    const next = rows[0].is_pinned === 1 ? 0 : 1
    run('UPDATE moments_posts SET is_pinned = ?, updated_at = ? WHERE id = ?', [next, new Date().toISOString(), id])
    const updated = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    return rowToMoments(updated[0])
  })

  ipcMain.handle('moments:delete', (_e, id: string) => {
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    if (rows.length === 0) return
    const row = rowToMoments(rows[0])
    const binId = randomUUID()
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [binId, id, 'moments', '单机说说', JSON.stringify(row), new Date().toISOString()]
    )
    run('DELETE FROM moments_posts WHERE id = ?', [id])
  })
}