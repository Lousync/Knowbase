import type { Migration } from './types'

export const m020PasswordVaultMigration: Migration = {
  name: '020_password_vault',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS toolbox_passwords (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        url         TEXT DEFAULT '',
        username    TEXT DEFAULT '',
        password    TEXT NOT NULL DEFAULT '',
        notes       TEXT DEFAULT '',
        sort_order  INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
  },
}
