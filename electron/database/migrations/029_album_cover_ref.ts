import type { Migration } from './types'

export const m029AlbumCoverRefMigration: Migration = {
  name: '029_album_cover_ref',
  up: (db) => {
    // 相册封面改为引用相册内的照片（post_id + 图片序号），封面照片始终属于相册
    try { db.run("ALTER TABLE moments_albums ADD COLUMN cover_post_id TEXT DEFAULT ''") } catch { /* column may already exist */ }
    try { db.run("ALTER TABLE moments_albums ADD COLUMN cover_index INTEGER DEFAULT 0") } catch { /* column may already exist */ }
  },
}
