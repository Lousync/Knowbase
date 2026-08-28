import type { Migration } from './types'
import { randomUUID } from 'crypto'
import { getAttachmentsDir } from '../paths'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export const m033BackfillMomentsAttachmentsMigration: Migration = {
  name: '033_backfill_moments_attachments',
  up: (db) => {
    // 一次性迁移：把历史 base64 图片解码落盘，登记到 attachments 表
    try {
      const rows = db.exec("SELECT id, images_data_urls FROM moments_posts WHERE images_data_urls IS NOT NULL AND images_data_urls != ''")
      if (rows.length > 0 && rows[0].values) {
        for (const r of rows[0].values) {
          const postId = r[0] as string
          let urls: string[] = []
          try { urls = JSON.parse(r[1] as string) } catch { urls = [] }
          if (!Array.isArray(urls) || urls.length === 0) continue
          const ids: string[] = []
          for (let i = 0; i < urls.length; i++) {
            const dataUrl = urls[i]
            if (typeof dataUrl !== 'string' || !dataUrl.includes(',')) continue
            const [head, b64] = dataUrl.split(',')
            const mime = /^data:([^;]+)/.exec(head)?.[1] || 'image/png'
            const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : mime === 'image/bmp' ? 'bmp' : 'png'
            const id = randomUUID()
            const relDir = join('moments', postId)
            const dir = join(getAttachmentsDir(), relDir)
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            const rel = join(relDir, `${id}.${ext}`)
            writeFileSync(join(getAttachmentsDir(), rel), Buffer.from(b64, 'base64'))
            db.run(
              `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
               VALUES (?, 'moments_post', ?, ?, ?, ?, ?, ?, ?)`,
              [id, postId, i, `photo-${i + 1}.${ext}`, rel, mime, Buffer.byteLength(b64, 'base64'), new Date().toISOString()]
            )
            ids.push(id)
          }
          if (ids.length > 0) {
            db.run('UPDATE moments_posts SET attachment_ids = ? WHERE id = ?', [JSON.stringify(ids), postId])
          }
        }
      }
    } catch (e) {
      console.error('[migration 033] backfill failed:', e)
    }
  },
}
