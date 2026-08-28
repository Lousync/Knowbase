import type { Migration } from './types'

export const m024CoverImageMigration: Migration = {
  name: '024_cover_image',
  up: (db) => {
    // 说说主页封面背景（base64 data URL，随用户资料一起持久化）
    try { db.run("ALTER TABLE user_profile ADD COLUMN cover_image_data_url TEXT DEFAULT ''") } catch { /* column may already exist */ }
  },
}
