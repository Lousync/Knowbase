import type { Migration } from './types'

export const m011KnowledgeFileTypeMigration: Migration = {
  name: '011_knowledge_file_type',
  up: (db) => {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN file_type TEXT DEFAULT ''") } catch { /* column may already exist */ }
  },
}
