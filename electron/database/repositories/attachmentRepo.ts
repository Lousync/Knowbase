import { ipcMain, app } from 'electron'
import { join, basename } from 'path'
import { mkdirSync, writeFileSync, copyFileSync, existsSync, unlinkSync, renameSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk, getAttachmentsDir } from '../connection'
import { safePathInside } from '../../lib/pathGuard'

interface AttachmentRow {
  id: string
  owner_type: string
  owner_id: string
  position: number
  file_name: string
  file_path: string
  thumb_path: string
  mime_type: string
  size_bytes: number
  trashed: number
  trash_path: string
  created_at: string
}

const EXT_MAP: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'application/json': 'json',
  'application/octet-stream': 'bin',
}

function extFor(mime: string, fallbackName: string): string {
  if (EXT_MAP[mime]) return '.' + EXT_MAP[mime]
  const m = /\.(\w+)$/.exec(fallbackName || '')
  return m ? '.' + m[1].toLowerCase() : '.bin'
}

function mimeFromPath(p: string): string {
  const ext = (p.match(/\.(\w+)$/)?.[1] || '').toLowerCase()
  const inv: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json' }
  return inv[ext] || 'application/octet-stream'
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

function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(sql, params)
  return rows.length > 0 ? rows[0] : null
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

function relFromAttachments(absPath: string): string {
  return absPath.replace(getAttachmentsDir() + '\\', '').replace(getAttachmentsDir() + '/', '')
}

function toMeta(r: AttachmentRow) {
  return {
    id: r.id,
    name: r.file_name,
    url: `attachment://${r.id}/`,
    thumbUrl: `attachment://${r.id}/?thumb=1`,
    mime: r.mime_type,
    size: r.size_bytes,
    position: r.position,
  }
}

export type AttachmentMeta = ReturnType<typeof toMeta>

/** 从 Markdown 正文中提取内联图片引用的附件 ID（attachment://{id}/ 或 ?thumb=1） */
export function parseInlineAttachmentIds(md: string): string[] {
  if (!md) return []
  const re = /attachment:\/\/([^/?#\s"'<>)]+)/g
  const ids: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    const id = m[1]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** 供 attachment:// 协议解析真实文件路径（路径防护:历史脏数据/恶意注入的 file_path 不会越出附件目录） */
export function getAttachmentFilePath(id: string, thumb = false): string | null {
  const row = queryOne<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id])
  if (!row) return null
  const p = safePathInside(getAttachmentsDir(), thumb && row.thumb_path ? row.thumb_path : row.file_path)
  return p && existsSync(p) ? p : null
}

/** 一次查询多个附件的元数据（供说说列表批量组装） */
export function getAttachmentsForIds(ids: string[]): ReturnType<typeof toMeta>[] {
  const list = ids.filter(Boolean)
  if (list.length === 0) return []
  const placeholders = list.map(() => '?').join(',')
  const rows = queryAll<AttachmentRow>(`SELECT * FROM attachments WHERE id IN (${placeholders})`, list)
  const map = new Map(rows.map(r => [r.id, toMeta(r)]))
  return list.map(id => map.get(id)).filter((x): x is ReturnType<typeof toMeta> => !!x)
}

/** 认领附件：上传时 owner_id 为空，创建业务记录后归属到具体对象 */
export function claimAttachments(ids: string[], ownerType: string, ownerId: string): void {
  ids.forEach((id, i) => {
    if (!id) return
    run('UPDATE attachments SET owner_type = ?, owner_id = ?, position = ? WHERE id = ?', [ownerType, ownerId, i, id])
  })
}

/** 删除业务记录时，附件文件移入回收区（可恢复） */
export function trashAttachments(ids: string[], binId: string): void {
  const trashRoot = join(app.getPath('userData'), 'attachments_trash', binId)
  mkdirSync(trashRoot, { recursive: true })
  for (const id of ids) {
    if (!id) continue
    const row = queryOne<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id])
    if (!row || row.trashed) continue
    const src = safePathInside(getAttachmentsDir(), row.file_path)
    if (!src) continue
    const dest = join(trashRoot, basename(row.file_path))
    try {
      if (existsSync(src)) renameSync(src, dest)
    } catch {
      try { if (existsSync(src)) { copyFileSync(src, dest); unlinkSync(src) } } catch { /* keep */ }
    }
    let relThumb = ''
    if (row.thumb_path) {
      const tsrc = safePathInside(getAttachmentsDir(), row.thumb_path)
      const tdest = join(trashRoot, basename(row.thumb_path))
      if (tsrc) try {
        if (existsSync(tsrc)) renameSync(tsrc, tdest)
      } catch {
        try { if (existsSync(tsrc)) { copyFileSync(tsrc, tdest); unlinkSync(tsrc) } } catch { /* keep */ }
      }
      relThumb = join('attachments_trash', binId, basename(row.thumb_path))
    }
    run('UPDATE attachments SET trashed = 1, trash_path = ? WHERE id = ?', [join('attachments_trash', binId, basename(row.file_path)), id])
  }
}

