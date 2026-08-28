import type { Migration } from './types'

export const m004KnowledgeMigration: Migration = {
  name: '004_knowledge',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_categories (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        parent_id   TEXT REFERENCES knowledge_categories(id) ON DELETE SET NULL,
        sort_order  INTEGER DEFAULT 0,
        category_type TEXT NOT NULL DEFAULT 'folder',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS knowledge_pages (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        content_md  TEXT NOT NULL DEFAULT '',
        content_html TEXT DEFAULT '',
        category_id TEXT REFERENCES knowledge_categories(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_kpages_category ON knowledge_pages(category_id);
      CREATE INDEX IF NOT EXISTS idx_kpages_updated ON knowledge_pages(updated_at);
      CREATE INDEX IF NOT EXISTS idx_kcat_parent ON knowledge_categories(parent_id);
    `)
  },
}
