import type { Migration } from './types'

export const m007PageSortOrderMigration: Migration = {
  name: '007_page_sort_order',
  up: (db) => {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN sort_order INTEGER DEFAULT 0") } catch { /* column may exist */ }
  },
}
