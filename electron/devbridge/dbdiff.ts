import { createHash, randomUUID } from 'crypto'
import type { Database as SqlJsDatabase } from 'sql.js'
import { getDatabase, getSqlJs } from '../database/connection'
import { throwErr } from './response'

/**
 * 数据库快照与 Diff —— 验证「预期的写入发生了、意外的写入为零」。
 *
 * 用法：改代码前 createSnapshot() → 改代码 → createSnapshot() → diffSnapshots(from, to)。
 *
 * 快照即 db.export() 的字节（SQLite 文件格式），用 getSqlJs() 惰性重建做对比。
 * 快照驻留内存、上限 3 份（内存库每份几十 MB），超出淘汰最旧；如需更大容量
 * 可改为落盘 userData/devbridge-snapshots/（见 roadmap 待决事项）。
 *
 * diff 设计：
 * - 表集合差异单独报告
 * - 行级按主键对齐（PRAGMA table_info 的 pk 列）；无主键表只报行数差异
 * - 超过 256 字符的字符串值以 md5 代替参与比较，diff 详情不输出原文，
 *   避免 content_md 等大字段撑爆报告
 * - 每表差异详情上限 50 条，超出置 truncated
 */

const MAX_SNAPSHOTS = 3
const HASH_THRESHOLD = 256
const DETAIL_LIMIT = 50

export interface SnapshotMeta {
  id: string
  createdAt: string
  sizeBytes: number
  tableCount: number
}

interface Snapshot extends SnapshotMeta {
  bytes: Uint8Array
}

const snapshots = new Map<string, Snapshot>()

function listTables(db: SqlJsDatabase): string[] {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  if (res.length === 0 || !res[0].values) return []
  return res[0].values.map((r: unknown[]) => String(r[0]))
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function primaryKeyColumns(db: SqlJsDatabase, table: string): string[] {
  try {
    const res = db.exec(`PRAGMA table_info(${quoteIdent(table)})`)
    if (res.length === 0 || !res[0].values) return []
    const cols = res[0].columns
    const nameIdx = cols.indexOf('name')
    const pkIdx = cols.indexOf('pk')
    if (nameIdx < 0 || pkIdx < 0) return []
    const info = res[0].values.map((row: unknown[]) => ({
      name: String(row[nameIdx]),
      pk: Number(row[pkIdx]) || 0,
    }))
    return info
      .filter((c: { pk: number }) => c.pk > 0)
      .sort((x: { pk: number }, y: { pk: number }) => x.pk - y.pk)
      .map((c: { name: string }) => c.name)
  } catch {
    return []
  }
}

/** 超过阈值的字符串以 md5 参与 比较，避免大字段原文进入 diff 报告 */
function fingerprint(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  const s = typeof value === 'string' ? value : String(value)
  if (s.length > HASH_THRESHOLD) {
    return `md5:${createHash('md5').update(s).digest('hex')}`
  }
  return s
}

export function createSnapshot(): SnapshotMeta {
  const db = getDatabase()
  const bytes = db.export()
  const snapshot: Snapshot = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    sizeBytes: bytes.byteLength,
    tableCount: listTables(db).length,
    bytes,
  }
  // Map 保持插入序：超出上限淘汰最旧（首个）
  if (snapshots.size >= MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value
    if (oldest !== undefined) snapshots.delete(oldest)
  }
  snapshots.set(snapshot.id, snapshot)
  const { bytes: _omit, ...meta } = snapshot
  void _omit
  return meta
}

export function listSnapshots(): SnapshotMeta[] {
  return [...snapshots.values()].map(({ bytes: _omit, ...meta }) => {
    void _omit
    return meta
  })
}

export function deleteSnapshot(id: string): boolean {
  return snapshots.delete(id)
}

export interface RowDiff {
  pk: string
  kind: 'added' | 'removed' | 'changed'
  fields?: string[]
}

