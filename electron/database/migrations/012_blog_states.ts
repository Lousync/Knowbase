import type { Migration } from './types'

export const m012BlogStatesMigration: Migration = {
  name: '012_blog_states',
  up: (db) => {
    try { db.run("ALTER TABLE entries ADD COLUMN states TEXT DEFAULT ''") } catch { /* column may already exist */ }
  },
}