/** 从回收区恢复附件文件 */
export function restoreAttachments(ids: string[]): void {
  for (const id of ids) {
    if (!id) continue
    const row = queryOne<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id])
    if (!row || !row.trashed || !row.trash_path) continue
    // 路径防护:trash_path / file_path 均来自数据库,越出预期目录的脏数据直接跳过
    const src = safePathInside(app.getPath('userData'), row.trash_path)
    const dest = safePathInside(getAttachmentsDir(), row.file_path)
    if (!src || !dest) continue
    try {
      if (existsSync(dest)) unlinkSync(dest)
      if (existsSync(src)) renameSync(src, dest)
    } catch {
      try { if (existsSync(src)) { copyFileSync(src, dest); unlinkSync(src) } } catch { /* keep */ }
    }
    run('UPDATE attachments SET trashed = 0, trash_path = ? WHERE id = ?', ['', id])
  }
}

/** 彻底删除附件（文件 + 记录） */
export function deleteAttachments(ids: string[]): void {
  for (const id of ids) {
    if (!id) continue
    const row = queryOne<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id])
    if (!row) continue
    for (const p of [row.file_path, row.thumb_path]) {
      if (!p) continue
      const full = safePathInside(getAttachmentsDir(), p)
      try { if (full && existsSync(full)) unlinkSync(full) } catch { /* ignore */ }
    }
    if (row.trashed && row.trash_path) {
      const trashFull = safePathInside(app.getPath('userData'), row.trash_path)
      try { if (trashFull && existsSync(trashFull)) unlinkSync(trashFull) } catch { /* ignore */ }
    }
    run('DELETE FROM attachments WHERE id = ?', [id])
  }
}

