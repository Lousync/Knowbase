import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import { join, basename } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { randomUUID } from 'crypto'

let db: SqlJsDatabase | null = null
let SQL: SqlJsStatic | null = null
let dbPath = ''

export function getSqlJs(): SqlJsStatic { if (!SQL) throw new Error('sql.js not initialized'); return SQL }

export function getDbPath(): string {
  return dbPath
}

export function getAttachmentsDir(): string {
  const userDataPath = app.getPath('userData')
  const attachmentsDir = join(userDataPath, 'attachments')
  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true })
  }
  return attachmentsDir
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export async function initDatabase(): Promise<void> {
  SQL = await initSqlJs()

  const userDataPath = app.getPath('userData')
  const dataDir = join(userDataPath, 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  dbPath = join(dataDir, 'knowledge.db')

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA foreign_keys = ON')

  runMigrations()
  saveToDisk()
}

export function runMigrations(): void {
  if (!db) return

  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const result = db.exec('SELECT name FROM _migrations')
  const applied = new Set<string>()
  if (result.length > 0 && result[0].values) {
    for (const row of result[0].values) {
      applied.add(row[0] as string)
    }
  }

  if (!applied.has('001_init')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        content_md  TEXT NOT NULL DEFAULT '',
        content_html TEXT DEFAULT '',
        date        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        is_pinned   INTEGER DEFAULT 0,
        word_count  INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6b7280'
      );

      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
      CREATE INDEX IF NOT EXISTS idx_entries_pinned ON entries(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
    `)

    db.run("INSERT INTO _migrations (name) VALUES ('001_init')")
  }

  if (!applied.has('002_schedule')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_todos (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT DEFAULT '',
        date        TEXT NOT NULL,
        time        TEXT,
        quadrant    INTEGER DEFAULT 1,
        task_type   TEXT DEFAULT 'plan',
        tag_id      TEXT,
        status      TEXT DEFAULT 'pending',
        sort_order  INTEGER DEFAULT 0,
        end_criteria TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS schedule_tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6b7280'
      );

      CREATE INDEX IF NOT EXISTS idx_stodos_date ON schedule_todos(date);
      CREATE INDEX IF NOT EXISTS idx_stodos_status ON schedule_todos(status);
    `)

    db.run("INSERT INTO _migrations (name) VALUES ('002_schedule')")
  }

  if (!applied.has('003_schedule_end_criteria')) {
    // Add end_criteria column for existing databases
    try { db.run("ALTER TABLE schedule_todos ADD COLUMN end_criteria TEXT DEFAULT ''") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('003_schedule_end_criteria')")
  }

  if (!applied.has('004_knowledge')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_categories (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        parent_id   TEXT REFERENCES knowledge_categories(id) ON DELETE SET NULL,
        sort_order  INTEGER DEFAULT 0,
        category_type TEXT NOT NULL DEFAULT 'folder',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS knowledge_pages (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        content_md  TEXT NOT NULL DEFAULT '',
        content_html TEXT DEFAULT '',
        category_id TEXT REFERENCES knowledge_categories(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_kpages_category ON knowledge_pages(category_id);
      CREATE INDEX IF NOT EXISTS idx_kpages_updated ON knowledge_pages(updated_at);
      CREATE INDEX IF NOT EXISTS idx_kcat_parent ON knowledge_categories(parent_id);
    `)

    db.run("INSERT INTO _migrations (name) VALUES ('004_knowledge')")
  }

  if (!applied.has('005_knowledge_links')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_links (
        id              TEXT PRIMARY KEY,
        source_page_id  TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
        target_page_id  TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
        UNIQUE(source_page_id, target_page_id)
      );

      CREATE INDEX IF NOT EXISTS idx_klinks_source ON knowledge_links(source_page_id);
      CREATE INDEX IF NOT EXISTS idx_klinks_target ON knowledge_links(target_page_id);

      CREATE TABLE IF NOT EXISTS knowledge_tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6b7280'
      );

      CREATE TABLE IF NOT EXISTS knowledge_page_tags (
        page_id TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
        tag_id  TEXT NOT NULL REFERENCES knowledge_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (page_id, tag_id)
      );
    `)

    db.run("INSERT INTO _migrations (name) VALUES ('005_knowledge_links')")
  }

  if (!applied.has('006_knowledge_star')) {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN is_starred INTEGER DEFAULT 0") } catch { /* column may exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('006_knowledge_star')")
  }

  if (!applied.has('007_page_sort_order')) {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN sort_order INTEGER DEFAULT 0") } catch { /* column may exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('007_page_sort_order')")
  }

  if (!applied.has('008_recycle_bin')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS recycle_bin (
        id          TEXT PRIMARY KEY,
        original_id TEXT NOT NULL,
        module      TEXT NOT NULL,
        title       TEXT NOT NULL,
        data        TEXT NOT NULL,
        deleted_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rb_module ON recycle_bin(module);
      CREATE INDEX IF NOT EXISTS idx_rb_deleted ON recycle_bin(deleted_at);
    `)
    db.run("INSERT INTO _migrations (name) VALUES ('008_recycle_bin')")
  }

  if (!applied.has('009_subtasks')) {
    try { db.run("ALTER TABLE schedule_todos ADD COLUMN parent_id TEXT") } catch { /* column may already exist */ }
    db.run("CREATE INDEX IF NOT EXISTS idx_stodos_parent ON schedule_todos(parent_id)")
    db.run("INSERT INTO _migrations (name) VALUES ('009_subtasks')")
  }

  if (!applied.has('010_knowledge_category_type')) {
    try { db.run("ALTER TABLE knowledge_categories ADD COLUMN category_type TEXT DEFAULT 'folder'") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('010_knowledge_category_type')")
  }

  if (!applied.has('011_knowledge_file_type')) {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN file_type TEXT DEFAULT ''") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('011_knowledge_file_type')")
  }
  if (!applied.has('012_blog_states')) {
    try { db.run("ALTER TABLE entries ADD COLUMN states TEXT DEFAULT ''") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('012_blog_states')")
  }

  if (!applied.has('013_user_profile')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id              TEXT PRIMARY KEY DEFAULT 'default',
        username        TEXT NOT NULL DEFAULT '',
        avatar_path     TEXT DEFAULT '',
        password_hash   TEXT DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.run("INSERT OR IGNORE INTO user_profile (id, username) VALUES ('default', '')")
    db.run("INSERT INTO _migrations (name) VALUES ('013_user_profile')")
  }

  if (!applied.has('014_toolbox')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS toolbox_scripts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        language    TEXT NOT NULL DEFAULT 'plaintext',
        sort_order  INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_toolbox_scripts_sort ON toolbox_scripts(sort_order);
    `)
    db.run("INSERT INTO _migrations (name) VALUES ('014_toolbox')")
  }

  if (!applied.has('015_dedup_entries')) {
    // Remove duplicate entries for the same date: keep the earliest-created one,
    // move the rest to recycle bin so no data is silently lost.
    if (!db) return
    try {
      const dupes = db.exec(
        `SELECT date, COUNT(*) as cnt FROM entries GROUP BY date HAVING cnt > 1`
      )
      if (dupes.length > 0 && dupes[0].values) {
        for (const row of dupes[0].values) {
          const date = row[0] as string
          // Get all entries for this date, ordered by created_at — keep the first
          const stmt = db.prepare('SELECT * FROM entries WHERE date = ? ORDER BY created_at ASC')
          stmt.bind([date])
          const entries: Record<string, unknown>[] = []
          while (stmt.step()) entries.push(stmt.getAsObject())
          stmt.free()
          // Keep the first, soft-delete the rest into recycle bin
          for (let i = 1; i < entries.length; i++) {
            const e = entries[i]
            const entryId = e.id as string
            // Get tags for this entry
            const tStmt = db.prepare(
              `SELECT t.id, t.name, t.color FROM tags t
               JOIN entry_tags et ON t.id = et.tag_id
               WHERE et.entry_id = ?`
            )
            tStmt.bind([entryId])
            const tags: Record<string, unknown>[] = []
            while (tStmt.step()) tags.push(tStmt.getAsObject())
            tStmt.free()
            const data = JSON.stringify({ ...e, tags, contentHtml: (e as Record<string, unknown>).content_html || '' })
            const binId = randomUUID()
            db.run(
              `INSERT INTO recycle_bin (id, original_id, module, title, data) VALUES (?, ?, 'blog', ?, ?)`,
              [binId, entryId, (e as Record<string, unknown>).title || '', data]
            )
            db.run('DELETE FROM entries WHERE id = ?', [entryId])
          }
        }
      }
    } catch (_) { /* ignore dedup errors */ }
    db.run("INSERT INTO _migrations (name) VALUES ('015_dedup_entries')")
  }

  if (!applied.has('016_blog_star')) {
    // Add is_starred column to blog entries for favorites support
    try {
      db.run('ALTER TABLE entries ADD COLUMN is_starred INTEGER DEFAULT 0')
    } catch (_) { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('016_blog_star')")
  }

  if (!applied.has('017_knowledge_category_dates')) {
    // Check which columns exist before attempting ALTER (prevents silent failures)
    let hasCreatedAt = false
    let hasUpdatedAt = false
    try {
      const info = db.exec("PRAGMA table_info('knowledge_categories')")
      if (info[0]) {
        hasCreatedAt = info[0].values.some((row: any[]) => row[1] === 'created_at')
        hasUpdatedAt = info[0].values.some((row: any[]) => row[1] === 'updated_at')
      }
    } catch (_) { /* PRAGMA failed — table might not exist yet */ }
    if (!hasCreatedAt) {
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
    }
    if (!hasUpdatedAt) {
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
    }
    db.run("INSERT INTO _migrations (name) VALUES ('017_knowledge_category_dates')")
  }

  // Repair: if 017 was marked applied but columns are still missing (e.g. ALTER TABLE silently failed)
  if (applied.has('017_knowledge_category_dates') && !applied.has('018_repair_category_dates')) {
    let needsRepair = false
    try {
      const info = db.exec("PRAGMA table_info('knowledge_categories')")
      if (info[0]) {
        const hasCreatedAt = info[0].values.some((row: any[]) => row[1] === 'created_at')
        const hasUpdatedAt = info[0].values.some((row: any[]) => row[1] === 'updated_at')
        if (!hasCreatedAt || !hasUpdatedAt) needsRepair = true
      }
    } catch (_) { }
    if (needsRepair) {
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
      try { db.run("ALTER TABLE knowledge_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))") } catch (_) { }
    }
    db.run("INSERT INTO _migrations (name) VALUES ('018_repair_category_dates')")
  }

  // 019 — normalize file_type: lowercase, strip leading dot
  if (!applied.has('019_normalize_file_type')) {
    // Update rows where file_type starts with '.'
    db.run("UPDATE knowledge_pages SET file_type = LOWER(SUBSTR(file_type, 2)) WHERE file_type LIKE '.%'")
    // Update rows where file_type has uppercase letters
    db.run("UPDATE knowledge_pages SET file_type = LOWER(file_type) WHERE file_type != LOWER(file_type)")
    db.run("INSERT INTO _migrations (name) VALUES ('019_normalize_file_type')")
  }

  if (!applied.has('020_password_vault')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS toolbox_passwords (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        url         TEXT DEFAULT '',
        username    TEXT DEFAULT '',
        password    TEXT NOT NULL DEFAULT '',
        notes       TEXT DEFAULT '',
        sort_order  INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    db.run("INSERT INTO _migrations (name) VALUES ('020_password_vault')")
  }

  if (!applied.has('021_password_account')) {
    try { db.run("ALTER TABLE toolbox_passwords ADD COLUMN account TEXT DEFAULT ''") } catch (_) { /* column may exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('021_password_account')")
  }

  if (!applied.has('022_moments')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS moments_posts (
        id          TEXT PRIMARY KEY,
        content_md  TEXT NOT NULL DEFAULT '',
        content_html TEXT DEFAULT '',
        image_data_url TEXT DEFAULT '',
        is_pinned   INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_moments_pinned ON moments_posts(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_moments_created ON moments_posts(created_at);
    `)
    db.run("INSERT INTO _migrations (name) VALUES ('022_moments')")
  }

  if (!applied.has('023_moments_image')) {
    try { db.run("ALTER TABLE moments_posts ADD COLUMN image_data_url TEXT DEFAULT ''") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('023_moments_image')")
  }

  if (!applied.has('024_cover_image')) {
    // 说说主页封面背景（base64 data URL，随用户资料一起持久化）
    try { db.run("ALTER TABLE user_profile ADD COLUMN cover_image_data_url TEXT DEFAULT ''") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('024_cover_image')")
  }

  if (!applied.has('025_moments_images')) {
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
    db.run("INSERT INTO _migrations (name) VALUES ('025_moments_images')")
  }

  if (!applied.has('026_moments_tags')) {
    // 说说标签：JSON 数组存放标签名
    try { db.run("ALTER TABLE moments_posts ADD COLUMN tags TEXT DEFAULT '[]'") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('026_moments_tags')")
  }

  if (!applied.has('027_moments_albums')) {
    // 说说相册：独立相册表 + 说说归属相册
    db.run(`
      CREATE TABLE IF NOT EXISTS moments_albums (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    try { db.run("ALTER TABLE moments_posts ADD COLUMN album_id TEXT DEFAULT ''") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('027_moments_albums')")
  }

  if (!applied.has('028_album_cover')) {
    // 相册自定义封面：手动设置的封面 data URL，为空时自动取相册第一张照片
    try { db.run("ALTER TABLE moments_albums ADD COLUMN cover_data_url TEXT DEFAULT ''") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('028_album_cover')")
  }

  if (!applied.has('029_album_cover_ref')) {
    // 相册封面改为引用相册内的照片（post_id + 图片序号），封面照片始终属于相册
    try { db.run("ALTER TABLE moments_albums ADD COLUMN cover_post_id TEXT DEFAULT ''") } catch { /* column may already exist */ }
    try { db.run("ALTER TABLE moments_albums ADD COLUMN cover_index INTEGER DEFAULT 0") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('029_album_cover_ref')")
  }

  if (!applied.has('030_weight_tracker')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS toolbox_weight_records (
        id          TEXT PRIMARY KEY,
        weight      REAL NOT NULL,
        date        TEXT NOT NULL,
        series      TEXT NOT NULL DEFAULT 'default',
        note        TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_weight_date ON toolbox_weight_records(date);
      CREATE INDEX IF NOT EXISTS idx_weight_series ON toolbox_weight_records(series);
    `)
    db.run("INSERT INTO _migrations (name) VALUES ('030_weight_tracker')")
  }

  if (!applied.has('031_attachments')) {
    // 统一附件子系统：所有模块的文件（说说图片/知识库附件/头像等）统一登记
    db.run(`
      CREATE TABLE IF NOT EXISTS attachments (
        id          TEXT PRIMARY KEY,
        owner_type  TEXT NOT NULL,
        owner_id    TEXT NOT NULL DEFAULT '',
        position    INTEGER DEFAULT 0,
        file_name   TEXT NOT NULL DEFAULT '',
        file_path   TEXT NOT NULL,
        thumb_path  TEXT DEFAULT '',
        mime_type   TEXT DEFAULT '',
        size_bytes  INTEGER DEFAULT 0,
        trashed     INTEGER DEFAULT 0,
        trash_path  TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_att_owner ON attachments(owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS idx_att_trashed ON attachments(trashed);
    `)
    db.run("INSERT INTO _migrations (name) VALUES ('031_attachments')")
  }

  if (!applied.has('032_moments_attachment_ids')) {
    // 说说图片改为引用附件表（附件文件落盘，数据库只存元数据引用）
    try { db.run("ALTER TABLE moments_posts ADD COLUMN attachment_ids TEXT DEFAULT '[]'") } catch { /* column may already exist */ }
    db.run("INSERT INTO _migrations (name) VALUES ('032_moments_attachment_ids')")
  }

  if (!applied.has('033_backfill_moments_attachments')) {
    // 一次性迁移：把历史 base64 图片解码落盘，登记到 attachments 表
    try {
      const rows = db.exec("SELECT id, images_data_urls FROM moments_posts WHERE images_data_urls IS NOT NULL AND images_data_urls != ''")
      if (rows.length > 0 && rows[0].values) {
        for (const r of rows[0].values) {
          const postId = r[0] as string
          let urls: string[] = []
          try { urls = JSON.parse(r[1] as string) } catch { urls = [] }
          if (!Array.isArray(urls) || urls.length === 0) continue
          const ids: string[] = []
          for (let i = 0; i < urls.length; i++) {
            const dataUrl = urls[i]
            if (typeof dataUrl !== 'string' || !dataUrl.includes(',')) continue
            const [head, b64] = dataUrl.split(',')
            const mime = /^data:([^;]+)/.exec(head)?.[1] || 'image/png'
            const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : mime === 'image/bmp' ? 'bmp' : 'png'
            const id = randomUUID()
            const relDir = join('moments', postId)
            const dir = join(getAttachmentsDir(), relDir)
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            const rel = join(relDir, `${id}.${ext}`)
            writeFileSync(join(getAttachmentsDir(), rel), Buffer.from(b64, 'base64'))
            db.run(
              `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
               VALUES (?, 'moments_post', ?, ?, ?, ?, ?, ?, ?)`,
              [id, postId, i, `photo-${i + 1}.${ext}`, rel, mime, Buffer.byteLength(b64, 'base64'), new Date().toISOString()]
            )
            ids.push(id)
          }
          if (ids.length > 0) {
            db.run('UPDATE moments_posts SET attachment_ids = ? WHERE id = ?', [JSON.stringify(ids), postId])
          }
        }
      }
    } catch (e) {
      console.error('[migration 033] backfill failed:', e)
    }
    db.run("INSERT INTO _migrations (name) VALUES ('033_backfill_moments_attachments')")
  }

  if (!applied.has('034_knowledge_attachment_id')) {
    try { db.run("ALTER TABLE knowledge_pages ADD COLUMN attachment_id TEXT DEFAULT ''") } catch { /* column may already exist */ }
    // 回填：把已落盘的知识库附件（PDF/XMind 等）登记进附件表
    try {
      const rows = db.exec("SELECT id, title, content_md, file_type FROM knowledge_pages")
      if (rows.length > 0 && rows[0].values) {
        for (const r of rows[0].values) {
          const pageId = r[0] as string
          const title = (r[1] as string) || ''
          const contentMd = (r[2] as string) || ''
          const fileType = (r[3] as string) || ''
          if (!fileType || fileType === 'md' || fileType === 'txt') continue
          // content_md 作为附件文件名使用（flat 目录，位于 attachments/ 下）
          const src = join(getAttachmentsDir(), contentMd)
          if (!existsSync(src)) continue
          const ext = fileType.replace(/^\./, '')
          const mime = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'
          const id = randomUUID()
          db.run(
            `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
             VALUES (?, 'knowledge_page', ?, 0, ?, ?, ?, ?, ?)`,
            [id, pageId, title || contentMd, contentMd, mime, existsSync(src) ? readFileSync(src).length : 0, new Date().toISOString()]
          )
          db.run('UPDATE knowledge_pages SET attachment_id = ? WHERE id = ?', [id, pageId])
        }
      }
    } catch (e) {
      console.error('[migration 034] backfill failed:', e)
    }
    db.run("INSERT INTO _migrations (name) VALUES ('034_knowledge_attachment_id')")
  }

  if (!applied.has('035_avatar_attachment')) {
    // 头像迁入统一附件体系：文件移到 attachments/user_profile/default/，登记附件表
    try {
      const rows = db.exec("SELECT avatar_path FROM user_profile WHERE id = 'default' AND avatar_path IS NOT NULL AND avatar_path != ''")
      if (rows.length > 0 && rows[0].values) {
        for (const row of rows[0].values) {
          const oldRel = row[0] as string
          const src = join(app.getPath('userData'), oldRel)
          if (!existsSync(src)) continue
          const ext = /\.(\w+)$/.exec(oldRel)?.[1] || 'png'
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
          const id = randomUUID()
          const dir = join(getAttachmentsDir(), 'user_profile', 'default')
          mkdirSync(dir, { recursive: true })
          const rel = join('user_profile', 'default', `avatar_${id}.${ext}`)
          copyFileSync(src, join(getAttachmentsDir(), rel))
          db.run("UPDATE user_profile SET avatar_path = ? WHERE id = 'default'", [join('attachments', rel)])
          db.run(
            `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
             VALUES (?, 'user_profile', 'default', 0, ?, ?, ?, ?, ?)`,
            [id, basename(oldRel), rel, mime, existsSync(src) ? readFileSync(src).length : 0, new Date().toISOString()]
          )
        }
      }
    } catch (e) {
      console.error('[migration 035] avatar backfill failed:', e)
    }
    db.run("INSERT INTO _migrations (name) VALUES ('035_avatar_attachment')")
  }
}

/**
 * 保存 SQLite 数据到磁盘（sql.js 默认在内存中运行，需要手动持久化）
 */
export function saveToDisk(): void {
  if (!db || !dbPath) return
  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(dbPath, buffer)
  } catch (err) {
    console.error('Failed to save database to disk:', err)
  }
}

export function closeDatabase(): void {
  if (db) {
    saveToDisk()
    db.close()
    db = null
  }
}
