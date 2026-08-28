import type { Migration } from './types'

export const m032MomentsAttachmentIdsMigration: Migration = {
  name: '032_moments_attachment_ids',
  up: (db) => {
    // 说说图片改为引用附件表（附件文件落盘，数据库只存元数据引用）
    try { db.run("ALTER TABLE moments_posts ADD COLUMN attachment_ids TEXT DEFAULT '[]'") } catch { /* column may already exist */ }
  },
}
