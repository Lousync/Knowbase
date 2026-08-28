import type { Migration } from './types'

export const m016BlogStarMigration: Migration = {
  name: '016_blog_star',
  up: (db) => {
    // Add is_starred column to blog entries for favorites support
    try {
      db.run('ALTER TABLE entries ADD COLUMN is_starred INTEGER DEFAULT 0')
    } catch (_) { /* column may already exist */ }
  },
}
