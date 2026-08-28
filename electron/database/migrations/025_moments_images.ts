import type { Migration } from './types'

export const m025MomentsImagesMigration: Migration = {
  name: '025_moments_images',
  up: (db) => {
    // 说说多图支持：JSON 数组存放所有图片 data URL，并把旧单图数据回填进去
    try { db.run("ALTER TABLE moments_posts ADD COLUMN images_data_urls TEXT DEFAULT '[]'") } catch { /* column may already exist */ }
    try {
      const old = db.exec("SELECT id, image_data_url FROM moments_posts WHERE image_data_url IS NOT NULL AND image_data_url != ''")
      if (old.length > 0 && old[0].values) {
        for (const row of old[0].values) {
          db.run('UPDATE moments_posts SET images_data_urls = ? WHERE id = ?', [JSON.stringify([row[1]]), row[0]])
        }
      }
    } catch { /* backfill failed, keep empty */ }
  },
}
