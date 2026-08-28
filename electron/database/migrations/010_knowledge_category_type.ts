import type { Migration } from './types'

export const m010KnowledgeCategoryTypeMigration: Migration = {
  name: '010_knowledge_category_type',
  up: (db) => {
    try { db.run("ALTER TABLE knowledge_categories ADD COLUMN category_type TEXT DEFAULT 'folder'") } catch { /* column may already exist */ }
  },
}
