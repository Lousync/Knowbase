import type { Migration } from './types'

export const m017KnowledgeCategoryDatesMigration: Migration = {
  name: '017_knowledge_category_dates',
  up: (db) => {
    // Check which columns exist before attempting ALTER (prevents silent failures)
    let hasCreatedAt = false
    let hasUpdatedAt = false
    try {
      const info = db.exec("PRAGMA table_info('knowledge_categories')")
      if (info[0]) {
        hasCreatedAt = info[0].values.some((row: any[]) => row[1] === 'created_at')
        hasUpdatedAt = info[0].values.some((row: any[]) => row[1] === 'updated_at')
      }
    } catch (_) { /* PRAGMA failed — table might not exist yet */ }
    if (!hasCreatedAt) {
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
    }
    if (!hasUpdatedAt) {
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
    }
  },
}
