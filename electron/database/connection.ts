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
