import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

interface MomentsRow {
  id: string
  content_md: string
  content_html: string | null
  image_data_url: string | null
  images_data_urls: string | null
  tags: string | null
  album_id: string | null
  is_pinned: number
  created_at: string
  updated_at: string
}

interface AlbumRow {
  id: string
  name: string
  cover_data_url: string | null
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

function rowToMoments(row: MomentsRow) {
  return {
    id: row.id,
    contentMd: row.content_md,
    contentHtml: row.content_html || '',
    imageDataUrls: parseImages(row),
    tags: parseTags(row),
    albumId: row.album_id || '',
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

  ipcMain.handle('moments:create', (_e, data: { contentMd?: string; contentHtml?: string; imageDataUrl?: string; imageDataUrls?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const images = Array.isArray(data.imageDataUrls) ? data.imageDataUrls : (data.imageDataUrl ? [data.imageDataUrl] : [])
    const tags = Array.isArray(data.tags) ? data.tags.filter(t => t.trim().length > 0) : []
    run(
      `INSERT INTO moments_posts (id, content_md, content_html, images_data_urls, tags, album_id, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.contentMd || '', data.contentHtml || '', JSON.stringify(images), JSON.stringify(tags), data.albumId || '', data.isPinned ? 1 : 0, now, now]
    )
    const rows = queryAll<MomentsRow>('SELECT * FROM moments_posts WHERE id = ?', [id])
    return rowToMoments(rows[0])
  })

  ipcMain.handle('moments:update', (_e, id: string, data: { contentMd?: string; contentHtml?: string; imageDataUrl?: string; imageDataUrls?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean }) => {
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [new Date().toISOString()]
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        if (k === 'imageDataUrls') {
          sets.push('images_data_urls = ?')
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
          sets.push(`${camelToSnake(k)} = ?`)
          params.push(k === 'isPinned' ? (v ? 1 : 0) : v)
        }
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

  // ===== 相册 =====
  ipcMain.handle('moments:getAlbums', () => {
    const albums = queryAll<AlbumRow>('SELECT * FROM moments_albums ORDER BY created_at DESC')
    const posts = queryAll<MomentsRow>("SELECT * FROM moments_posts WHERE album_id IS NOT NULL AND album_id != ''")
    return albums.map(a => {
      let cover = a.cover_data_url || ''
      let photoCount = 0
      for (const p of posts) {
        if (p.album_id !== a.id) continue
        const imgs = parseImages(p)
        photoCount += imgs.length
        if (!cover && imgs.length > 0) cover = imgs[0]
      }
      return { id: a.id, name: a.name, photoCount, cover, coverDataUrl: a.cover_data_url || '', createdAt: a.created_at, updatedAt: a.updated_at }
    })
  })

  ipcMain.handle('moments:createAlbum', (_e, name: string) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return null
    const id = randomUUID()
    const now = new Date().toISOString()
    run('INSERT INTO moments_albums (id, name, cover_data_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, trimmed, '', now, now])
    return { id, name: trimmed, photoCount: 0, cover: '', coverDataUrl: '', createdAt: now, updatedAt: now }
  })

  ipcMain.handle('moments:renameAlbum', (_e, id: string, name: string) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return null
    run('UPDATE moments_albums SET name = ?, updated_at = ? WHERE id = ?', [trimmed, new Date().toISOString(), id])
    const rows = queryAll<AlbumRow>('SELECT * FROM moments_albums WHERE id = ?', [id])
    if (rows.length === 0) return null
    return { id: rows[0].id, name: rows[0].name, photoCount: 0, cover: '', coverDataUrl: rows[0].cover_data_url || '', createdAt: rows[0].created_at, updatedAt: rows[0].updated_at }
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

  ipcMain.handle('moments:setAlbumCover', (_e, albumId: string, dataUrl: string) => {
    run('UPDATE moments_albums SET cover_data_url = ?, updated_at = ? WHERE id = ?', [dataUrl || '', new Date().toISOString(), albumId])
    const rows = queryAll<AlbumRow>('SELECT * FROM moments_albums WHERE id = ?', [albumId])
    if (rows.length === 0) return null
    return { id: rows[0].id, name: rows[0].name, photoCount: 0, cover: '', coverDataUrl: rows[0].cover_data_url || '', createdAt: rows[0].created_at, updatedAt: rows[0].updated_at }
  })
}
