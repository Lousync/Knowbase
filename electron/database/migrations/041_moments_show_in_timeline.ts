import type { Migration } from './types'

export const m041MomentsShowInTimelineMigration: Migration = {
  name: '041_moments_show_in_timeline',
  up: (db) => {
    // 说说时间线可见性：0 = 仅归档到相册，不在时间线显示
    // 幂等保护:列已存在(历史中断残留)时跳过 ALTER,仅补记标记
    try {
      db.run("ALTER TABLE moments_posts ADD COLUMN show_in_timeline INTEGER NOT NULL DEFAULT 1")
    } catch (err) {
      const msg = String((err as Error)?.message || err)
      if (!/duplicate column/i.test(msg)) throw err
    }
  },
}
