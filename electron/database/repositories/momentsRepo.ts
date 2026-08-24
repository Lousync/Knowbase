import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { getAttachmentsForIds, claimAttachments, trashAttachments, deleteAttachments, AttachmentMeta } from './attachmentRepo'

interface MomentsRow {
  id: string
  content_md: string
  content_html: string | null
  image_data_url: string | null
  images_data_urls: string | null
  tags: string | null
  album_id: string | null
  attachment_ids: string | null
  is_pinned: number
  show_in_timeline: number | null
  created_at: string
  updated_at: string
}

interface AlbumRow {
  id: string
  name: string
  cover_data_url: string | null
  cover_post_id: string | null
  cover_index: number | null
  created_at: string
  updated_at: string
}

function parseImages(row: MomentsRow): string[] {
  if (row.images_data_urls) {
    try {
      const arr = JSON.parse(row.images_data_urls)
      if (Array.isArray(arr)) return arr.filter((v): v is string => typeof v === 'string' && v.length > 0)
    } catch { /* fall through */ }
  }
  if (row.image_data_url) return [row.image_data_url]
  return []
}

function parseTags(row: MomentsRow): string[] {
  if (row.tags) {
    try {
      const arr = JSON.parse(row.tags)
      if (Array.isArray(arr)) return arr.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    } catch { /* fall through */ }
  }
  return []
}

function parseAttachmentIds(row: MomentsRow): string[] {
  if (row.attachment_ids) {
    try {
      const arr = JSON.parse(row.attachment_ids)
      if (Array.isArray(arr)) return arr.filter((v): v is string => typeof v === 'string' && v.length > 0)
    } catch { /* fall through */ }
  }
  return []
}

