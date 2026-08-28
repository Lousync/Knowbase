import type { Migration } from './types'

export const m028AlbumCoverMigration: Migration = {
  name: '028_album_cover',
  up: (db) => {
    // 相册自定义封面：手动设置的封面 data URL，为空时自动取相册第一张照片
    try { db.run("ALTER TABLE moments_albums ADD COLUMN cover_data_url TEXT DEFAULT ''") } catch { /* column may already exist */ }
  },
}
