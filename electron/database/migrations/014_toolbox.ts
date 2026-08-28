import type { Migration } from './types'

export const m014ToolboxMigration: Migration = {
  name: '014_toolbox',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS toolbox_scripts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        language    TEXT NOT NULL DEFAULT 'plaintext',
        sort_order  INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_toolbox_scripts_sort ON toolbox_scripts(sort_order);
    `)
  },
}
