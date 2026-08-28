import type { Migration } from './types'

export const m026MomentsTagsMigration: Migration = {
  name: '026_moments_tags',
  up: (db) => {
    // 说说标签：JSON 数组存放标签名
    try { db.run("ALTER TABLE moments_posts ADD COLUMN tags TEXT DEFAULT '[]'") } catch { /* column may already exist */ }
  },
}
