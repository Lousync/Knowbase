import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

let db: SqlJsDatabase | null = null
let SQL: SqlJsStatic | null = null
let dbPath = ''

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

function runMigrations(): void {
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
        sort_order  INTEGER DEFAULT 0
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