/** 注册一条已有文件的附件记录（文件已由调用方落盘） */
export function registerAttachment(data: {
  ownerType: string
  ownerId: string
  position?: number
  fileName: string
  relPath: string
  mime?: string
  size?: number
}): string {
  const id = randomUUID()
  run(
    `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.ownerType, data.ownerId, data.position || 0, data.fileName, data.relPath, data.mime || 'application/octet-stream', data.size || 0, new Date().toISOString()]
  )
  return id
}

export function registerAttachmentHandlers(): void {
  // 通道 B：渲染进程传字节（前端选择/拖拽，先预览再上传）
  ipcMain.handle('attachment:uploadMany', (_e, data: {
    ownerType?: string
    ownerId?: string
    files: { name?: string; mime?: string; dataUrl?: string; base64?: string; thumbDataUrl?: string }[]
  }) => {
    const ownerType = data.ownerType || 'misc'
    const ownerId = data.ownerId || '_pending'
    // 白名单校验:两者会拼进落盘路径,含路径分隔符/点号可越出附件目录
    if (!/^[A-Za-z0-9_-]+$/.test(ownerType) || !/^[A-Za-z0-9_-]+$/.test(ownerId)) return []
    const now = new Date().toISOString()
    const out: ReturnType<typeof toMeta>[] = []
    for (const f of data.files || []) {
      const id = randomUUID()
      const raw = f.dataUrl || ''
      const mime = f.mime || (/^data:([^;]+)/.exec(raw)?.[1] || 'application/octet-stream')
      const ext = extFor(mime, f.name || 'file')
      const dir = join(getAttachmentsDir(), ownerType, ownerId)
      mkdirSync(dir, { recursive: true })
      const rel = join(ownerType, ownerId, `${id}${ext}`)
      const buf = raw.includes(',') ? Buffer.from(raw.split(',')[1] || '', 'base64') : Buffer.from(f.base64 || '', 'base64')
      writeFileSync(join(getAttachmentsDir(), rel), buf)

      let relThumb = ''
      if (f.thumbDataUrl && f.thumbDataUrl.includes(',')) {
        const tdir = join(dir, 'thumbs')
        mkdirSync(tdir, { recursive: true })
        relThumb = join(ownerType, ownerId, 'thumbs', `${id}.jpg`)
        writeFileSync(join(getAttachmentsDir(), relThumb), Buffer.from(f.thumbDataUrl.split(',')[1] || '', 'base64'))
      }

      run(
        `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, thumb_path, mime_type, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ownerType, ownerId, out.length, f.name || 'file', rel, relThumb, mime, buf.length, now]
      )
      const row = queryOne<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id])!
      out.push(toMeta(row))
    }
    return out
  })

  // 通道 A：主进程直接复制本地文件（批量导入/知识库附件）
  ipcMain.handle('attachment:uploadFromPath', (_e, data: { ownerType?: string; ownerId?: string; filePath: string }) => {
    if (!data.filePath || !existsSync(data.filePath)) return null
    const ownerType = data.ownerType || 'misc'
    const ownerId = data.ownerId || '_pending'
    // 白名单校验:两者会拼进落盘路径(同 uploadMany)
    if (!/^[A-Za-z0-9_-]+$/.test(ownerType) || !/^[A-Za-z0-9_-]+$/.test(ownerId)) return null
    const id = randomUUID()
    const name = basename(data.filePath)
    const ext = extFor(mimeFromPath(data.filePath), name)
    const dir = join(getAttachmentsDir(), ownerType, ownerId)
    mkdirSync(dir, { recursive: true })
    const rel = join(ownerType, ownerId, `${id}${ext}`)
    copyFileSync(data.filePath, join(getAttachmentsDir(), rel))
    const size = existsSync(data.filePath) ? (readFileSync(data.filePath).length) : 0
    run(
      `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [id, ownerType, ownerId, name, rel, mimeFromPath(data.filePath), size, new Date().toISOString()]
    )
    const row = queryOne<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id])!
    return toMeta(row)
  })

  ipcMain.handle('attachment:getByOwner', (_e, ownerType: string, ownerId: string) => {
    const rows = queryAll<AttachmentRow>('SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY position ASC', [ownerType, ownerId])
    return rows.map(toMeta)
  })

  ipcMain.handle('attachment:delete', (_e, id: string) => {
    deleteAttachments([id])
  })

  ipcMain.handle('attachment:getPath', (_e, id: string) => {
    return getAttachmentFilePath(id)
  })

  // 读取附件文件内容为 base64（PDF 阅读器用）
  ipcMain.handle('attachment:readBase64', (_e, id: string) => {
    const p = getAttachmentFilePath(id)
    if (!p) return null
    try {
      return readFileSync(p).toString('base64')
    } catch (e) {
      console.error('[attachment:readBase64] failed:', e)
      return null
    }
  })

  // 按附件目录内的文件名读取 base64（兼容旧版无 attachment_id 的附件）
  ipcMain.handle('attachment:readBase64ByFileName', (_e, fileName: string) => {
    if (!fileName || /[\\/]/.test(fileName)) return null  // 只允许附件目录内相对文件名
    const p = join(getAttachmentsDir(), fileName)
    if (!existsSync(p)) return null
    try {
      return readFileSync(p).toString('base64')
    } catch (e) {
      console.error('[attachment:readBase64ByFileName] failed:', e)
      return null
    }
  })

  ipcMain.handle('attachment:cleanupOrphans', () => {
    let removed = 0
    // 1) 超过 24 小时的未认领上传（owner_id = _pending）
    const pending = queryAll<AttachmentRow>("SELECT * FROM attachments WHERE owner_id = '_pending'")
    for (const r of pending) {
      const age = Date.now() - new Date(r.created_at).getTime()
      if (age > 24 * 3600 * 1000) {
        deleteAttachments([r.id])
        removed++
      }
    }
    // 2) 归属对象已不存在的附件（说说 / 知识页面；头像等固定归属跳过）
    const momentsIds = new Set(queryAll<{ id: string }>('SELECT id FROM moments_posts').map(r => r.id))
    const pageIds = new Set(queryAll<{ id: string }>('SELECT id FROM knowledge_pages').map(r => r.id))
    const entryIds = new Set(queryAll<{ id: string }>('SELECT id FROM entries').map(r => r.id))
    const rows = queryAll<AttachmentRow>("SELECT * FROM attachments WHERE owner_id != '_pending'")
    for (const r of rows) {
      let exists = true
      if (r.owner_type === 'moments_post') exists = momentsIds.has(r.owner_id)
      else if (r.owner_type === 'knowledge_page') exists = pageIds.has(r.owner_id)
      else if (r.owner_type === 'blog_entry') exists = entryIds.has(r.owner_id)
      if (!exists) {
        deleteAttachments([r.id])
        removed++
      }
    }
    return { removed }
  })
}
