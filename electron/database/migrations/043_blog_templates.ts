import type { Migration } from './types'

export const m043BlogTemplatesMigration: Migration = {
  name: '043_blog_templates',
  up: (db) => {
    // 博客模板：用户自编辑的日记模板，写博客时可一键套用
    db.run(`
      CREATE TABLE IF NOT EXISTS blog_templates (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        content_md TEXT NOT NULL DEFAULT '',
        sort_order REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `)
  },
}