export interface TableDiff {
  table: string
  rowsBefore: number
  rowsAfter: number
  added: number
  removed: number
  changed: number
  truncated: boolean
  details: RowDiff[]
}

export interface DiffResult {
  from: string
  to: string
  tablesAdded: string[]
  tablesRemoved: string[]
  tables: TableDiff[]
  totalChanges: number
}

function collectRows(db: SqlJsDatabase, table: string, pkCols: string[]): Map<string, Record<string, unknown>> {
  const order = pkCols.map(quoteIdent).join(', ')
  const stmt = db.prepare(`SELECT * FROM ${quoteIdent(table)} ORDER BY ${order}`)
  const map = new Map<string, Record<string, unknown>>()
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>
      map.set(pkCols.map((c) => fingerprint(row[c])).join('|'), row)
    }
  } finally {
    stmt.free()
  }
  return map
}

function diffTable(aDb: SqlJsDatabase, bDb: SqlJsDatabase, table: string): TableDiff {
  const pkCols = primaryKeyColumns(aDb, table)
  const countOf = (db: SqlJsDatabase): number => {
    const r = db.exec(`SELECT count(*) FROM ${quoteIdent(table)}`)
    return r.length > 0 && r[0].values ? Number(r[0].values[0][0]) : 0
  }
  const diff: TableDiff = {
    table,
    rowsBefore: countOf(aDb),
    rowsAfter: countOf(bDb),
    added: 0,
    removed: 0,
    changed: 0,
    truncated: false,
    details: [],
  }

  if (pkCols.length === 0) {
    if (diff.rowsBefore !== diff.rowsAfter) {
      diff.details.push({ pk: '(no pk)', kind: 'changed', fields: [`rowCount ${diff.rowsBefore} -> ${diff.rowsAfter}`] })
      diff.changed = 1
    }
    return diff
  }

  const before = collectRows(aDb, table, pkCols)
  const after = collectRows(bDb, table, pkCols)
  const fields = [...new Set([...before.values(), ...after.values()].flatMap((r) => Object.keys(r)))]

  const push = (d: RowDiff) => {
    if (diff.details.length >= DETAIL_LIMIT) {
      diff.truncated = true
      return
    }
    diff.details.push(d)
  }

  for (const [key, rowB] of after) {
    const rowA = before.get(key)
    if (!rowA) {
      diff.added++
      push({ pk: key, kind: 'added' })
      continue
    }
    const changedFields = fields.filter((f) => fingerprint(rowA[f]) !== fingerprint(rowB[f]))
    if (changedFields.length > 0) {
      diff.changed++
      push({ pk: key, kind: 'changed', fields: changedFields })
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) {
      diff.removed++
      push({ pk: key, kind: 'removed' })
    }
  }
  return diff
}

export function diffSnapshots(fromId: string, toId: string): DiffResult {
  const from = snapshots.get(fromId)
  const to = snapshots.get(toId)
  if (!from || !to) {
    throwErr('E_BAD_REQUEST', '快照不存在', { available: [...snapshots.keys()] })
  }

  const SQL = getSqlJs()
  const aDb = new SQL.Database(from!.bytes)
  const bDb = new SQL.Database(to!.bytes)
  try {
    const tablesA = new Set(listTables(aDb))
    const tablesB = new Set(listTables(bDb))
    const tablesAdded = [...tablesB].filter((t) => !tablesA.has(t))
    const tablesRemoved = [...tablesA].filter((t) => !tablesB.has(t))

    const common = [...tablesA].filter((t) => tablesB.has(t)).sort()
    const tables = common.map((t) => diffTable(aDb, bDb, t))

    return {
      from: fromId,
      to: toId,
      tablesAdded,
      tablesRemoved,
      tables: tables.filter((t) => t.added + t.removed + t.changed > 0),
      totalChanges: tables.reduce((s, t) => s + t.added + t.removed + t.changed, 0),
    }
  } finally {
    try {
      aDb.close()
      bDb.close()
    } catch {
      /* ignore */
    }
  }
}
