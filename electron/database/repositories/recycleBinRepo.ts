import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

interface RecycleBinRow {
  id: string
  original_id: string
  module: string
  title: string
  data: string
  deleted_at: string
}

interface TagRow {
  id: string
  name: string
  color: string
}

// ---- helpers (mirror entryRepo / knowledgeRepo patterns) ----
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

export function registerRecycleBinHandlers(): void {
  // ---- 获取回收站列表（自动清除过期项） ----
  ipcMain.handle('recycleBin:getItems', () => {
    // 先清除 30 天前的数据
    run("DELETE FROM recycle_bin WHERE deleted_at < datetime('now', '-30 days')")

    const rows = queryAll<RecycleBinRow>(
      'SELECT * FROM recycle_bin ORDER BY deleted_at DESC'
    )

    return rows.map(r => ({
      id: r.id,
      originalId: r.original_id,
      module: r.module,
      title: r.title,
      data: JSON.parse(r.data),
      deletedAt: r.deleted_at
    }))
  })

  // ---- 恢复回收站项目 ----
  ipcMain.handle('recycleBin:restoreItem', (_e, id: string) => {
    const rows = queryAll<RecycleBinRow>(
      'SELECT * FROM recycle_bin WHERE id = ?', [id]
    )
    if (rows.length === 0) return

    const item = rows[0]
    const record = JSON.parse(item.data)

    if (item.module === 'blog') {
      // 恢复博文
      run(
        `INSERT INTO entries (id, title, content_md, content_html, date, created_at, updated_at, is_pinned, word_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id, record.title, record.contentMd, record.contentHtml || '',
          record.date, record.createdAt, record.updatedAt,
          record.isPinned ? 1 : 0, record.wordCount || 0
        ]
      )
      // 恢复标签关联
      if (record.tags && Array.isArray(record.tags)) {
        for (const tag of record.tags as TagRow[]) {
          try {
            run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [record.id, tag.id])
          } catch { /* 标签可能已被删除 */ }
        }
      }
    } else if (item.module === 'knowledge') {
      // 恢复知识页面
      run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id, record.title, record.contentMd, record.contentHtml || '',
          record.categoryId || null, record.isStarred ? 1 : 0,
          record.sortOrder || 0, record.createdAt, record.updatedAt
        ]
      )
      // 恢复标签关联
      if (record.tags && Array.isArray(record.tags)) {
        for (const tag of record.tags as TagRow[]) {
          try {
            run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [record.id, tag.id])
          } catch { /* 标签可能已被删除 */ }
        }
      }
      // 注意: knowledge_links 不恢复 — 保存页面时会自动重建
    }

    // 从回收站移除
    run('DELETE FROM recycle_bin WHERE id = ?', [id])
  })

  // ---- 永久删除单条 ----
  ipcMain.handle('recycleBin:permanentlyDelete', (_e, id: string) => {
    run('DELETE FROM recycle_bin WHERE id = ?', [id])
  })

  // ---- 清空回收站 ----
  ipcMain.handle('recycleBin:emptyAll', () => {
    run('DELETE FROM recycle_bin')
  })

  // ---- 清除过期项（独立调用） ----
  ipcMain.handle('recycleBin:purgeExpired', () => {
    run("DELETE FROM recycle_bin WHERE deleted_at < datetime('now', '-30 days')")
  })
}
