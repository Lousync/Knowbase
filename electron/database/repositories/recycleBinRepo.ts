import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getDatabase, saveToDisk } from '../connection'
import { trashItem, trashAll } from '../../lib/trashFiles'

function getSettingsRetentionDays(): number {
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return 30
    const s = JSON.parse(readFileSync(path, 'utf-8'))
    return typeof s.recycleBinRetentionDays === 'number' ? s.recycleBinRetentionDays : 30
  } catch { return 30 }
}

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
    // 清除过期数据
    const retentionDays = getSettingsRetentionDays()
    run(`DELETE FROM recycle_bin WHERE deleted_at < datetime('now', '-${retentionDays} days')`)

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
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id, record.title, record.contentMd, record.contentHtml || '',
          record.categoryId || null, record.isStarred ? 1 : 0,
          record.sortOrder || 0, record.fileType || '', record.createdAt, record.updatedAt
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
    } else if (item.module === 'knowledge_category') {
      const cat = record.category
      // Verify parent still exists; if not, re-parent to root
      const parentOk = cat.parentId
        ? queryAll<{ id: string }>('SELECT id FROM knowledge_categories WHERE id = ?', [cat.parentId]).length > 0
        : true

      run(
        `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
         VALUES (?, ?, ?, ?, ?)`,
        [cat.id, cat.name, parentOk ? cat.parentId : null, cat.sortOrder || 0, cat.categoryType || 'folder']
      )

      // Recursively restore children
      const restoreChildren = (children: any[], parentId: string) => {
        for (const ch of (children || [])) {
          const c = ch.category
          run(
            `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
             VALUES (?, ?, ?, ?, ?)`,
            [c.id, c.name, parentId, c.sortOrder || 0, c.categoryType || 'folder']
          )
          // Restore pages under this child
          for (const p of (ch.pages || [])) {
            run(
              `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [p.id, p.title, p.contentMd, p.contentHtml || '', c.id, p.isStarred ? 1 : 0, p.sortOrder || 0, p.fileType || '', p.createdAt, p.updatedAt]
            )
            for (const tag of (p.tags || [])) {
              try {
                run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [p.id, tag.id])
              } catch { /* tag may have been deleted */ }
            }
          }
          restoreChildren(ch.children, c.id)
        }
      }
      restoreChildren(record.children || [], cat.id)

      // Restore direct pages
      for (const p of (record.pages || [])) {
        run(
          `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, p.title, p.contentMd, p.contentHtml || '', cat.id, p.isStarred ? 1 : 0, p.sortOrder || 0, p.fileType || '', p.createdAt, p.updatedAt]
        )
        for (const tag of (p.tags || [])) {
          try {
            run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [p.id, tag.id])
          } catch { /* tag may have been deleted */ }
        }
      }
    }

    // 从回收站移除
    run('DELETE FROM recycle_bin WHERE id = ?', [id])
  })

  // ---- 部分恢复（从知识目录快照中恢复单个页面/子目录） ----
  ipcMain.handle('recycleBin:restorePartial', (_e, binId: string, path: string) => {
    const rows = queryAll<RecycleBinRow>(
      'SELECT * FROM recycle_bin WHERE id = ?', [binId]
    )
    if (rows.length === 0) return
    const item = rows[0]
    if (item.module !== 'knowledge_category') return
    const record = JSON.parse(item.data)

    // Parse path like "pages.2" or "children.0.pages.1" or "children.1"
    const segments = path.split('.')
    let container: any = record
    let parentContainer: any = null
    let key: string = ''
    let index: number = -1
    for (let i = 0; i < segments.length; i++) {
      parentContainer = container
      key = segments[i]
      index = -1
      if (/^\d+$/.test(segments[i + 1] || '')) {
        key = segments[i]
        index = parseInt(segments[++i], 10)
        container = container[key]?.[index]
      } else if (i === segments.length - 1) {
        // last segment
      } else {
        container = container[segments[i]]
      }
    }

    // container now is the parent of the target
    if (path === 'category') {
      // Restore only the top-level category itself (no children/pages)
      const c = record.category
      run(
        `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
         VALUES (?, ?, ?, ?, ?)`,
        [c.id, c.name, null, c.sortOrder || 0, c.categoryType || 'folder']
      )
      // Remove category from snapshot; if nothing left, delete bin entry
      delete record.category
      const hasContent = (record.pages?.length > 0) || (record.children?.length > 0) || record.category
      if (!hasContent) {
        run('DELETE FROM recycle_bin WHERE id = ?', [binId])
      } else {
        run('UPDATE recycle_bin SET data = ? WHERE id = ?', [JSON.stringify(record), binId])
      }
      return
    }

    if (segments[0] === 'pages') {
      // Restore a direct page from record.pages[i]
      const pageIdx = parseInt(segments[1], 10)
      const page = record.pages[pageIdx]
      if (page) {
        run(
          `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [page.id, page.title, page.contentMd, page.contentHtml || '', null, page.isStarred ? 1 : 0, page.sortOrder || 0, page.fileType || '', page.createdAt, page.updatedAt]
        )
        for (const tag of (page.tags || [])) {
          try { run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [page.id, tag.id]) } catch { /* */ }
        }
        record.pages.splice(pageIdx, 1)
      }
    } else if (segments[0] === 'children') {
      const childIdx = parseInt(segments[1], 10)
      const child = record.children[childIdx]
      if (!child) return

      if (segments.length === 2) {
        // Restore entire child category as root
        const c = child.category
        run(
          `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
           VALUES (?, ?, ?, ?, ?)`,
          [c.id, c.name, null, c.sortOrder || 0, c.categoryType || 'folder']
        )
        const restorePages = (pages: any[], catId: string) => {
          for (const p of pages) {
            run(
              `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [p.id, p.title, p.contentMd, p.contentHtml || '', catId, p.isStarred ? 1 : 0, p.sortOrder || 0, p.fileType || '', p.createdAt, p.updatedAt]
            )
            for (const tag of (p.tags || [])) {
              try { run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [p.id, tag.id]) } catch { /* */ }
            }
          }
        }
        const restoreChildren = (children: any[], parentId: string) => {
          for (const ch of children) {
            const cc = ch.category
            run(
              `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
               VALUES (?, ?, ?, ?, ?)`,
              [cc.id, cc.name, parentId, cc.sortOrder || 0, cc.categoryType || 'folder']
            )
            restorePages(ch.pages || [], cc.id)
            restoreChildren(ch.children || [], cc.id)
          }
        }
        restorePages(child.pages || [], c.id)
        restoreChildren(child.children || [], c.id)
        record.children.splice(childIdx, 1)
      } else if (segments[2] === 'pages') {
        // Restore a page within a child: children.X.pages.Y
        const pageIdx = parseInt(segments[3], 10)
        const page = child.pages[pageIdx]
        if (page) {
          run(
            `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [page.id, page.title, page.contentMd, page.contentHtml || '', null, page.isStarred ? 1 : 0, page.sortOrder || 0, page.fileType || '', page.createdAt, page.updatedAt]
          )
          for (const tag of (page.tags || [])) {
            try { run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [page.id, tag.id]) } catch { /* */ }
          }
          child.pages.splice(pageIdx, 1)
        }
      }
    }

    // Check if snapshot is now empty (no pages, no children)
    const hasContent = (record.pages?.length > 0) || (record.children?.length > 0)
    if (!hasContent) {
      run('DELETE FROM recycle_bin WHERE id = ?', [binId])
    } else {
      run('UPDATE recycle_bin SET data = ? WHERE id = ?', [JSON.stringify(record), binId])
    }
  })

  // ---- 从快照中永久删除单条（不恢复，直接丢弃） ----
  function spliceFromSnapshot(record: any, path: string): boolean {
    const segs = path.split('.')
    let container: any = record
    for (let i = 0; i < segs.length - 2; i++) {
      if (/^\d+$/.test(segs[i + 1])) {
        container = container[segs[i]][parseInt(segs[++i], 10)]
      } else {
        container = container[segs[i]]
      }
    }
    const arrKey = segs[segs.length - 2]
    const idx = parseInt(segs[segs.length - 1], 10)
    return container[arrKey] ? (container[arrKey].splice(idx, 1), true) : false
  }

  ipcMain.handle('recycleBin:permanentlyDeletePartial', (_e, binId: string, path: string) => {
    const rows = queryAll<RecycleBinRow>('SELECT * FROM recycle_bin WHERE id = ?', [binId])
    if (rows.length === 0) return
    const item = rows[0]
    if (item.module !== 'knowledge_category') return
    const record = JSON.parse(item.data)

    if (path === 'category') {
      delete record.category
    } else {
      spliceFromSnapshot(record, path)
    }

    const hasContent = (record.pages?.length > 0) || (record.children?.length > 0) || !!record.category
    if (!hasContent) {
      run('DELETE FROM recycle_bin WHERE id = ?', [binId])
    } else {
      run('UPDATE recycle_bin SET data = ? WHERE id = ?', [JSON.stringify(record), binId])
    }
  })

  // ---- 移入系统回收站（单条） ----
  ipcMain.handle('recycleBin:trashToOS', async (_e, id: string) => {
    const rows = queryAll<RecycleBinRow>('SELECT * FROM recycle_bin WHERE id = ?', [id])
    if (rows.length === 0) return
    const item = rows[0]
    const record = { module: item.module, title: item.title, data: JSON.parse(item.data) }
    await trashItem(id, record)
    run('DELETE FROM recycle_bin WHERE id = ?', [id])
  })

  // ---- 移入系统回收站（全部） ----
  ipcMain.handle('recycleBin:trashAllToOS', async () => {
    const rows = queryAll<RecycleBinRow>('SELECT * FROM recycle_bin ORDER BY deleted_at DESC')
    if (rows.length === 0) return
    const items = rows.map(r => ({ binId: r.id, module: r.module, title: r.title, data: JSON.parse(r.data) }))
    await trashAll(items)
    run('DELETE FROM recycle_bin')
  })

  // ---- 从快照中局部移入系统回收站 ----
  ipcMain.handle('recycleBin:trashPartialToOS', async (_e, binId: string, path: string) => {
    const rows = queryAll<RecycleBinRow>('SELECT * FROM recycle_bin WHERE id = ?', [binId])
    if (rows.length === 0) return
    const item = rows[0]
    if (item.module !== 'knowledge_category') return
    const record = JSON.parse(item.data)

    // Extract the target data
    let node: any = record
    const segs = path.split('.')
    for (let i = 0; i < segs.length; i++) {
      if (/^\d+$/.test(segs[i + 1])) {
        node = node[segs[i]][parseInt(segs[++i], 10)]
      } else {
        node = node[segs[i]]
      }
    }

    // Write the partial item to temp + trash
    if (path === 'category') {
      await trashItem(binId, { module: 'knowledge', title: node.name, data: { title: node.name, contentMd: '' } })
    } else if (path.includes('pages.')) {
      await trashItem(binId, { module: 'knowledge', title: node.title, data: node })
    } else {
      // child category
      await trashItem(binId, { module: 'knowledge_category', title: node?.category?.name || '子目录', data: node })
    }

    // Remove from snapshot
    spliceFromSnapshot(record, path)

    const hasContent = (record.pages?.length > 0) || (record.children?.length > 0) || !!record.category
    if (!hasContent) {
      run('DELETE FROM recycle_bin WHERE id = ?', [binId])
    } else {
      run('UPDATE recycle_bin SET data = ? WHERE id = ?', [JSON.stringify(record), binId])
    }
  })

  // ---- 永久删除单条（直接删库，不移入系统回收站） ----
  ipcMain.handle('recycleBin:permanentlyDelete', (_e, id: string) => {
    run('DELETE FROM recycle_bin WHERE id = ?', [id])
  })

  // ---- 清空回收站（移入系统回收站） ----
  ipcMain.handle('recycleBin:emptyAll', async () => {
    const rows = queryAll<RecycleBinRow>('SELECT * FROM recycle_bin ORDER BY deleted_at DESC')
    if (rows.length > 0) {
      const items = rows.map(r => ({ binId: r.id, module: r.module, title: r.title, data: JSON.parse(r.data) }))
      await trashAll(items)
    }
    run('DELETE FROM recycle_bin')
  })

  // ---- 清除过期项（独立调用） ----
  ipcMain.handle('recycleBin:purgeExpired', () => {
    const retentionDays = getSettingsRetentionDays()
    run(`DELETE FROM recycle_bin WHERE deleted_at < datetime('now', '-${retentionDays} days')`)
  })
}
