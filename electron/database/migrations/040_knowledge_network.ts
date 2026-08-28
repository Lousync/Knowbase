import type { Migration } from './types'

export const m040KnowledgeNetworkMigration: Migration = {
  name: '040_knowledge_network',
  up: (db) => {
    // 知识库网络化：全类型页面注解层 + 手动关联表（与自动解析的 wiki 链接分表）
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN annotation_md TEXT NOT NULL DEFAULT ''") } catch (_) { /* 列已存在 */ }
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_manual_links (
        id         TEXT PRIMARY KEY,
        page_id    TEXT NOT NULL,
        target_id  TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(page_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_kml_page ON knowledge_manual_links(page_id);
      CREATE INDEX IF NOT EXISTS idx_kml_target ON knowledge_manual_links(target_id);
    `)
  },
}
