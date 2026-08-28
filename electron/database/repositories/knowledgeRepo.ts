import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getDatabase, saveToDisk, getAttachmentsDir } from '../connection'
import { deleteAttachments, trashAttachments, parseInlineAttachmentIds } from './attachmentRepo'
import { buildUpdateSet } from '../../lib/safeUpdate'
import { recordActivity } from '../../lib/habitLinkService'

// ---- row types (snake_case matching SQLite columns) ----
interface CategoryRow { id: string; name: string; parent_id: string | null; sort_order: number; category_type: string }
interface PageRow { id: string; title: string; content_md: string; content_html: string | null; category_id: string | null; is_starred: number; sort_order: number; file_type: string; attachment_id: string; annotation_md?: string; created_at: string; updated_at: string }

type CategoryType = 'notebook' | 'folder' | 'space'

function normalizeCategoryType(raw: string): CategoryType {
  if (raw === 'notebook' || raw === 'space' || raw === 'folder') return raw
  return 'folder'
}

function mapCategory(r: CategoryRow) {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    sortOrder: r.sort_order,
    categoryType: normalizeCategoryType(r.category_type),
  }
}

function getCategory(id: string): CategoryRow | undefined {
  return queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])[0]
}

function hasChildCategories(id: string): boolean {
  return queryAll<{ id: string }>(
    'SELECT id FROM knowledge_categories WHERE parent_id = ? LIMIT 1',
    [id]
  ).length > 0
}

function isCategoryDescendant(ancestorId: string, nodeId: string): boolean {
  const seen = new Set<string>()
  let currentId: string | null = nodeId
  while (currentId) {
    if (seen.has(currentId)) return false
    seen.add(currentId)
    if (currentId === ancestorId) return true
    const current = getCategory(currentId)
    currentId = current?.parent_id ?? null
  }
  return false
}

function assertCategoryRules(id: string | null, categoryType: CategoryType, parentId: string | null): void {
  if (parentId === null) {
    if (categoryType !== 'space') throw new Error('根层级只能创建空间')
    return
  }

  const parent = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [parentId])[0]
  if (!parent) throw new Error('目标分类不存在')
  if (id && parent.id === id) throw new Error('不能将分类移动到自身')

  if (id && isCategoryDescendant(id, parent.id)) throw new Error('cannot move category into its descendant')

  const parentType = normalizeCategoryType(parent.category_type)
  const parentOfParent = parent.parent_id ? getCategory(parent.parent_id) : undefined
  const parentIsChapter = parentType === 'folder' && parentOfParent
    ? normalizeCategoryType(parentOfParent.category_type) === 'notebook'
    : false

  if (parentIsChapter) throw new Error('cannot create or move a category under a chapter')
  if (parentType === 'notebook' && categoryType === 'folder' && id && hasChildCategories(id)) {
    throw new Error('cannot move a folder with child categories into a notebook')
  }
  if (categoryType === 'space') throw new Error('空间只能位于根层级')
  if (parentType === 'notebook' && categoryType !== 'folder') throw new Error('笔记本下只能创建或移动章节目录')
  if (categoryType === 'notebook' && parentType === 'notebook') throw new Error('笔记本不能嵌套在另一个笔记本中')
}

function assertPageContainer(categoryId: string | null): void {
  if (categoryId === null) return
  const cat = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [categoryId])[0]
  if (!cat) throw new Error('目标分类不存在')
  const categoryType = normalizeCategoryType(cat.category_type)
  if (categoryType === 'notebook') {
    throw new Error('页面不能直接放在笔记本下，请选择笔记本内的章节')
  }
}

