import type { Migration } from './types'

export const m031AttachmentsMigration: Migration = {
  name: '031_attachments',
  up: (db) => {
    // 统一附件子系统：所有模块的文件（说说图片/知识库附件/头像等）统一登记
    db.run(`
      CREATE TABLE IF NOT EXISTS attachments (
        id          TEXT PRIMARY KEY,
        owner_type  TEXT NOT NULL,
        owner_id    TEXT NOT NULL DEFAULT '',
        position    INTEGER DEFAULT 0,
        file_name   TEXT NOT NULL DEFAULT '',
        file_path   TEXT NOT NULL,
        thumb_path  TEXT DEFAULT '',
        mime_type   TEXT DEFAULT '',
        size_bytes  INTEGER DEFAULT 0,
        trashed     INTEGER DEFAULT 0,
        trash_path  TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_att_owner ON attachments(owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS idx_att_trashed ON attachments(trashed);
    `)
  },
}
