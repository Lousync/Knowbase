import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync } from 'fs'
import { MIGRATIONS } from './migrations'

// 迁移脚本需要用附件目录, 而迁移又由本文件驱动 —— 路径函数独立成模块避免循环依赖。
// 此处原样转出, 历史调用方从 connection 导入 getAttachmentsDir 无需改动。
export { getAttachmentsDir } from './paths'

let db: SqlJsDatabase | null = null
let SQL: SqlJsStatic | null = null
let dbPath = ''

export function getSqlJs(): SqlJsStatic { if (!SQL) throw new Error('sql.js not initialized'); return SQL }

export function getDbPath(): string {
  return dbPath
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
  const bakPath = `${dbPath}.bak`

  // 清理上次写盘残留的临时文件(正常流程中 rename 后不存在,崩溃残留则删除)
  try { if (existsSync(`${dbPath}.tmp`)) unlinkSync(`${dbPath}.tmp`) } catch { /* ignore */ }

  // 打开数据库文件;文件损坏(非法 SQLite / 探针查询失败)返回 null
  const tryOpen = (p: string): SqlJsDatabase | null => {
    try {
      const d = new SQL.Database(readFileSync(p))
      d.exec('SELECT count(*) FROM sqlite_master') // 触发文件解析,损坏在此抛错
      return d
    } catch (err) {
      console.error(`[DB] 无法打开数据库文件: ${p}`, err)
      return null
    }
  }

  if (existsSync(dbPath)) {
    db = tryOpen(dbPath)
    if (!db) {
      // 主库损坏:留存现场供抢救,再尝试从 .bak 回退
      const corruptPath = `${dbPath}.corrupt-${Date.now()}`
      try { renameSync(dbPath, corruptPath) } catch { /* ignore */ }
      console.error(`[DB] 主数据库损坏,已留存为 ${corruptPath}`)
    }
  }
  if (!db && existsSync(bakPath)) {
    db = tryOpen(bakPath)
    if (db) {
      try { copyFileSync(bakPath, dbPath) } catch { /* ignore */ }
      console.warn('[DB] 已从 .bak 备份恢复数据库')
    } else {
      console.error('[DB] .bak 备份亦损坏,将创建全新数据库(损坏文件已留存于磁盘)')
    }
  }
  if (!db) {
    db = new SQL.Database()
  }

  db.run('PRAGMA foreign_keys = ON')

  runMigrations()
  saveToDisk()
}

export function runMigrations(): void {
  const database = db
  if (!database) return

  database.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const result = database.exec('SELECT name FROM _migrations')
  const applied = new Set<string>()
  if (result.length > 0 && result[0].values) {
    for (const row of result[0].values) {
      applied.add(row[0] as string)
    }
  }

  // 整个迁移过程包在事务中:DDL 与 _migrations 标记同生共死,
  // 崩溃/断电不会留下"已 ALTER 但未记标记"(下次重复执行报 duplicate column 永远起不来)的中间态
  database.run('BEGIN')
  try {
    // applied 是批次开始前的快照, 全程不随执行更新 —— 修复型迁移(如 018)依赖
    // "其前序迁移此前是否已应用"来判定是否补跑, 该语义必须沿用历史行为。
    for (const migration of MIGRATIONS) {
      const shouldRun = migration.shouldRun
        ? migration.shouldRun(applied)
        : !applied.has(migration.name)
      if (!shouldRun) continue

      migration.up(database)
      database.run('INSERT INTO _migrations (name) VALUES (?)', [migration.name])
    }

    database.run('COMMIT')
  } catch (err) {
    try { database.run('ROLLBACK') } catch { /* ignore */ }
    console.error('[DB] 迁移执行失败,已回滚:', err)
    throw err
  }
}

/**
 * 保存 SQLite 数据到磁盘（sql.js 默认在内存中运行，需要手动持久化）
 *
 * 原子写盘流程:先写临时文件 → 上一份完好库改名轮转为 .bak(仅改名,零拷贝) → 临时文件改名顶替主文件。
 * 任意时刻崩溃/断电,主文件要么是旧的完好库、要么是新的完整库,不会出现写了一半的损坏状态;
 * 极端窗口(两次改名之间)由 initDatabase 的 .bak 回退兜底。
 */
export function saveToDisk(): void {
  if (!db || !dbPath) return
  try {
    const data = db.export()
    const tmpPath = `${dbPath}.tmp`
    writeFileSync(tmpPath, Buffer.from(data))
    try { if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.bak`) } catch { /* ignore */ }
    renameSync(tmpPath, dbPath)
  } catch (err) {
    console.error('Failed to save database to disk:', err)
  }
}

/** 校验 buffer 是否为可正常打开的合法 SQLite 数据库（供数据库文件导入预检） */
export function validateDatabaseBuffer(buffer: Buffer): boolean {
  if (!SQL) return false
  let probe: SqlJsDatabase | null = null
  try {
    probe = new SQL.Database(buffer)
    probe.exec('SELECT count(*) FROM sqlite_master')
    return true
  } catch {
    return false
  } finally {
    try { probe?.close() } catch { /* ignore */ }
  }
}

export function closeDatabase(): void {
  if (db) {
    saveToDisk()
    db.close()
    db = null
  }
}
