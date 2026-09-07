// R6 去库化：真相源 = .knowbase/modules/recycle-bin.json（sql.js 路径已移除，D9）
import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { trashItem, trashAll } from '../../lib/trashFiles'
import { restoreAttachments, parseInlineAttachmentIds } from './attachmentRepo'
import { encryptPassword } from './passwordRepo'
import { vaultPasswordsAll, vaultPasswordsSave } from '../../lib/kbStore/secretVaultRepo'
import { readJson, writeJson } from '../../lib/kbStore/jsonStore'

function getSettingsRetentionDays(): number {
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return 30
    const s = JSON.parse(readFileSync(path, 'utf-8'))
    const raw = typeof s.recycleBinRetentionDays === 'number' ? s.recycleBinRetentionDays : 30
    // NaN/非法值兜底并夹取到合理区间
    if (!Number.isFinite(raw)) return 30
    return Math.min(3650, Math.max(1, Math.round(raw)))
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

// ---- sqlite 辅助（仅剩恢复目标模块的写入在使用，属各模块 R6 范围） ----
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

function normalizeCategoryType(raw: unknown): 'notebook' | 'folder' | 'space' {
  if (raw === 'notebook' || raw === 'space') return raw
  return 'folder'
}

function getOrCreateDefaultSpaceId(): string {
  const existing = queryAll<{ id: string }>(
    "SELECT id FROM knowledge_categories WHERE category_type = 'space' AND parent_id IS NULL ORDER BY sort_order, name LIMIT 1"
  )
  if (existing[0]) return existing[0].id

  const id = randomUUID()
  const maxOrder = queryAll<{ m: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id IS NULL'
  )[0]?.m ?? 0
  run(
    `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
     VALUES (?, '默认空间', NULL, ?, 'space')`,
    [id, maxOrder]
  )
  return id
}

function resolveCategoryParent(categoryType: unknown, parentId: string | null | undefined): string | null {
  const ct = normalizeCategoryType(categoryType)
  if (ct === 'space') return null

  if (parentId) {
    const parentExists = queryAll<{ id: string }>(
      'SELECT id FROM knowledge_categories WHERE id = ?',
      [parentId]
    ).length > 0
    if (parentExists) return parentId
  }

  return getOrCreateDefaultSpaceId()
}

// ---- 回收站 JSON 存取（.knowbase/modules/recycle-bin.json，原子写） ----
const RB_MODULE = 'modules'
const RB_KEY = 'recycle-bin.json'

function readBin(): RecycleBinRow[] {
  return readJson<RecycleBinRow[]>(RB_MODULE, RB_KEY, [])
}

function writeBin(rows: RecycleBinRow[]): void {
  writeJson(RB_MODULE, RB_KEY, rows)
}

function findBin(rows: RecycleBinRow[], id: string): RecycleBinRow | undefined {
  return rows.find(r => r.id === id)
}

function removeBin(rows: RecycleBinRow[], id: string): RecycleBinRow[] {
  return rows.filter(r => r.id !== id)
}

function sortByDeletedAtDesc(rows: RecycleBinRow[]): void {
  rows.sort((a, b) => (a.deleted_at > b.deleted_at ? -1 : a.deleted_at < b.deleted_at ? 1 : 0))
}

/** 本地时间 'YYYY-MM-DD HH:MM:SS'（与原表 datetime 默认值语义一致） */
function formatLocalDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 过期判断：兼容历史 ISO('...T...Z') 与 'YYYY-MM-DD HH:MM:SS' 两种格式，统一到秒级字符串比较 */
function isExpired(deletedAt: string, cutoff: string): boolean {
  return deletedAt.replace('T', ' ').slice(0, 19) < cutoff
}

/** 清理过期项并返回清理后的列表（有变更才落盘） */
function purgeExpiredRows(): RecycleBinRow[] {
  const retentionDays = getSettingsRetentionDays()
  const cutoff = formatLocalDateTime(new Date(Date.now() - retentionDays * 86400000))
  const rows = readBin()
  const kept = rows.filter(r => !isExpired(r.deleted_at, cutoff))
  if (kept.length !== rows.length) writeBin(kept)
  return kept
}

/** 统一写 API：其它模块删除条目入回收站时调用（替代散布的 INSERT INTO recycle_bin 直写 SQL） */
export function recycleBinAdd(entry: { id: string; original_id: string; module: string; title: string; data: string; deleted_at?: string }): void {
  const rows = readBin()
  rows.push({
    id: entry.id,
    original_id: entry.original_id,
    module: entry.module,
    title: entry.title,
    data: entry.data,
    deleted_at: entry.deleted_at ?? formatLocalDateTime(new Date()),
  })
  writeBin(rows)
}

/** 统一读 API：导出/导入去重等读侧使用（替代散布的 SELECT * FROM recycle_bin 直查 SQL） */
export function recycleBinGetAll(): RecycleBinRow[] {
  return readBin()
}

export function registerRecycleBinHandlers(): void {
  // ---- 获取回收站列表（自动清除过期项） ----
  ipcMain.handle('recycleBin:getItems', () => {
    // 清除过期数据
    const rows = purgeExpiredRows()
    sortByDeletedAtDesc(rows)

    // 逐条容错:单条快照损坏只跳过该条,不拖垮整个回收站列表
    const items: unknown[] = []
    for (const r of rows) {
      try {
        items.push({
          id: r.id,
          originalId: r.original_id,
          module: r.module,
          title: r.title,
          data: JSON.parse(r.data),
          deletedAt: r.deleted_at
        })
      } catch { /* 跳过损坏条目 */ }
    }
    return items
  })

  // ---- 恢复回收站项目 ----
  ipcMain.handle('recycleBin:restoreItem', (_e, id: string): { success: boolean; message?: string } | undefined => {
    const item = findBin(readBin(), id)
    if (!item) return

    let record: any
    try { record = JSON.parse(item.data) } catch {
      return { success: false, message: '该条目数据已损坏,无法恢复(可直接删除)' }
    }

    if (item.module === 'blog') {
      // 恢复博文 — 同日期去重:已有该日期日志时不恢复(避免造出重复日期条目)
      const dup = queryAll<{ id: string }>('SELECT id FROM entries WHERE date = ?', [record.date])
      if (dup.length > 0) {
        return { success: false, message: `恢复失败:${record.date} 已存在日志,请先处理该日的现有日志` }
      }
      run(
        `INSERT INTO entries (id, title, content_md, content_html, date, created_at, updated_at, is_pinned, word_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id, record.title, record.contentMd, record.contentHtml || '',
          record.date, record.createdAt, record.updatedAt,
          record.isPinned ? 1 : 0, record.wordCount || 0
        ]
      )
      // 恢复正文内联图片附件
      restoreAttachments(parseInlineAttachmentIds(record.contentMd || ''))
      // 恢复标签关联
      if (record.tags && Array.isArray(record.tags)) {
        for (const tag of record.tags as TagRow[]) {
          try {
            run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [record.id, tag.id])
          } catch { /* 标签可能已被删除 */ }
        }
      }
    } else if (item.module === 'knowledge') {
      // 恢复知识页面 — 分类可能已被单独删除:失效时置 NULL(落入未分类),避免外键失败卡死条目
      const catOk = record.categoryId
        ? queryAll<{ id: string }>('SELECT id FROM knowledge_categories WHERE id = ?', [record.categoryId]).length > 0
        : false
      run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id, record.title, record.contentMd, record.contentHtml || '',
          catOk ? record.categoryId : null, record.isStarred ? 1 : 0,
          record.sortOrder || 0, record.fileType || '', record.createdAt, record.updatedAt
        ]
      )
      // 恢复正文内联图片附件
      restoreAttachments(parseInlineAttachmentIds(record.contentMd || ''))
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
      const categoryType = normalizeCategoryType(cat.categoryType)
      const parentId = resolveCategoryParent(categoryType, cat.parentId)

      run(
        `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
         VALUES (?, ?, ?, ?, ?)`,
        [cat.id, cat.name, parentId, cat.sortOrder || 0, categoryType]
      )

      // Recursively restore children
      const restoreChildren = (children: any[], parentId: string) => {
        for (const ch of (children || [])) {
          const c = ch.category
          run(
            `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
             VALUES (?, ?, ?, ?, ?)`,
            [c.id, c.name, parentId, c.sortOrder || 0, c.categoryType === 'notebook' || c.categoryType === 'space' ? c.categoryType : 'folder']
          )
          // Restore pages under this child
          for (const p of (ch.pages || [])) {
            try {
              run(
                `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [p.id, p.title, p.contentMd, p.contentHtml || '', c.id, p.isStarred ? 1 : 0, p.sortOrder || 0, p.fileType || '', p.createdAt, p.updatedAt]
              )
            } catch { /* 页面已存在(可能被单独恢复过),跳过 */ }
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
        try {
          run(
            `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [p.id, p.title, p.contentMd, p.contentHtml || '', cat.id, p.isStarred ? 1 : 0, p.sortOrder || 0, p.fileType || '', p.createdAt, p.updatedAt]
          )
        } catch { /* 页面已存在(可能被单独恢复过),跳过 */ }
        for (const tag of (p.tags || [])) {
          try {
            run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [p.id, tag.id])
          } catch { /* tag may have been deleted */ }
        }
      }
    } else if (item.module === 'passwordVault') {
      // 恢复密码条目(新快照中密码为密文,直接插回;旧明文快照插入后由加密清理统一处理)
      // P5b：vault 恢复进 .knowbase/secret/passwords.json（密文原样，明文快照补加密）
      const vrows = vaultPasswordsAll()
      if (vrows.some((r) => r.id === record.id)) return { success: false, message: '仓库中已存在同一条目' }
      const storedPwd = typeof record.password === 'string' && !record.password.startsWith('enc1:') ? encryptPassword(record.password) : record.password
      const nextOrder = vrows.reduce((m, r) => Math.max(m, (r.sort_order ?? 0) + 1), 0)
      vrows.push({
        id: record.id, title: record.title || '', url: record.url || null, username: record.username || null,
        account: record.account || null, password: storedPwd, notes: record.notes || null,
        sort_order: nextOrder, created_at: record.createdAt, updated_at: record.updatedAt,
      })
      vaultPasswordsSave(vrows)
    } else if (item.module === 'moments') {
      const images = Array.isArray(record.imageDataUrls)
        ? record.imageDataUrls
        : (record.imageDataUrl ? [record.imageDataUrl] : [])
      const tags = Array.isArray(record.tags) ? record.tags.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0) : []
      const attachmentIds = Array.isArray(record.attachmentIds) ? record.attachmentIds : []
      // 相册可能已删除:置空避免外键失败
      const albumOk = record.albumId
        ? queryAll<{ id: string }>('SELECT id FROM moments_albums WHERE id = ?', [record.albumId]).length > 0
        : false
      // 先插记录、后恢复附件文件:插入失败时文件不被挪动,不留半状态
      run(
        `INSERT INTO moments_posts (id, content_md, content_html, images_data_urls, attachment_ids, tags, album_id, is_pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id, record.contentMd || '', record.contentHtml || '', JSON.stringify(images), JSON.stringify(attachmentIds), JSON.stringify(tags), albumOk ? record.albumId : '', record.isPinned ? 1 : 0,
          record.createdAt, record.updatedAt
        ]
      )
      if (attachmentIds.length > 0) restoreAttachments(attachmentIds)
    }

    // 从回收站移除
    writeBin(removeBin(readBin(), id))
  })

  // ---- 部分恢复（从知识目录快照中恢复单个页面/子目录） ----
  ipcMain.handle('recycleBin:restorePartial', (_e, binId: string, path: string) => {
    const rows = readBin()
    const item = findBin(rows, binId)
    if (!item) return
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
      const categoryType = normalizeCategoryType(c.categoryType)
      const parentId = resolveCategoryParent(categoryType, c.parentId)
      run(
        `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
         VALUES (?, ?, ?, ?, ?)`,
        [c.id, c.name, parentId, c.sortOrder || 0, categoryType]
      )
      // Remove category from snapshot; if nothing left, delete bin entry
      delete record.category
      const hasContent = (record.pages?.length > 0) || (record.children?.length > 0) || record.category
      if (!hasContent) {
        writeBin(removeBin(rows, binId))
      } else {
        item.data = JSON.stringify(record)
        writeBin(rows)
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
        const categoryType = normalizeCategoryType(c.categoryType)
        const parentId = resolveCategoryParent(categoryType, c.parentId)
        run(
          `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
           VALUES (?, ?, ?, ?, ?)`,
          [c.id, c.name, parentId, c.sortOrder || 0, categoryType]
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
              [cc.id, cc.name, parentId, cc.sortOrder || 0, cc.categoryType === 'notebook' || cc.categoryType === 'space' ? cc.categoryType : 'folder']
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
      writeBin(removeBin(rows, binId))
    } else {
      item.data = JSON.stringify(record)
      writeBin(rows)
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
    const rows = readBin()
    const item = findBin(rows, binId)
    if (!item) return
    if (item.module !== 'knowledge_category') return
    const record = JSON.parse(item.data)

    if (path === 'category') {
      delete record.category
    } else {
      spliceFromSnapshot(record, path)
    }

    const hasContent = (record.pages?.length > 0) || (record.children?.length > 0) || !!record.category
    if (!hasContent) {
      writeBin(removeBin(rows, binId))
    } else {
      item.data = JSON.stringify(record)
      writeBin(rows)
    }
  })

  // ---- 移入系统回收站（单条） ----
  ipcMain.handle('recycleBin:trashToOS', async (_e, id: string) => {
    const item = findBin(readBin(), id)
    if (!item) return
    const record = { module: item.module, title: item.title, data: JSON.parse(item.data) }
    await trashItem(id, record)
    writeBin(removeBin(readBin(), id))
  })

  // ---- 移入系统回收站（全部） ----
  ipcMain.handle('recycleBin:trashAllToOS', async () => {
    const rows = readBin()
    sortByDeletedAtDesc(rows)
    if (rows.length === 0) return
    const items = rows.map(r => ({ binId: r.id, module: r.module, title: r.title, data: JSON.parse(r.data) }))
    await trashAll(items)
    writeBin([])
  })

  // ---- 从快照中局部移入系统回收站 ----
  ipcMain.handle('recycleBin:trashPartialToOS', async (_e, binId: string, path: string) => {
    const rows = readBin()
    const item = findBin(rows, binId)
    if (!item) return
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
      writeBin(removeBin(rows, binId))
    } else {
      item.data = JSON.stringify(record)
      writeBin(rows)
    }
  })

  // ---- 永久删除单条（直接删库，不移入系统回收站） ----
  ipcMain.handle('recycleBin:permanentlyDelete', (_e, id: string) => {
    writeBin(removeBin(readBin(), id))
  })

  // ---- 清空回收站（移入系统回收站） ----
  ipcMain.handle('recycleBin:emptyAll', async () => {
    // 1) Snapshot items before deleting — so we can write them to disk
    const rows = readBin()
    sortByDeletedAtDesc(rows)
    const items = rows.map(r => ({ binId: r.id, module: r.module, title: r.title, data: JSON.parse(r.data) }))

    // 2) Clear bin immediately — the frontend sees instant feedback
    writeBin([])

    // 3) Write files + move to OS recycle bin in background (don't block the response)
    if (items.length > 0) {
      trashAll(items).catch(e => console.error('trashAll failed:', e))
    }
  })

  // ---- 清除过期项（独立调用） ----
  ipcMain.handle('recycleBin:purgeExpired', () => {
    purgeExpiredRows()
  })
}
