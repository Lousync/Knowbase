import type { Migration } from './types'

export const m047KnowledgePackImportsMigration: Migration = {
  name: '047_knowledge_pack_imports',
  up: (db) => {
    // 内容型插件(knowledgePages)导入映射:external_id 幂等键 + 内容哈希(更新检测)
    // （原分支迁移号 045 与 mcp_servers 冲突，合并时改号为 047）
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_pack_imports (
        plugin_id    TEXT NOT NULL,
        external_id  TEXT NOT NULL,
        page_id      TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        pack_version TEXT NOT NULL DEFAULT '',
        space_id     TEXT,
        imported_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        PRIMARY KEY (plugin_id, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_kp_imports_plugin ON knowledge_pack_imports(plugin_id);
    `)
  },
}
