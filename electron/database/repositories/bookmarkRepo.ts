import { ipcMain, dialog, shell } from 'electron'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getDatabase, saveToDisk } from '../connection'

interface CategoryRow {
  id: string; name: string; color: string
  sort_order: number; created_at: string
}

interface BookmarkRow {
  id: string; category_id: string; title: string; url: string
  description: string; sort_order: number; created_at: string
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

function rowToCategory(row: CategoryRow) {
  return { id: row.id, name: row.name, color: row.color, sortOrder: row.sort_order ?? 0, createdAt: row.created_at }
}

function rowToBookmark(row: BookmarkRow) {
  return {
    id: row.id,
    categoryId: row.category_id || '',
    title: row.title,
    url: row.url,
    description: row.description || '',
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  }
}

export function registerBookmarkHandlers(): void {

  // ---- 数据 ----
  ipcMain.handle('bookmark:getAll', () => {
    const categories = queryAll<CategoryRow>('SELECT * FROM bookmark_categories ORDER BY sort_order ASC, created_at ASC').map(rowToCategory)
    const bookmarks = queryAll<BookmarkRow>('SELECT * FROM bookmarks ORDER BY sort_order ASC, created_at ASC').map(rowToBookmark)
    return { categories, bookmarks }
  })

  ipcMain.handle('bookmark:createCategory', (_e, data: { name: string; color?: string }) => {
    const id = randomUUID()
    run(
      'INSERT INTO bookmark_categories (id, name, color, sort_order) VALUES (?, ?, ?, ?)',
      [id, data.name, data.color || '#3B82F6', Date.now()]
    )
    return rowToCategory(queryAll<CategoryRow>('SELECT * FROM bookmark_categories WHERE id = ?', [id])[0])
  })

  ipcMain.handle('bookmark:updateCategory', (_e, id: string, data: { name?: string; color?: string }) => {
    const sets: string[] = []
    const params: unknown[] = []
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name) }
    if (data.color !== undefined) { sets.push('color = ?'); params.push(data.color) }
    if (sets.length === 0) return null
    params.push(id)
    run(`UPDATE bookmark_categories SET ${sets.join(', ')} WHERE id = ?`, params)
    return rowToCategory(queryAll<CategoryRow>('SELECT * FROM bookmark_categories WHERE id = ?', [id])[0])
  })

  ipcMain.handle('bookmark:deleteCategory', (_e, id: string) => {
    // 分类下的书签移入未分类，不删书签
    run("UPDATE bookmarks SET category_id = '' WHERE category_id = ?", [id])
    run('DELETE FROM bookmark_categories WHERE id = ?', [id])
  })

  ipcMain.handle('bookmark:reorderCategories', (_e, orderedIds: string[]) => {
    const base = Date.now()
    orderedIds.forEach((id, i) => {
      run('UPDATE bookmark_categories SET sort_order = ? WHERE id = ?', [i + base - orderedIds.length, id])
    })
  })

  ipcMain.handle('bookmark:createBookmark', (_e, data: {
    title: string; url: string; description?: string; categoryId?: string
  }) => {
    const id = randomUUID()
    run(
      "INSERT INTO bookmarks (id, category_id, title, url, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.categoryId || '', data.title, data.url, data.description || '', Date.now()]
    )
    return rowToBookmark(queryAll<BookmarkRow>('SELECT * FROM bookmarks WHERE id = ?', [id])[0])
  })

  ipcMain.handle('bookmark:updateBookmark', (_e, id: string, data: {
    title?: string; url?: string; description?: string; categoryId?: string | null
  }) => {
    const sets: string[] = []
    const params: unknown[] = []
    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title) }
    if (data.url !== undefined) { sets.push('url = ?'); params.push(data.url) }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description) }
    if (data.categoryId !== undefined) { sets.push('category_id = ?'); params.push(data.categoryId || '') }
    if (sets.length === 0) return null
    params.push(id)
    run(`UPDATE bookmarks SET ${sets.join(', ')} WHERE id = ?`, params)
    return rowToBookmark(queryAll<BookmarkRow>('SELECT * FROM bookmarks WHERE id = ?', [id])[0])
  })

  ipcMain.handle('bookmark:deleteBookmark', (_e, id: string) => {
    run('DELETE FROM bookmarks WHERE id = ?', [id])
  })

  // ---- 外链 / 文件 ----
  // 协议白名单:书签 URL 可经 JSON 导入植入,仅放行网页协议,防 file:// / 自定义协议拉起外部程序
  ipcMain.handle('bookmark:openUrl', async (_e, url: string) => {
    if (typeof url !== 'string' || !url) return
    let u: URL
    try { u = new URL(url) } catch { return }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
    await shell.openExternal(url)
  })

  ipcMain.handle('bookmark:pickImportFile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '书签 JSON', extensions: ['json'] }],
      title: '选择要导入的书签文件',
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
}
