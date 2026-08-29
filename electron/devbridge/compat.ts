import type { Database as SqlJsDatabase } from 'sql.js'
import { getDatabase, getSqlJs, setDatabaseForTesting } from '../database/connection'
import { MIGRATIONS } from '../database/migrations'
import { throwErr } from './response'

/**
 * 兼容探针 —— 用迁移链构建任意历史版本的库，防「新代码只测最新库」的盲区。
 *
 * 49 个迁移意味着老用户的库可能是任何历史形态。原料正是迁移拆分后的
 * 独立迁移文件：MIGRATIONS.slice(0, n) 即「当年版本」的建库过程。
 *
 * ⚠️ build 会把全局 db 切到历史库，测试完务必 restore，
 *    否则后续所有请求都落在旧库上。
 */

let originalDb: SqlJsDatabase | null = null

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`

export function listVersions(): Array<{ index: number; name: string }> {
  return MIGRATIONS.map((m, i) => ({ index: i + 1, name: m.name }))
}

export function buildHistoricalDb(untilName: string): {
  built: string
  applied: number
  tableCount: number
  warning: string
} {
  const idx = MIGRATIONS.findIndex((m) => m.name === untilName)
  if (idx < 0) {
    throwErr('E_BAD_REQUEST', '未知迁移名', { until: untilName, hint: '先调 GET /compat/versions 查看清单' })
  }

  const SQL = getSqlJs()
  const db = new SQL.Database()
  try {
    db.run(MIGRATIONS_TABLE)
    for (const m of MIGRATIONS.slice(0, idx + 1)) {
      m.up(db)
      db.run('INSERT INTO _migrations (name) VALUES (?)', [m.name])
    }
    const tableCount = db.exec(
      "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )[0].values[0][0] as number

    if (!originalDb) originalDb = getDatabase()
    setDatabaseForTesting(db)

    return {
      built: untilName,
      applied: idx + 1,
      tableCount,
      warning:
        '全局 db 已切换为历史版本库。测试完务必调 compat.restore，否则后续所有请求（含保存）都落在旧库上！',
    }
  } catch (e) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    throw e
  }
}

export function restoreCurrentDb(): { restored: boolean } {
  if (!originalDb) throwErr('E_ACTION_FAILED', '没有进行中的兼容构建')
  setDatabaseForTesting(originalDb)
  originalDb = null
  return { restored: true }
}
