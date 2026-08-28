import type { Migration } from './types'

export const m013UserProfileMigration: Migration = {
  name: '013_user_profile',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id              TEXT PRIMARY KEY DEFAULT 'default',
        username        TEXT NOT NULL DEFAULT '',
        avatar_path     TEXT DEFAULT '',
        password_hash   TEXT DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.run("INSERT OR IGNORE INTO user_profile (id, username) VALUES ('default', '')")
  },
}
