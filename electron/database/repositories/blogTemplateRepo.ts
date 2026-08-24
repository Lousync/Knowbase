import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

/**
 * 博客模板 —— 用户自编辑的日记模板，写博客时可一键套用。
 */

interface TemplateRow {
  id: string; name: string; content_md: string
  sort_order: number; created_at: string; updated_at: string
}

function rowToDto(r: TemplateRow) {
  return {
    id: r.id,
    name: r.name,
    contentMd: r.content_md,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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

export function registerBlogTemplateHandlers(): void {

  ipcMain.handle('blogTpl:list', () => queryAll<TemplateRow>('SELECT * FROM blog_templates ORDER BY sort_order, updated_at DESC').map(rowToDto))

  ipcMain.handle('blogTpl:create', (_e, data: { name: string; contentMd?: string }) => {
    const name = (data.name || '').trim()
    if (!name) return null
    const id = randomUUID()
    getDatabase().run(
      'INSERT INTO blog_templates (id, name, content_md) VALUES (?, ?, ?)',
      [id, name, data.contentMd || '']
    )
    saveToDisk()
    return rowToDto(queryAll<TemplateRow>('SELECT * FROM blog_templates WHERE id = ?', [id])[0])
  })

  ipcMain.handle('blogTpl:update', (_e, id: string, data: { name?: string; contentMd?: string }) => {
    const sets: string[] = ["updated_at = datetime('now', 'localtime')"]
    const params: unknown[] = []
    if (data.name !== undefined && data.name.trim()) { sets.push('name = ?'); params.push(data.name.trim()) }
    if (data.contentMd !== undefined) { sets.push('content_md = ?'); params.push(data.contentMd) }
    params.push(id)
    getDatabase().run(`UPDATE blog_templates SET ${sets.join(', ')} WHERE id = ?`, params)
    saveToDisk()
    const rows = queryAll<TemplateRow>('SELECT * FROM blog_templates WHERE id = ?', [id])
    return rows.length > 0 ? rowToDto(rows[0]) : null
  })

  ipcMain.handle('blogTpl:delete', (_e, id: string) => {
    getDatabase().run('DELETE FROM blog_templates WHERE id = ?', [id])
    saveToDisk()
  })
}
