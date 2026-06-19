import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

interface EntryRow {
  id: string
  title: string
  content_md: string
  content_html: string | null
  date: string
  created_at: string
  updated_at: string
  is_pinned: number
  is_starred: number
  word_count: number
  states: string
}

function rowToEntry(row: EntryRow) {
  return {
    id: row.id,
    title: row.title,
    contentMd: row.content_md,
    contentHtml: row.content_html || '',
    date: row.date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isPinned: row.is_pinned === 1,
    isStarred: row.is_starred === 1,
    wordCount: row.word_count,
    states: row.states || '',
  }
}

/** 执行查询并返回类型化行数组 */
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

/** 执行修改语句 */
function run(sql: string, params: unknown[] = []): void {
  const db = getDatabase()
  db.run(sql, params)
  saveToDisk()
}

export function registerEntryHandlers(): void {
  // 获取博文列表
  ipcMain.handle('db:getEntries', (_event, filter?: {
    date?: string
    tagId?: string
    pinnedOnly?: boolean
    starredOnly?: boolean
    limit?: number
    offset?: number
  }) => {
    let sql = `SELECT DISTINCT e.* FROM entries e`
    const params: unknown[] = []
    const conditions: string[] = []

    if (filter?.tagId) {
      sql += ` JOIN entry_tags et ON e.id = et.entry_id`
      conditions.push('et.tag_id = ?')
      params.push(filter.tagId)
    }

    if (filter?.date) {
      conditions.push('e.date = ?')
      params.push(filter.date)
    }

    if (filter?.pinnedOnly) {
      conditions.push('e.is_pinned = 1')
    }

    if (filter?.starredOnly) {
      conditions.push('e.is_starred = 1')
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ')
    }

    sql += ` ORDER BY e.is_pinned DESC, e.is_starred DESC, e.created_at DESC`

    if (filter?.limit) {
      sql += ` LIMIT ?`
      params.push(filter.limit)
      if (filter?.offset) {
        sql += ` OFFSET ?`
        params.push(filter.offset)
      }
    }

    const db = getDatabase()
    const rows = queryAll<EntryRow>(sql, params)
    const entries = rows.map(rowToEntry)

    // Batch-fetch tags for all returned entries
    if (entries.length > 0) {
      const ids = entries.map(e => e.id)
      const placeholders = ids.map(() => '?').join(',')
      const tagRows = queryAll<{ entry_id: string; id: string; name: string; color: string }>(
        `SELECT et.entry_id, t.id, t.name, t.color
         FROM entry_tags et JOIN tags t ON t.id = et.tag_id
         WHERE et.entry_id IN (${placeholders})`,
        ids
      )
      const tagMap = new Map<string, { id: string; name: string; color: string }[]>()
      for (const tr of tagRows) {
        if (!tagMap.has(tr.entry_id)) tagMap.set(tr.entry_id, [])
        tagMap.get(tr.entry_id)!.push({ id: tr.id, name: tr.name, color: tr.color })
      }
      for (const e of entries) {
        (e as Record<string, unknown>).tags = tagMap.get(e.id) || []
      }
    }

    return entries
  })

  // 获取单篇博文
  ipcMain.handle('db:getEntryById', (_event, id: string) => {
    const rows = queryAll<EntryRow>('SELECT * FROM entries WHERE id = ?', [id])
    if (rows.length === 0) return null

    const entry = rows[0]

    // 同时获取标签
    const tags = queryAll<{ id: string; name: string; color: string }>(
      `SELECT t.id, t.name, t.color FROM tags t
       JOIN entry_tags et ON t.id = et.tag_id
       WHERE et.entry_id = ?`,
      [id]
    )

    return { ...rowToEntry(entry), tags }
  })

  // 创建博文
  ipcMain.handle('db:createEntry', (_event, data: {
    title?: string
    contentMd?: string
    contentHtml?: string
    date: string
    tags?: string[]
    states?: string
  }) => {
    // Defensive: if an entry for this date already exists, return it instead of creating a duplicate
    const existing = queryAll<EntryRow>('SELECT * FROM entries WHERE date = ? ORDER BY created_at DESC LIMIT 1', [data.date])
    if (existing.length > 0) {
      const entry = existing[0]
      const tags = queryAll<{ id: string; name: string; color: string }>(
        `SELECT t.id, t.name, t.color FROM tags t
         JOIN entry_tags et ON t.id = et.tag_id
         WHERE et.entry_id = ?`,
        [entry.id]
      )
      return { ...rowToEntry(entry), tags }
    }

    const id = randomUUID()
    const now = new Date().toISOString()

    run(
      `INSERT INTO entries (id, title, content_md, content_html, date, created_at, updated_at, word_count, states)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.title || '', data.contentMd || '', data.contentHtml || '', data.date, now, now, 0, data.states || '']
    )

    if (data.tags && data.tags.length > 0) {
      for (const tagId of data.tags) {
        run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [id, tagId])
      }
    }

    const rows = queryAll<EntryRow>('SELECT * FROM entries WHERE id = ?', [id])
    return rowToEntry(rows[0])
  })

  // 更新博文
  ipcMain.handle('db:updateEntry', (_event, id: string, data: {
    title?: string
    contentMd?: string
    contentHtml?: string
    date?: string
    isPinned?: boolean
    tags?: string[]
    states?: string
  }) => {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [now]

    if (data.title !== undefined) {
      sets.push('title = ?')
      params.push(data.title)
    }
    if (data.contentMd !== undefined) {
      sets.push('content_md = ?')
      params.push(data.contentMd)
    }
    if (data.contentHtml !== undefined) {
      sets.push('content_html = ?')
      params.push(data.contentHtml)
    }
    if (data.date !== undefined) {
      sets.push('date = ?')
      params.push(data.date)
    }
    if (data.isPinned !== undefined) {
      sets.push('is_pinned = ?')
      params.push(data.isPinned ? 1 : 0)
    }
    if (data.states !== undefined) {
      sets.push('states = ?')
      params.push(data.states)
    }
    if ((data as Record<string, unknown>).isStarred !== undefined) {
      sets.push('is_starred = ?')
      params.push((data as Record<string, unknown>).isStarred ? 1 : 0)
    }

    params.push(id)

    run(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`, params)

    if (data.tags !== undefined) {
      run('DELETE FROM entry_tags WHERE entry_id = ?', [id])
      for (const tagId of data.tags) {
        run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [id, tagId])
      }
    }

    const rows = queryAll<EntryRow>('SELECT * FROM entries WHERE id = ?', [id])
    return rowToEntry(rows[0])
  })

  // 删除博文（软删除 → 回收站）
  ipcMain.handle('db:deleteEntry', (_event, id: string) => {
    // 读取完整条目
    const rows = queryAll<EntryRow>('SELECT * FROM entries WHERE id = ?', [id])
    if (rows.length === 0) return

    const entry = rows[0]

    // 读取关联标签
    const tags = queryAll<{ id: string; name: string; color: string }>(
      `SELECT t.id, t.name, t.color FROM tags t
       JOIN entry_tags et ON t.id = et.tag_id
       WHERE et.entry_id = ?`, [id]
    )

    // 序列化完整数据
    const data = JSON.stringify({
      id: entry.id,
      title: entry.title,
      contentMd: entry.content_md,
      contentHtml: entry.content_html || '',
      date: entry.date,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      isPinned: entry.is_pinned === 1,
      wordCount: entry.word_count,
      states: entry.states || '',
      tags
    })

    // 插入回收站
    const binId = randomUUID()
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data)
       VALUES (?, ?, 'blog', ?, ?)`,
      [binId, id, entry.title, data]
    )

    // 从原表删除（CASCADE 自动清理 entry_tags）
    run('DELETE FROM entries WHERE id = ?', [id])
  })

  // 全文搜索（LIKE 方式，sql.js 不支持 FTS5）
  ipcMain.handle('db:searchEntries', (_event, query: string) => {
    const like = `%${query}%`
    const rows = queryAll<EntryRow>(
      `SELECT * FROM entries
       WHERE title LIKE ? OR content_md LIKE ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [like, like]
    )
    return rows.map(rowToEntry)
  })

  // 切换博文收藏状态
  ipcMain.handle('db:toggleEntryStar', (_event, id: string) => {
    const rows = queryAll<EntryRow>('SELECT * FROM entries WHERE id = ?', [id])
    if (rows.length === 0) return null
    const next = rows[0].is_starred === 0 ? 1 : 0
    run('UPDATE entries SET is_starred = ?, updated_at = ? WHERE id = ?', [next, new Date().toISOString(), id])
    const updated = queryAll<EntryRow>('SELECT * FROM entries WHERE id = ?', [id])
    const tags = queryAll<{ id: string; name: string; color: string }>(
      `SELECT t.id, t.name, t.color FROM tags t
       JOIN entry_tags et ON t.id = et.tag_id
       WHERE et.entry_id = ?`, [id]
    )
    return { ...rowToEntry(updated[0]), tags }
  })
}
