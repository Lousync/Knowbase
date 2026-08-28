import type { Migration } from './types'

export const m027MomentsAlbumsMigration: Migration = {
  name: '027_moments_albums',
  up: (db) => {
    // 说说相册：独立相册表 + 说说归属相册
    db.run(`
      CREATE TABLE IF NOT EXISTS moments_albums (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    try { db.run("ALTER TABLE moments_posts ADD COLUMN album_id TEXT DEFAULT ''") } catch { /* column may already exist */ }
  },
}
