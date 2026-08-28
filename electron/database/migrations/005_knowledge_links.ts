import type { Migration } from './types'

export const m005KnowledgeLinksMigration: Migration = {
  name: '005_knowledge_links',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_links (
        id              TEXT PRIMARY KEY,
        source_page_id  TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
        target_page_id  TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
        UNIQUE(source_page_id, target_page_id)
      );

      CREATE INDEX IF NOT EXISTS idx_klinks_source ON knowledge_links(source_page_id);
      CREATE INDEX IF NOT EXISTS idx_klinks_target ON knowledge_links(target_page_id);

      CREATE TABLE IF NOT EXISTS knowledge_tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6b7280'
      );

      CREATE TABLE IF NOT EXISTS knowledge_page_tags (
        page_id TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
        tag_id  TEXT NOT NULL REFERENCES knowledge_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (page_id, tag_id)
      );
    `)
  },
}
