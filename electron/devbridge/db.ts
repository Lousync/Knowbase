import { getDatabase, getDbPath } from '../database/connection'
import { throwErr } from './response'

/**
 * 只读数据观测。
 *
 * 安全约束（测试桥也不允许写库）：
 * - 剥掉注释后判定首关键字，仅放行 SELECT / PRAGMA / EXPLAIN
 * - 未显式带 LIMIT 的查询自动追加，避免全表拉取拖垮渲染
 * - 所有查询参数化，不接受拼接 SQL
 */

const READONLY_HEAD = /^(select|pragma|explain)\b/i

const DEFAULT_LIMIT = 500

/** 去掉行注释与块注释，防止 `/* x *\/ DELETE ...` 绕过首关键字判定 */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
}

export function assertReadOnly(sql: string): void {
  const head = stripComments(sql)
  if (!head) throwErr('E_BAD_REQUEST', 'SQL 为空')
  if (!READONLY_HEAD.test(head)) {
    throwErr('E_SQL_READONLY', '仅允许 SELECT / PRAGMA / EXPLAIN', { sql: sql.slice(0, 200) })
  }
}

function withLimit(sql: string, maxRows: number): string {
  let s = sql.trim().replace(/;+\s*$/, '')
  if (!/\blimit\s+\d+/i.test(s)) s += ` LIMIT ${maxRows}`
  return s
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  columns: string[]
  rowCount: number
  truncated: boolean
}

export function query(sql: string, params: unknown[] = [], maxRows = DEFAULT_LIMIT): QueryResult {
  assertReadOnly(sql)
  const finalSql = withLimit(sql, maxRows)
  const db = getDatabase()
  const stmt = db.prepare(finalSql)
  if (params.length > 0) stmt.bind(params)

  const rows: Record<string, unknown>[] = []
  const columns = (stmt.getColumnNames?.() ?? []) as string[]
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>)
  } finally {
    stmt.free()
  }

  return {
    rows,
    columns,
    rowCount: rows.length,
    truncated: rows.length >= maxRows,
  }
}

export interface TableInfo {
  name: string
  rowCount: number
}

export function schema(): { tables: TableInfo[]; tableCount: number } {
  const db = getDatabase()
  const res = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  const names: string[] = []
  if (res.length > 0 && res[0].values) {
    for (const row of res[0].values) names.push(String(row[0]))
  }

  const tables: TableInfo[] = names.map((name) => {
    let rowCount = -1
    try {
      const r = db.exec(`SELECT count(*) FROM "${name.replace(/"/g, '""')}"`)
      if (r.length > 0 && r[0].values) rowCount = Number(r[0].values[0][0])
    } catch {
      rowCount = -1
    }
    return { name, rowCount }
  })

  return { tables, tableCount: tables.length }
}

export interface MigrationState {
  applied: string[]
  count: number
}

export function migrations(): MigrationState {
  const res = getDatabase().exec('SELECT name FROM _migrations ORDER BY name')
  const applied: string[] = []
  if (res.length > 0 && res[0].values) {
    for (const row of res[0].values) applied.push(String(row[0]))
  }
  return { applied, count: applied.length }
}

export function dbInfo() {
  return { path: getDbPath() }
}
