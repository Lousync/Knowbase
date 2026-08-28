import type { Migration } from './types'
import { randomUUID } from 'crypto'

export const m036KnowledgeSpacesMigration: Migration = {
  name: '036_knowledge_spaces',
  up: (db) => {
    try {
      const spaceId = randomUUID()
      db.run(
        `INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type)
         VALUES (?, '默认空间', NULL, 0, 'space')`,
        [spaceId]
      )
      db.run(
        `UPDATE knowledge_categories
         SET parent_id = ?
         WHERE parent_id IS NULL AND category_type <> 'space'`,
        [spaceId]
      )
    } catch (e) {
      console.error('[migration 036] knowledge spaces backfill failed:', e)
    }
  },
}
