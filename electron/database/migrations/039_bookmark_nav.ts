import type { Migration } from './types'

export const m039BookmarkNavMigration: Migration = {
  name: '039_bookmark_nav',
  up: (db) => {
    // 网址导航工具：分类 + 书签（category_id = '' 表示未分类）
    db.run(`
      CREATE TABLE IF NOT EXISTS bookmark_categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        color      TEXT NOT NULL DEFAULT '#3B82F6',
        sort_order REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        id          TEXT PRIMARY KEY,
        category_id TEXT NOT NULL DEFAULT '',
        title       TEXT NOT NULL,
        url         TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        sort_order  REAL NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_cat ON bookmarks(category_id);
    `)
  },
}
