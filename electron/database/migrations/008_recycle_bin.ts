import type { Migration } from './types'

export const m008RecycleBinMigration: Migration = {
  name: '008_recycle_bin',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS recycle_bin (
        id          TEXT PRIMARY KEY,
        original_id TEXT NOT NULL,
        module      TEXT NOT NULL,
        title       TEXT NOT NULL,
        data        TEXT NOT NULL,
        deleted_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rb_module ON recycle_bin(module);
      CREATE INDEX IF NOT EXISTS idx_rb_deleted ON recycle_bin(deleted_at);
    `)
  },
}
