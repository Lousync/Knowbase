import type { Migration } from './types'

export const m021PasswordAccountMigration: Migration = {
  name: '021_password_account',
  up: (db) => {
    try { db.run("ALTER TABLE toolbox_passwords ADD COLUMN account TEXT DEFAULT ''") } catch (_) { /* column may exist */ }
  },
}
