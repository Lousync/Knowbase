import type { Migration } from './types'

export const m023MomentsImageMigration: Migration = {
  name: '023_moments_image',
  up: (db) => {
    try { db.run("ALTER TABLE moments_posts ADD COLUMN image_data_url TEXT DEFAULT ''") } catch { /* column may already exist */ }
  },
}
