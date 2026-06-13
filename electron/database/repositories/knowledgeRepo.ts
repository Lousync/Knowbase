import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

// ---- row types (snake_case matching SQLite columns) ----
interface CategoryRow { id: string; name: string; parent_id: string | null; sort_order: number }
interface PageRow { id: string; title: string; content_md: string; content_html: string | null; category_id: string | null; is_starred: number; sort_order: number; created_at: string; updated_at: string }

function mapPage(r: PageRow) {
  return {
    id: r.id, title: r.title,
    contentMd: r.content_md, contentHtml: r.content_html || '',
    categoryId: r.category_id,
    isStarred: !!r.is_starred,
    sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at
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

// ===== Category handlers =====
export function registerKnowledgeHandlers(): void {
  // 获取所有分类
  ipcMain.handle('knowledge:getCategories', () => {
    const rows = queryAll<CategoryRow>(
      'SELECT * FROM knowledge_categories ORDER BY sort_order, name'
    )
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      sortOrder: r.sort_order
    }))
  })

  // 创建分类
  ipcMain.handle('knowledge:createCategory', (_e, data: { name: string; parentId?: string | null }) => {
    const id = randomUUID()
    const maxOrder = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id IS ?',
      [data.parentId || null]
    )
    run(
      'INSERT INTO knowledge_categories (id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)',
      [id, data.name, data.parentId || null, maxOrder[0]?.m ?? 0]
    )
    const rows = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])
    const r = rows[0]
    return { id: r.id, name: r.name, parentId: r.parent_id, sortOrder: r.sort_order }
  })

  // 更新分类（重命名/移动）
  ipcMain.handle('knowledge:updateCategory', (_e, id: string, data: { name?: string; parentId?: string | null; sortOrder?: number }) => {
    const sets: string[] = []
    const params: unknown[] = []
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name) }
    if (data.parentId !== undefined) { sets.push('parent_id = ?'); params.push(data.parentId) }
    if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(data.sortOrder) }
    if (sets.length > 0) {
      params.push(id)
      run(`UPDATE knowledge_categories SET ${sets.join(', ')} WHERE id = ?`, params)
    }
    const rows = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])
    const r = rows[0]
    return { id: r.id, name: r.name, parentId: r.parent_id, sortOrder: r.sort_order }
  })

  // 删除分类（子分类挂到父级，页面 category_id 置空）
  ipcMain.handle('knowledge:deleteCategory', (_e, id: string) => {
    // 子分类上移
    run('UPDATE knowledge_categories SET parent_id = (SELECT parent_id FROM knowledge_categories WHERE id = ?) WHERE parent_id = ?', [id, id])
    // 页面脱钩
    run('UPDATE knowledge_pages SET category_id = NULL WHERE category_id = ?', [id])
    run('DELETE FROM knowledge_categories WHERE id = ?', [id])
  })

  // ===== Page handlers =====
  // 获取分类下的页面
  ipcMain.handle('knowledge:getPages', (_e, categoryId?: string | null) => {
    let rows: PageRow[]
    if (categoryId) {
      rows = queryAll<PageRow>(
        'SELECT * FROM knowledge_pages WHERE category_id = ? ORDER BY sort_order, updated_at DESC',
        [categoryId]
      )
    } else if (categoryId === null) {
      // 未分类的页面
      rows = queryAll<PageRow>(
        'SELECT * FROM knowledge_pages WHERE category_id IS NULL ORDER BY sort_order, updated_at DESC'
      )
    } else {
      // 全部页面
      rows = queryAll<PageRow>(
        'SELECT * FROM knowledge_pages ORDER BY sort_order, updated_at DESC'
      )
    }
    return rows.map(mapPage)
  })

  // 获取单个页面
  ipcMain.handle('knowledge:getPageById', (_e, id: string) => {
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])
    if (rows.length === 0) return null
    return mapPage(rows[0])
  })

  // 创建页面
  ipcMain.handle('knowledge:createPage', (_e, data: { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const maxOrder = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS ?',
      [data.categoryId || null]
    )
    run(
      `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.title || '新页面', data.contentMd || '', data.contentHtml || '', data.categoryId || null, maxOrder[0]?.m ?? 0, now, now]
    )
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])
    return mapPage(rows[0])
  })

  // 更新页面
  ipcMain.handle('knowledge:updatePage', (_e, id: string, data: { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null }) => {
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [new Date().toISOString()]
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        sets.push(`${camelToSnake(k)} = ?`)
        params.push(v)
      }
    }
    params.push(id)
    run(`UPDATE knowledge_pages SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])
    return mapPage(rows[0])
  })

  // 移动页面（上下排序）
  ipcMain.handle('knowledge:movePage', (_e, id: string, direction: 'up' | 'down') => {
    const page = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])[0]
    if (!page) return
    const catId = page.category_id
    const cmp = direction === 'up' ? '<' : '>'
    const ord = direction === 'up' ? 'DESC' : 'ASC'
    // 找到相邻页面
    const neighbor = queryAll<PageRow>(
      `SELECT * FROM knowledge_pages WHERE category_id IS ? AND sort_order ${cmp} ? ORDER BY sort_order ${ord} LIMIT 1`,
      [catId, page.sort_order]
    )
    if (neighbor.length === 0) return
    // 交换 sort_order
    run('UPDATE knowledge_pages SET sort_order = ? WHERE id = ?', [neighbor[0].sort_order, id])
    run('UPDATE knowledge_pages SET sort_order = ? WHERE id = ?', [page.sort_order, neighbor[0].id])
  })

  // 删除页面（软删除 → 回收站）
  ipcMain.handle('knowledge:deletePage', (_e, id: string) => {
    // 读取完整页面
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])
    if (rows.length === 0) return

    const page = rows[0]

    // 读取关联标签
    const tags = queryAll<{ id: string; name: string; color: string }>(
      `SELECT t.id, t.name, t.color FROM knowledge_tags t
       JOIN knowledge_page_tags pt ON t.id = pt.tag_id
       WHERE pt.page_id = ?`, [id]
    )

    // 序列化完整数据
    const data = JSON.stringify({
      id: page.id,
      title: page.title,
      contentMd: page.content_md,
      contentHtml: page.content_html || '',
      categoryId: page.category_id,
      isStarred: !!page.is_starred,
      sortOrder: page.sort_order,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
      tags
    })

    // 插入回收站
    const binId = randomUUID()
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data)
       VALUES (?, ?, 'knowledge', ?, ?)`,
      [binId, id, page.title, data]
    )

    // 从原表删除（CASCADE 自动清理 knowledge_links + knowledge_page_tags）
    run('DELETE FROM knowledge_pages WHERE id = ?', [id])
  })

  // 搜索页面
  ipcMain.handle('knowledge:searchPages', (_e, q: string) => {
    const like = `%${q}%`
    const rows = queryAll<PageRow>(
      'SELECT * FROM knowledge_pages WHERE title LIKE ? OR content_md LIKE ? ORDER BY updated_at DESC',
      [like, like]
    )
    return rows.map(mapPage)
  })

  // 收藏/取消收藏页面
  ipcMain.handle('knowledge:toggleStar', (_e, id: string) => {
    run('UPDATE knowledge_pages SET is_starred = CASE WHEN is_starred THEN 0 ELSE 1 END WHERE id = ?', [id])
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])
    return mapPage(rows[0])
  })

  // 获取收藏的页面
  ipcMain.handle('knowledge:getStarredPages', () => {
    const rows = queryAll<PageRow>(
      'SELECT * FROM knowledge_pages WHERE is_starred = 1 ORDER BY updated_at DESC'
    )
    return rows.map(mapPage)
  })

  // ===== Links =====
  // 获取反向链接（哪些页面链接到了此页面）
  ipcMain.handle('knowledge:getBacklinks', (_e, pageId: string) => {
    const rows = queryAll<PageRow>(
      `SELECT p.* FROM knowledge_pages p
       INNER JOIN knowledge_links l ON l.source_page_id = p.id
       WHERE l.target_page_id = ?
       ORDER BY p.updated_at DESC`,
      [pageId]
    )
    return rows.map(mapPage)
  })

  // 更新页面链接（保存时调用，重建所有链接关系）
  ipcMain.handle('knowledge:updateLinks', (_e, pageId: string, linkedTitles: string[]) => {
    // 删除此页面的旧链接
    run('DELETE FROM knowledge_links WHERE source_page_id = ?', [pageId])
    // 根据标题查找目标页面并建立链接
    for (const title of linkedTitles) {
      const targets = queryAll<{ id: string }>(
        'SELECT id FROM knowledge_pages WHERE title = ?', [title]
      )
      for (const t of targets) {
        if (t.id !== pageId) {
          const linkId = randomUUID()
          try { run('INSERT INTO knowledge_links (id, source_page_id, target_page_id) VALUES (?, ?, ?)', [linkId, pageId, t.id]) } catch { /* unique constraint */ }
        }
      }
    }
  })

  // ===== Tags =====
  ipcMain.handle('knowledge:getTags', () => {
    return queryAll<{ id: string; name: string; color: string }>(
      'SELECT * FROM knowledge_tags ORDER BY name'
    )
  })

  ipcMain.handle('knowledge:createTag', (_e, name: string, color?: string) => {
    const id = randomUUID()
    run('INSERT INTO knowledge_tags (id, name, color) VALUES (?, ?, ?)', [id, name, color || '#6b7280'])
    const rows = queryAll<{ id: string; name: string; color: string }>('SELECT * FROM knowledge_tags WHERE id = ?', [id])
    return rows[0]
  })

  ipcMain.handle('knowledge:deleteTag', (_e, id: string) => {
    run('DELETE FROM knowledge_tags WHERE id = ?', [id])
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
