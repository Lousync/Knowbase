import type { Migration } from './types'

export const m001InitMigration: Migration = {
  name: '001_init',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        content_md  TEXT NOT NULL DEFAULT '',
        content_html TEXT DEFAULT '',
        date        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        is_pinned   INTEGER DEFAULT 0,
        word_count  INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6b7280'
      );

      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
      CREATE INDEX IF NOT EXISTS idx_entries_pinned ON entries(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
    `)
  },
}
