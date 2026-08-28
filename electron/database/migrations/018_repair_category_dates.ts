import type { Migration } from './types'

// Repair: if 017 was marked applied but columns are still missing (e.g. ALTER TABLE silently failed)
export const m018RepairCategoryDatesMigration: Migration = {
  name: '018_repair_category_dates',

  shouldRun: (applied) => applied.has('017_knowledge_category_dates') && !applied.has('018_repair_category_dates'),
  up: (db) => {
    let needsRepair = false
    try {
      const info = db.exec("PRAGMA table_info('knowledge_categories')")
      if (info[0]) {
        const hasCreatedAt = info[0].values.some((row: any[]) => row[1] === 'created_at')
        const hasUpdatedAt = info[0].values.some((row: any[]) => row[1] === 'updated_at')
        if (!hasCreatedAt || !hasUpdatedAt) needsRepair = true
      }
    } catch (_) { }
    if (needsRepair) {
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
    }
  },
}
