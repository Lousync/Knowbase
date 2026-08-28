import type { Migration } from './types'
import { randomUUID } from 'crypto'
import { getAttachmentsDir } from '../paths'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'fs'
import { join, basename } from 'path'

export const m035AvatarAttachmentMigration: Migration = {
  name: '035_avatar_attachment',
  up: (db) => {
    // 头像迁入统一附件体系：文件移到 attachments/user_profile/default/，登记附件表
    try {
      const rows = db.exec("SELECT avatar_path FROM user_profile WHERE id = 'default' AND avatar_path IS NOT NULL AND avatar_path != ''")
      if (rows.length > 0 && rows[0].values) {
        for (const row of rows[0].values) {
          const oldRel = row[0] as string
          const src = join(app.getPath('userData'), oldRel)
          if (!existsSync(src)) continue
          const ext = /\.(\w+)$/.exec(oldRel)?.[1] || 'png'
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
          const id = randomUUID()
          const dir = join(getAttachmentsDir(), 'user_profile', 'default')
          mkdirSync(dir, { recursive: true })
          const rel = join('user_profile', 'default', `avatar_${id}.${ext}`)
          copyFileSync(src, join(getAttachmentsDir(), rel))
          db.run("UPDATE user_profile SET avatar_path = ? WHERE id = 'default'", [join('attachments', rel)])
          db.run(
            `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
             VALUES (?, 'user_profile', 'default', 0, ?, ?, ?, ?, ?)`,
            [id, basename(oldRel), rel, mime, existsSync(src) ? readFileSync(src).length : 0, new Date().toISOString()]
          )
        }
      }
    } catch (e) {
      console.error('[migration 035] avatar backfill failed:', e)
    }
  },
}
