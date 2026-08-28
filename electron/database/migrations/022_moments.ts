import type { Migration } from './types'

export const m022MomentsMigration: Migration = {
  name: '022_moments',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS moments_posts (
        id          TEXT PRIMARY KEY,
        content_md  TEXT NOT NULL DEFAULT '',
        content_html TEXT DEFAULT '',
        image_data_url TEXT DEFAULT '',
        is_pinned   INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_moments_pinned ON moments_posts(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_moments_created ON moments_posts(created_at);
    `)
  },
}