function rowToMoments(row: MomentsRow, attachmentMeta: AttachmentMeta[] = []) {
  const attachmentIds = parseAttachmentIds(row)
  const attachments = attachmentIds
    .map(id => attachmentMeta.find(a => a.id === id))
    .filter((a): a is AttachmentMeta => !!a)
  return {
    id: row.id,
    contentMd: row.content_md,
    contentHtml: row.content_html || '',
    // 老数据兼容：没有附件记录时回退旧 base64 字段
    imageDataUrls: attachmentIds.length === 0 ? parseImages(row) : [],
    attachmentIds,
    attachments,
    tags: parseTags(row),
    albumId: row.album_id || '',
    isPinned: row.is_pinned === 1,
    showInTimeline: row.show_in_timeline !== 0,
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
    const allIds = rows.flatMap(r => parseAttachmentIds(r))
    const meta = getAttachmentsForIds(allIds)
    return rows.map(r => rowToMoments(r, meta))
  })

  ipcMain.handle('moments:getById', (_e, id: string) => {
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    if (rows.length === 0) return null
    const meta = getAttachmentsForIds(parseAttachmentIds(rows[0]))
    return rowToMoments(rows[0], meta)
  })

  ipcMain.handle('moments:create', (_e, data: { contentMd?: string; contentHtml?: string; imageDataUrl?: string; imageDataUrls?: string[]; attachmentIds?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean; showInTimeline?: boolean }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const images = Array.isArray(data.imageDataUrls) ? data.imageDataUrls : (data.imageDataUrl ? [data.imageDataUrl] : [])
    const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds : []
    const tags = Array.isArray(data.tags) ? data.tags.filter(t => t.trim().length > 0) : []
    run(
      `INSERT INTO moments_posts (id, content_md, content_html, images_data_urls, attachment_ids, tags, album_id, is_pinned, show_in_timeline, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.contentMd || '', data.contentHtml || '', JSON.stringify(images), JSON.stringify(attachmentIds), JSON.stringify(tags), data.albumId || '', data.isPinned ? 1 : 0, data.showInTimeline === false ? 0 : 1, now, now]
    )
    if (attachmentIds.length > 0) claimAttachments(attachmentIds, 'moments_post', id)
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    return rowToMoments(rows[0], getAttachmentsForIds(attachmentIds))
  })

  ipcMain.handle('moments:update', (_e, id: string, data: { contentMd?: string; contentHtml?: string; imageDataUrl?: string; imageDataUrls?: string[]; attachmentIds?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean; showInTimeline?: boolean }) => {
    const prevRows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    if (prevRows.length === 0) return null
    const prevIds = parseAttachmentIds(prevRows[0])
    if (Array.isArray(data.attachmentIds)) {
      const newIds = data.attachmentIds
      const added = newIds.filter(x => !prevIds.includes(x))
      const removed = prevIds.filter(x => !newIds.includes(x))
      if (added.length > 0) claimAttachments(added, 'moments_post', id)
      if (removed.length > 0) deleteAttachments(removed)
    }
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [new Date().toISOString()]
    const allow = new Set(['is_pinned', 'show_in_timeline', 'content_md', 'content_html', 'album_id'])
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        if (k === 'imageDataUrls') {
          sets.push('images_data_urls = ?')
          params.push(JSON.stringify(v))
        } else if (k === 'attachmentIds') {
          sets.push('attachment_ids = ?')
          params.push(JSON.stringify(v))
        } else if (k === 'imageDataUrl') {
          sets.push('images_data_urls = ?')
          params.push(JSON.stringify(v ? [v] : []))
        } else if (k === 'tags') {
          sets.push('tags = ?')
          params.push(JSON.stringify((v as string[]).filter(t => t.trim().length > 0)))
        } else if (k === 'albumId') {
          sets.push('album_id = ?')
          params.push(v || '')
        } else {
          // 列名白名单:其余 key 仅允许固定集合(防注入)
          const col = camelToSnake(k)
          if (!allow.has(col)) continue
          sets.push(`${col} = ?`)
          params.push(k === 'isPinned' || k === 'showInTimeline' ? (v ? 1 : 0) : v)
        }
      }
    }
    params.push(id)
    run(`UPDATE moments_posts SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    const finalIds = parseAttachmentIds(rows[0])
    return rowToMoments(rows[0], getAttachmentsForIds(finalIds))
  })

  ipcMain.handle('moments:togglePin', (_e, id: string) => {
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    if (rows.length === 0) return null
    const next = rows[0].is_pinned === 1 ? 0 : 1
    run('UPDATE moments_posts SET is_pinned = ?, updated_at = ? WHERE id = ?', [next, new Date().toISOString(), id])
    const updated = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    return rowToMoments(updated[0], getAttachmentsForIds(parseAttachmentIds(updated[0])))
  })

  ipcMain.handle('moments:delete', (_e, id: string) => {
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    if (rows.length === 0) return
    const attachmentIds = parseAttachmentIds(rows[0])
    const row = rowToMoments(rows[0], getAttachmentsForIds(attachmentIds))
    const binId = randomUUID()
    if (attachmentIds.length > 0) trashAttachments(attachmentIds, binId)
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [binId, id, 'moments', '单机说说', JSON.stringify(row), new Date().toISOString()]
    )
    run('DELETE FROM moments_posts WHERE id = ?', [id])
  })

  // ===== 相册 =====
  ipcMain.handle('moments:getAlbums', () => {
    const albums = queryAll<AlbumRow>('SELECT * FROM moments_albums ORDER BY created_at DESC')
    const posts = queryAll<MomentsRow>("SELECT * FROM moments_posts WHERE album_id IS NOT NULL AND album_id != ''")
    const metaMap = new Map<string, AttachmentMeta[]>()
    for (const p of posts) {
      metaMap.set(p.id, getAttachmentsForIds(parseAttachmentIds(p)))
    }
    return albums.map(a => {
      // 封面优先取引用的照片（post + 序号），照片始终属于相册
      let cover = ''
      const refPost = a.cover_post_id ? posts.find(p => p.id === a.cover_post_id) : null
      if (refPost) {
        const refMetas = metaMap.get(refPost.id) || []
        const refIdx = a.cover_index || 0
        if (refMetas[refIdx]) cover = refMetas[refIdx].url
        else if (refMetas.length === 0) {
          const legacy = parseImages(refPost)
          if (legacy[refIdx]) cover = legacy[refIdx]
        }
      }
      let photoCount = 0
      for (const p of posts) {
        if (p.album_id !== a.id) continue
        const metas = metaMap.get(p.id) || []
        photoCount += metas.length || parseImages(p).length
        if (!cover) {
          if (metas.length > 0) cover = metas[0].url
          else {
            const legacy = parseImages(p)
            if (legacy.length > 0) cover = legacy[0]
          }
        }
      }
      return {
        id: a.id,
        name: a.name,
        photoCount,
        cover,
        coverPostId: a.cover_post_id || '',
        coverIndex: a.cover_index || 0,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      }
    })
  })

  ipcMain.handle('moments:createAlbum', (_e, name: string) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return null
    const id = randomUUID()
    const now = new Date().toISOString()
    run('INSERT INTO moments_albums (id, name, cover_data_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, trimmed, '', now, now])
    return { id, name: trimmed, photoCount: 0, cover: '', coverPostId: '', coverIndex: 0, createdAt: now, updatedAt: now }
  })

  ipcMain.handle('moments:renameAlbum', (_e, id: string, name: string) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return null
    run('UPDATE moments_albums SET name = ?, updated_at = ? WHERE id = ?', [trimmed, new Date().toISOString(), id])
    const rows = queryAll<AlbumRow>('SELECT * FROM moments_albums WHERE id = ?', [id])
    if (rows.length === 0) return null
    return { id: rows[0].id, name: rows[0].name, photoCount: 0, cover: '', coverPostId: rows[0].cover_post_id || '', coverIndex: rows[0].cover_index || 0, createdAt: rows[0].created_at, updatedAt: rows[0].updated_at }
  })

  ipcMain.handle('moments:deleteAlbum', (_e, id: string) => {
    run("UPDATE moments_posts SET album_id = '' WHERE album_id = ?", [id])
    run('DELETE FROM moments_albums WHERE id = ?', [id])
  })

  ipcMain.handle('moments:setPostAlbum', (_e, postId: string, albumId: string) => {
    run('UPDATE moments_posts SET album_id = ?, updated_at = ? WHERE id = ?', [albumId || '', new Date().toISOString(), postId])
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [postId])
    return rows.length > 0 ? rowToMoments(rows[0]) : null
  })

  ipcMain.handle('moments:setAlbumCover', (_e, albumId: string, postId: string, index: number) => {
    run('UPDATE moments_albums SET cover_post_id = ?, cover_index = ?, updated_at = ? WHERE id = ?', [postId || '', index || 0, new Date().toISOString(), albumId])
    const rows = queryAll<AlbumRow>('SELECT * FROM moments_albums WHERE id = ?', [albumId])
    if (rows.length === 0) return null
    return { id: rows[0].id, name: rows[0].name, photoCount: 0, cover: '', coverPostId: rows[0].cover_post_id || '', coverIndex: rows[0].cover_index || 0, createdAt: rows[0].created_at, updatedAt: rows[0].updated_at }
  })
}