function mapPage(r: PageRow) {
  const raw = ((r as any).file_type || '')
  const normalized = raw.replace(/^\./, '').toLowerCase()
  return {
    id: r.id, title: r.title,
    contentMd: r.content_md, contentHtml: r.content_html || '',
    annotationMd: (r as any).annotation_md || '',
    categoryId: r.category_id,
    isStarred: !!r.is_starred,
    sortOrder: r.sort_order,
    fileType: normalized,
    attachmentId: r.attachment_id || '',
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

/** 粗剥 markdown 记号 → 纯文本（用于搜索/引用摘录展示） */
function mdToPlain(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')              // 围栏代码块
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')    // 链接/图片 → 文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')           // 标题井号
    .replace(/[>*`~_|]/g, ' ')                    // 行内记号
    .replace(/\s+/g, ' ')
    .trim()
}

/** 在纯文本中定位首个命中词，取前后各 radius 字符的摘录 */
function buildExcerpt(plain: string, terms: string[], radius = 60): string {
  if (!plain) return ''
  const lower = plain.toLowerCase()
  let idx = -1
  for (const t of terms) {
    if (!t) continue
    idx = lower.indexOf(t.toLowerCase())
    if (idx >= 0) break
  }
  if (idx < 0) return ''
  const start = Math.max(0, idx - radius)
  const end = Math.min(plain.length, idx + radius)
  return (start > 0 ? '…' : '') + plain.slice(start, end).trim() + (end < plain.length ? '…' : '')
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
    return rows.map(mapCategory)
  })

  // 创建分类
  ipcMain.handle('knowledge:createCategory', (_e, data: { name: string; parentId?: string | null; categoryType?: CategoryType }) => {
    const id = randomUUID()
    const ct = normalizeCategoryType(data.categoryType || 'folder')
    const parentId = data.parentId === undefined ? null : data.parentId
    assertCategoryRules(null, ct, parentId)
    const maxOrder = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id IS ?',
      [parentId]
    )
    run(
      'INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, ?, ?, ?)',
      [id, data.name, parentId, maxOrder[0]?.m ?? 0, ct]
    )
    const rows = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])
    return mapCategory(rows[0])
  })

  // 更新分类（重命名/移动）— 72b2480 兼容逻辑：不引用 updated_at
  ipcMain.handle('knowledge:updateCategory', (_e, id: string, data: { name?: string; parentId?: string | null; sortOrder?: number; categoryType?: CategoryType }) => {
    console.log(`[knowledge:updateCategory] id=${id} data=`, JSON.stringify(data))

    const current = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])[0]
    if (!current) throw new Error('分类不存在')
    const effectiveType = data.categoryType === undefined
      ? normalizeCategoryType(current.category_type)
      : normalizeCategoryType(data.categoryType)
    const effectiveParentId = data.parentId === undefined ? current.parent_id : data.parentId
    assertCategoryRules(id, effectiveType, effectiveParentId)

    const sets: string[] = []
    const params: unknown[] = []
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name) }
    if (data.parentId !== undefined) { sets.push('parent_id = ?'); params.push(effectiveParentId) }
    if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(data.sortOrder) }
    if (data.categoryType !== undefined) { sets.push('category_type = ?'); params.push(effectiveType) }
    // When moving category to a different parent, reset sort_order to append at end
    if (data.parentId !== undefined && data.sortOrder === undefined) {
      if (current.parent_id !== effectiveParentId) {
        const maxOrder = queryAll<{ m: number }>(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id IS ?',
          [effectiveParentId]
        )
        sets.push('sort_order = ?')
        params.push(maxOrder[0]?.m ?? 0)
      }
    }
    if (sets.length > 0) {
      params.push(id)
      run(`UPDATE knowledge_categories SET ${sets.join(', ')} WHERE id = ?`, params)
    }
    const rows = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])
    return mapCategory(rows[0])
  })

  // 移动分类（上下排序）
  ipcMain.handle('knowledge:moveCategory', (_e, id: string, direction: 'up' | 'down') => {
    const cat = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])[0]
    if (!cat) return
    const parentId = cat.parent_id
    const cmp = direction === 'up' ? '<' : '>'
    const ord = direction === 'up' ? 'DESC' : 'ASC'
    const neighbor = queryAll<CategoryRow>(
      `SELECT * FROM knowledge_categories WHERE parent_id IS ? AND sort_order ${cmp} ? ORDER BY sort_order ${ord} LIMIT 1`,
      [parentId, cat.sort_order]
    )
    if (neighbor.length === 0) return
    run('UPDATE knowledge_categories SET sort_order = ? WHERE id = ?', [neighbor[0].sort_order, id])
    run('UPDATE knowledge_categories SET sort_order = ? WHERE id = ?', [cat.sort_order, neighbor[0].id])
  })

  // 删除分类 — 软删除（完整快照存入回收站，子树页面全删）
  ipcMain.handle('knowledge:deleteCategory', (_e, id: string) => {
    const cat = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [id])[0]
    if (!cat) return

    // ---- 1) 递归收集所有子孙分类 ID（必须在 reparent 之前） ----
    const descendantIds: string[] = []
    const collectIds = (parentId: string) => {
      const kids = queryAll<{ id: string }>('SELECT id FROM knowledge_categories WHERE parent_id = ?', [parentId])
      for (const k of kids) { descendantIds.push(k.id); collectIds(k.id) }
    }
    collectIds(id)
    const allCatIds = [id, ...descendantIds]

    // ---- 2) 收集快照数据 ----
    const collectChildren = (parentId: string): any[] => {
      const children = queryAll<CategoryRow>(
        'SELECT * FROM knowledge_categories WHERE parent_id = ?', [parentId]
      )
      return children.map(ch => ({
        category: {
          id: ch.id, name: ch.name, parentId: ch.parent_id,
          sortOrder: ch.sort_order, categoryType: normalizeCategoryType(ch.category_type),
        },
        pages: queryAll<PageRow>(
          'SELECT * FROM knowledge_pages WHERE category_id = ?', [ch.id]
        ).map(p => ({
          ...mapPage(p),
          tags: queryAll<{ id: string; name: string; color: string }>(
            `SELECT t.id, t.name, t.color FROM knowledge_tags t
             JOIN knowledge_page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?`, [p.id]
          )
        }))
      }))
    }

    const directPages = queryAll<PageRow>(
      'SELECT * FROM knowledge_pages WHERE category_id = ?', [id]
    ).map(p => ({
      ...mapPage(p),
      tags: queryAll<{ id: string; name: string; color: string }>(
        `SELECT t.id, t.name, t.color FROM knowledge_tags t
         JOIN knowledge_page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?`, [p.id]
      )
    }))

    const snapshot = JSON.stringify({
      category: {
        id: cat.id, name: cat.name, parentId: cat.parent_id,
        sortOrder: cat.sort_order, categoryType: normalizeCategoryType(cat.category_type),
      },
      children: collectChildren(id),
      pages: directPages,
    })

    // ---- 3) 存入回收站 ----
    const binId = randomUUID()
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data)
       VALUES (?, ?, 'knowledge_category', ?, ?)`,
      [binId, id, cat.name, snapshot]
    )

    // ---- 4) 删除所有页面 ----
    for (const cid of allCatIds) {
      const pageIds = queryAll<{ id: string }>('SELECT id FROM knowledge_pages WHERE category_id = ?', [cid])
      for (const p of pageIds) {
        run('DELETE FROM knowledge_page_tags WHERE page_id = ?', [p.id])
        run('DELETE FROM knowledge_links WHERE source_page_id = ? OR target_page_id = ?', [p.id, p.id])
      }
      run('DELETE FROM knowledge_pages WHERE category_id = ?', [cid])
    }

    // ---- 5) 删除分类（子分类先上移后删除，从最深到最浅） ----
    run('UPDATE knowledge_categories SET parent_id = (SELECT parent_id FROM knowledge_categories WHERE id = ?) WHERE parent_id = ?', [id, id])
    descendantIds.reverse()
    for (const did of descendantIds) {
      // Reparent children of this descendant to its parent before deleting
      run('UPDATE knowledge_categories SET parent_id = (SELECT parent_id FROM knowledge_categories WHERE id = ?) WHERE parent_id = ?', [did, did])
      run('DELETE FROM knowledge_categories WHERE id = ?', [did])
    }
    run('DELETE FROM knowledge_categories WHERE id = ?', [id])
  })

  // ===== Page handlers =====
  // 获取分类下的页面
  // 列表瘦身:不含 content_md / content_html / annotation_md(大字段,编辑器按需经 getPageById 取全量)
const PAGE_LIST_COLUMNS = 'id, title, category_id, sort_order, file_type, is_starred, attachment_id, created_at, updated_at'

ipcMain.handle('knowledge:getPages', (_e, categoryId?: string | null) => {
    let rows: PageRow[]
    if (categoryId) {
      rows = queryAll<PageRow>(
        `SELECT ${PAGE_LIST_COLUMNS} FROM knowledge_pages WHERE category_id = ? ORDER BY sort_order, updated_at DESC`,
        [categoryId]
      )
    } else if (categoryId === null) {
      // 未分类的页面
      rows = queryAll<PageRow>(
        `SELECT ${PAGE_LIST_COLUMNS} FROM knowledge_pages WHERE category_id IS NULL ORDER BY sort_order, updated_at DESC`
      )
    } else {
      // 全部页面
      rows = queryAll<PageRow>(
        'SELECT * FROM knowledge_pages ORDER BY sort_order, updated_at DESC'
      )
    }
    return rows.map(r => ({
      ...mapPage(r),
      tags: queryAll<{ id: string; name: string; color: string }>(
        `SELECT t.id, t.name, t.color FROM knowledge_tags t
         JOIN knowledge_page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?`, [r.id]
      )
    }))
  })

  // 获取单个页面
  ipcMain.handle('knowledge:getPageById', (_e, id: string) => {
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])
    if (rows.length === 0) return null
    const page = mapPage(rows[0])
    return {
      ...page,
      tags: queryAll<{ id: string; name: string; color: string }>(
        `SELECT t.id, t.name, t.color FROM knowledge_tags t
         JOIN knowledge_page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?`, [id]
      )
    }
  })

  // 创建页面
  ipcMain.handle('knowledge:createPage', (e, data: { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null; fileType?: string }) => {
    const id = randomUUID()
    const now = new Date()
    const nowIso = now.toISOString()
    assertPageContainer(data.categoryId ?? null)
    const maxOrder = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS ?',
      [data.categoryId || null]
    )
    const ft = (data.fileType || '').replace(/^\./, '').toLowerCase()
    run(
      `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.title || '新页面', data.contentMd || '', data.contentHtml || '', data.categoryId || null, maxOrder[0]?.m ?? 0, ft, nowIso, nowIso]
    )
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])

    // 联动:当天新建页面数达标则自动打卡(现值由 habitLinkService 反查)
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    void recordActivity({ source: 'knowledge', date: localDate, refId: id }, e.sender)

    return mapPage(rows[0])
  })

  // 更新页面
  ipcMain.handle('knowledge:updatePage', (_e, id: string, data: { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null; fileType?: string; tags?: string[] }) => {
    if (data.categoryId !== undefined) assertPageContainer(data.categoryId ?? null)
    // 列名白名单:渲染层传入的 key 不直接拼 SQL(防注入)
    const { sets, params } = buildUpdateSet(
      data,
      ['title', 'content_md', 'content_html', 'category_id', 'file_type'],
      { sets: ['updated_at = ?'], params: [new Date().toISOString()] }
    )
    // When moving page to a different category, reset sort_order to append at end
    if (data.categoryId !== undefined) {
      const oldPage = queryAll<PageRow>('SELECT category_id FROM knowledge_pages WHERE id = ?', [id])[0]
      if (oldPage && oldPage.category_id !== data.categoryId) {
        const maxOrder = queryAll<{ m: number }>(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS ?',
          [data.categoryId]
        )
        sets.push('sort_order = ?')
        params.push(maxOrder[0]?.m ?? 0)
      }
    }
    params.push(id)
    run(`UPDATE knowledge_pages SET ${sets.join(', ')} WHERE id = ?`, params)

    // Update tags if provided
    if (data.tags !== undefined) {
      run('DELETE FROM knowledge_page_tags WHERE page_id = ?', [id])
      for (const tagId of data.tags) {
        run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [id, tagId])
      }
    }

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

  // 重排页面到指定索引（拖拽排序用）
  ipcMain.handle('knowledge:reorderPage', (_e, id: string, targetIndex: number) => {
    const page = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [id])[0]
    if (!page) return
    const catId = page.category_id
    // Get all sibling pages ordered by sort_order (excluding the moved page)
    const siblings = queryAll<PageRow>(
      'SELECT * FROM knowledge_pages WHERE category_id IS ? AND id != ? ORDER BY sort_order',
      [catId, id]
    )
    // Build new order: insert the moved page at targetIndex
    const newOrder: { id: string; sortOrder: number }[] = []
    for (let i = 0; i < siblings.length; i++) {
      if (newOrder.length === targetIndex) {
        newOrder.push({ id: page.id, sortOrder: targetIndex })
      }
      newOrder.push({ id: siblings[i].id, sortOrder: newOrder.length })
    }
    if (newOrder.length <= targetIndex) {
      newOrder.push({ id: page.id, sortOrder: newOrder.length })
    }
    // Write back all sort_orders
    for (const item of newOrder) {
      run('UPDATE knowledge_pages SET sort_order = ? WHERE id = ?', [item.sortOrder, item.id])
    }
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
    const pageFileType = (page as any).file_type || page.file_type || ''
    const data = JSON.stringify({
      id: page.id,
      title: page.title,
      contentMd: page.content_md,
      contentHtml: page.content_html || '',
      categoryId: page.category_id,
      isStarred: !!page.is_starred,
      sortOrder: page.sort_order,
      fileType: pageFileType,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
      tags
    })

    // 如果是 PDF / XMind 等附件文件，清理附件（统一附件表）
    if (page.attachment_id) {
      deleteAttachments([page.attachment_id])
    } else if ((pageFileType === 'pdf' || pageFileType === 'xmind') && page.content_md) {
      const attachPath = join(getAttachmentsDir(), page.content_md)
      if (existsSync(attachPath)) {
        try { unlinkSync(attachPath) } catch { /* file may already be gone */ }
      }
    }

    // 插入回收站
    const binId = randomUUID()
    const inlineAttachmentIds = parseInlineAttachmentIds(page.content_md)
    if (inlineAttachmentIds.length > 0) trashAttachments(inlineAttachmentIds, binId)
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data)
       VALUES (?, ?, 'knowledge', ?, ?)`,
      [binId, id, page.title, data]
    )

    // 从原表删除（CASCADE 自动清理 knowledge_links + knowledge_page_tags）
    run('DELETE FROM knowledge_pages WHERE id = ?', [id])
  })

  // 搜索页面（多关键词 AND + 命中摘录）
  ipcMain.handle('knowledge:searchPages', (_e, q: string) => {
    const terms = q.trim().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []
    // 每个词都须命中（标题或正文）
    const conds = terms.map(() => '(title LIKE ? OR content_md LIKE ?)').join(' AND ')
    const params: unknown[] = []
    for (const t of terms) { params.push(`%${t}%`, `%${t}%`) }
    const rows = queryAll<PageRow>(
      `SELECT * FROM knowledge_pages WHERE ${conds} ORDER BY updated_at DESC LIMIT 50`,
      params
    )
    // 搜索结果只回摘录,不回传大字段(避免 50 条 × 数百 KB 的 IPC 负载)
    return rows.map(r => {
      const { content_md: _cm, content_html: _ch, annotation_md: _am, ...slim } = r as Record<string, unknown>
      void _cm; void _ch; void _am
      return {
        ...mapPage(slim as PageRow),
        excerpt: buildExcerpt(mdToPlain(String(r.content_md || '')), terms)
      }
    })
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
      `SELECT ${PAGE_LIST_COLUMNS} FROM knowledge_pages WHERE is_starred = 1 ORDER BY updated_at DESC`
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

  // 反链上下文摘录：定位源页中 [[标题]] 引用处，取前后各约 60 字符
  ipcMain.handle('knowledge:getBacklinkContext', (_e, pageId: string) => {
    const page = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [pageId])[0]
    if (!page) return []
    const needle = `[[${page.title}]]`.toLowerCase()
    const loose = `[[${page.title}`.toLowerCase() // 容忍未闭合/带别名写法
    const sources = queryAll<PageRow>(
      `SELECT p.* FROM knowledge_pages p
       INNER JOIN knowledge_links l ON l.source_page_id = p.id
       WHERE l.target_page_id = ?
       ORDER BY p.updated_at DESC`,
      [pageId]
    )
    return sources.map(src => {
      const texts = [src.content_md || '', (src as any).annotation_md || '']
      let excerpt = ''
      for (const raw of texts) {
        const lower = raw.toLowerCase()
        const idx = lower.indexOf(needle) >= 0 ? lower.indexOf(needle) : lower.indexOf(loose)
        if (idx < 0) continue
        const start = Math.max(0, idx - 60)
        const end = Math.min(raw.length, idx + page.title.length + 70)
        excerpt = ((start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : ''))
          .replace(/\s+/g, ' ')
          .trim()
        break
      }
      return {
        id: src.id,
        title: src.title,
        fileType: ((src.file_type || '') as string).replace(/^\./, '').toLowerCase(),
        updatedAt: src.updated_at,
        excerpt
      }
    })
  })

  // ===== 手动关联（与自动 wiki 链接分表，双向展示）=====
  ipcMain.handle('knowledge:getManualLinks', (_e, pageId: string) => {
    const rows = queryAll<PageRow>(
      `SELECT p.* FROM knowledge_pages p
       INNER JOIN knowledge_manual_links k
         ON (k.page_id = p.id OR k.target_id = p.id)
       WHERE (k.page_id = ? OR k.target_id = ?) AND p.id != ?
       ORDER BY k.created_at DESC`,
      [pageId, pageId, pageId]
    )
    return rows.map(mapPage)
  })

  ipcMain.handle('knowledge:addManualLink', (_e, pageId: string, targetId: string) => {
    if (!pageId || !targetId || pageId === targetId) return { ok: false }
    try {
      run(
        'INSERT OR IGNORE INTO knowledge_manual_links (id, page_id, target_id) VALUES (?, ?, ?)',
        [randomUUID(), pageId, targetId]
      )
      return { ok: true }
    } catch (e) {
      console.error('[addManualLink] failed:', e)
      return { ok: false }
    }
  })

  ipcMain.handle('knowledge:removeManualLink', (_e, a: string, b: string) => {
    run(
      'DELETE FROM knowledge_manual_links WHERE (page_id = ? AND target_id = ?) OR (page_id = ? AND target_id = ?)',
      [a, b, b, a]
    )
    return { ok: true }
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

  // ===== Duplicate =====
  // 深拷贝页面
  ipcMain.handle('knowledge:duplicatePage', (_e, data: { pageId: string; targetCategoryId?: string | null }) => {
    const rows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [data.pageId])
    if (rows.length === 0) return null
    const src = rows[0]
    const newId = randomUUID()
    const now = new Date().toISOString()
    const targetCat = data.targetCategoryId !== undefined ? data.targetCategoryId : src.category_id
    assertPageContainer(targetCat ?? null)
    const maxOrder = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS ?',
      [targetCat]
    )
    run(
      `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, is_starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [newId, src.title + ' (副本)', src.content_md, src.content_html || '', targetCat, maxOrder[0]?.m ?? 0, (src as any).file_type || src.file_type || '', now, now]
    )
    const newRows = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE id = ?', [newId])
    return mapPage(newRows[0])
  })

  // 深拷贝分类（含子树和页面）
  ipcMain.handle('knowledge:duplicateCategory', (_e, data: { categoryId: string; targetParentId?: string | null }) => {
    const cat = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [data.categoryId])[0]
    if (!cat) return null

    const targetParent = data.targetParentId !== undefined ? data.targetParentId : cat.parent_id
    if (normalizeCategoryType(cat.category_type) === 'folder' && targetParent) {
      const target = getCategory(targetParent)
      if (target && normalizeCategoryType(target.category_type) === 'notebook' && hasChildCategories(data.categoryId)) {
        throw new Error('cannot duplicate a folder with child categories into a notebook')
      }
    }
    assertCategoryRules(null, normalizeCategoryType(cat.category_type), targetParent)

    // Recursively duplicate categories
    const dupCategory = (oldId: string, newParentId: string | null): string | null => {
      const oldCat = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [oldId])[0]
      if (!oldCat) return null
      const newId = randomUUID()
      const maxOrder = queryAll<{ m: number }>(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id IS ?',
        [newParentId]
      )
      run(
        'INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, ?, ?, ?)',
        [newId, oldCat.name + ' (副本)', newParentId, maxOrder[0]?.m ?? 0, oldCat.category_type]
      )
      // Duplicate pages under this category
      const pages = queryAll<PageRow>('SELECT * FROM knowledge_pages WHERE category_id = ? ORDER BY sort_order', [oldId])
      for (const p of pages) {
        const newPageId = randomUUID()
        const now = new Date().toISOString()
        run(
          `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, is_starred, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [newPageId, p.title, p.content_md, p.content_html || '', newId, p.sort_order, (p as any).file_type || p.file_type || '', now, now]
        )
      }
      // Recurse into children
      const children = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE parent_id = ? ORDER BY sort_order', [oldId])
      for (const ch of children) {
        dupCategory(ch.id, newId)
      }
      return newId
    }

    const newRootId = dupCategory(data.categoryId, targetParent)
    if (!newRootId) return null

    const newCat = queryAll<CategoryRow>('SELECT * FROM knowledge_categories WHERE id = ?', [newRootId])[0]
    return {
      id: newCat.id, name: newCat.name, parentId: newCat.parent_id,
      sortOrder: newCat.sort_order,
      categoryType: normalizeCategoryType(newCat.category_type),
    }
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
