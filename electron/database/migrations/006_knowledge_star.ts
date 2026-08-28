import type { Migration } from './types'

export const m006KnowledgeStarMigration: Migration = {
  name: '006_knowledge_star',
  up: (db) => {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN is_starred INTEGER DEFAULT 0") } catch { /* column may exist */ }
  },
}
