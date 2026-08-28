import type { Migration } from './types'
import { randomUUID } from 'crypto'
import { getAttachmentsDir } from '../paths'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export const m034KnowledgeAttachmentIdMigration: Migration = {
  name: '034_knowledge_attachment_id',
  up: (db) => {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN attachment_id TEXT DEFAULT ''") } catch { /* column may already exist */ }
    // 回填：把已落盘的知识库附件（PDF/XMind 等）登记进附件表
    try {
      const rows = db.exec("SELECT id, title, content_md, file_type FROM knowledge_pages")
      if (rows.length > 0 && rows[0].values) {
        for (const r of rows[0].values) {
          const pageId = r[0] as string
          const title = (r[1] as string) || ''
          const contentMd = (r[2] as string) || ''
          const fileType = (r[3] as string) || ''
          if (!fileType || fileType === 'md' || fileType === 'txt') continue
          // content_md 作为附件文件名使用（flat 目录，位于 attachments/ 下）
          const src = join(getAttachmentsDir(), contentMd)
          if (!existsSync(src)) continue
          const ext = fileType.replace(/^\./, '')
          const mime = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'
          const id = randomUUID()
          db.run(
            `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
             VALUES (?, 'knowledge_page', ?, 0, ?, ?, ?, ?, ?)`,
            [id, pageId, title || contentMd, contentMd, mime, existsSync(src) ? readFileSync(src).length : 0, new Date().toISOString()]
          )
          db.run('UPDATE knowledge_pages SET attachment_id = ? WHERE id = ?', [id, pageId])
        }
      }
    } catch (e) {
      console.error('[migration 034] backfill failed:', e)
    }
  },
}
