import { getDatabase, saveToDisk } from '../database/connection'

/**
 * 插件数据表存储（C 级插件能力 `data`）。
 *
 * 设计原则：
 * 1) 命名空间隔离：物理表名固定为 plugin_<safePluginId>_<safeTable>，插件只能访问自己声明的表
 * 2) 不暴露任意 SQL：只提供结构化 CRUD（insert / update / delete / query），
 *    表名与列名一律白名单校验 + 参数绑定，杜绝注入与越权
 * 3) 行数上限：查询默认 200 行、硬上限 1000 行，防止拖垮主进程
 */

const SAFE_NAME_RE = /^[a-z][a-z0-9_]{0,40}$/
const MAX_LIMIT = 1000
const DEFAULT_LIMIT = 200

/** 插件表的列定义（manifest.contributes.tables[].columns[]） */
export interface PluginColumnDef {
  name: string
  type: string
  notNull?: boolean
  default?: string
}

/** 插件表的索引定义 */
export interface PluginIndexDef {
  name?: string
  columns: string[]
  unique?: boolean
}

/** 插件表声明（manifest.contributes.tables[]） */
export interface PluginTableDef {
  name: string
  columns: PluginColumnDef[]
  indexes?: PluginIndexDef[]
}

/** 允许的列类型（白名单，禁止任意 SQL 片段进入 DDL） */
const ALLOWED_TYPES = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB'])

export function isSafeName(name: string): boolean {
  return SAFE_NAME_RE.test(name)
}

/** 插件 ID → 安全的表名片段（非字母数字转下划线） */
export function safePluginId(pluginId: string): string {
  return pluginId.replace(/[^a-z0-9]/gi, '_').toLowerCase()
}

/** 物理表名：plugin_<id>_<table>；非法输入返回 null */
export function physicalTable(pluginId: string, table: string): string | null {
  if (!isSafeName(table)) return null
  return `plugin_${safePluginId(pluginId)}_${table}`
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

/** 校验表定义：表名/列名合法、列类型在白名单内 */
export function validateTableDef(def: unknown): { ok: true; table: PluginTableDef } | { ok: false; error: string } {
  if (!def || typeof def !== 'object') return { ok: false, error: 'table 定义缺失' }
  const d = def as Partial<PluginTableDef>
  if (typeof d.name !== 'string' || !isSafeName(d.name)) {
    return { ok: false, error: '表名非法（需 ^[a-z][a-z0-9_]{1,41}$）' }
  }
  if (!Array.isArray(d.columns) || d.columns.length === 0) return { ok: false, error: `${d.name}: 列定义为空` }
  const columns: PluginColumnDef[] = []
  for (const c of d.columns) {
    if (!c || typeof c.name !== 'string' || !isSafeName(c.name)) return { ok: false, error: `${d.name}: 列名非法` }
    const type = String(c.type || '').toUpperCase().trim()
    if (!ALLOWED_TYPES.has(type)) return { ok: false, error: `${d.name}.${c.name}: 列类型只允许 TEXT/INTEGER/REAL/BLOB` }
    columns.push({ name: c.name, type, notNull: !!c.notNull, default: c.default })
  }
  const indexes: PluginIndexDef[] = []
  for (const idx of Array.isArray(d.indexes) ? d.indexes! : []) {
    if (!idx || !Array.isArray(idx.columns)) continue
    const cols = idx.columns.filter(c => typeof c === 'string' && isSafeName(c))
    if (cols.length === 0) continue
    indexes.push({ name: idx.name, columns: cols, unique: !!idx.unique })
  }
  return { ok: true, table: { name: d.name!, columns, indexes } }
}

/** 建表（幂等，安装/启用时调用） */
export function ensurePluginTables(pluginId: string, tables: PluginTableDef[]): void {
  for (const t of tables) {
    const phys = physicalTable(pluginId, t.name)
    if (!phys) continue
    const cols = t.columns.map(c => {
      const nn = c.notNull ? ' NOT NULL' : ''
      const dv = c.default !== undefined && c.default !== '' ? ` DEFAULT ${c.default}` : ''
      return `"${c.name}" ${c.type}${nn}${dv}`
    })
    try {
      run(`CREATE TABLE IF NOT EXISTS ${phys} (${cols.join(', ')})`)
    } catch { /* 建表失败不阻断安装 */ }
    for (const idx of t.indexes ?? []) {
      const idxName = `"idx_${phys}_${(idx.name && isSafeName(idx.name) ? idx.name : idx.columns.join('_'))}"`
      try {
        run(`CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${idxName} ON ${phys} (${idx.columns.map(c => `"${c}"`).join(', ')})`)
      } catch { /* ignore */ }
    }
  }
}

/** 删表（卸载时调用） */
export function dropPluginTables(pluginId: string, tables: PluginTableDef[]): void {
  for (const t of tables) {
    const phys = physicalTable(pluginId, t.name)
    if (!phys) continue
    try { run(`DROP TABLE IF EXISTS ${phys} `) } catch { /* ignore */ }
  }
}

/** 插件声明的表结构（用于列名白名单） */
function tableDefOf(pluginId: string, tables: PluginTableDef[], logicalTable: string): PluginTableDef | null {
  return tables.find(t => t.name === logicalTable) ?? null
}

export type WhereCond = { column: string; op?: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'like'; value: unknown }

function buildWhere(def: PluginTableDef, where: WhereCond[] | undefined): { sql: string; params: unknown[] } {
  if (!where || where.length === 0) return { sql: '', params: [] }
  const colNames = new Set(def.columns.map(c => c.name))
  const parts: string[] = []
  const params: unknown[] = []
  for (const w of where.slice(0, 8)) {
    if (!w || typeof w.column !== 'string' || !colNames.has(w.column)) continue
    const op = (['=', '!=', '>', '<', '>=', '<=', 'like'].includes(w.op ?? '=') ? w.op : '=') as string
    parts.push(`"${w.column}" ${op === 'like' ? 'LIKE' : op} ?`)
    params.push(w.value)
  }
  return { sql: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '', params }
}

/** 查询（结构化，列名白名单 + 参数绑定 + 行数上限） */
export function pluginQuery(pluginId: string, tables: PluginTableDef[], logicalTable: string, opts?: {
  where?: WhereCond[]
  orderBy?: string
  desc?: boolean
  limit?: number
}): unknown[] {
  const def = tableDefOf(pluginId, tables, logicalTable)
  const phys = physicalTable(pluginId, logicalTable)
  if (!def || !phys) return []
  const { sql: whereSql, params } = buildWhere(def, opts?.where)
  let sql = `SELECT * FROM ${phys}${whereSql}`
  const colNames = new Set(def.columns.map(c => c.name))
  if (opts?.orderBy && colNames.has(opts.orderBy)) {
    sql += ` ORDER BY "${opts.orderBy}" ${opts.desc ? 'DESC' : 'ASC'}`
  }
  const limit = Math.min(Math.max(Number(opts?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  sql += ` LIMIT ${limit}`
  try { return queryAll(sql, params) } catch { return [] }
}

/** 插入一行（列名白名单，只写声明过的列） */
export function pluginInsert(pluginId: string, tables: PluginTableDef[], logicalTable: string, row: Record<string, unknown>): { ok: boolean; id?: string } {
  const def = tableDefOf(pluginId, tables, logicalTable)
  const phys = physicalTable(pluginId, logicalTable)
  if (!def || !phys) return { ok: false }
  const colNames = new Set(def.columns.map(c => c.name))
  const keys = Object.keys(row || {}).filter(k => colNames.has(k))
  if (keys.length === 0) return { ok: false }
  const sql = `INSERT INTO ${phys} (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  try {
    run(sql, keys.map(k => row[k] ?? null))
    const last = queryAll<{ id: string }>(`SELECT rowid AS id FROM ${phys} ORDER BY rowid DESC LIMIT 1`)
    return { ok: true, id: last[0]?.id }
  } catch { return { ok: false } }
}

/** 按 rowid 更新 */
export function pluginUpdate(pluginId: string, tables: PluginTableDef[], logicalTable: string, rowId: string | number, patch: Record<string, unknown>): { ok: boolean } {
  const def = tableDefOf(pluginId, tables, logicalTable)
  const phys = physicalTable(pluginId, logicalTable)
  if (!def || !phys) return { ok: false }
  const colNames = new Set(def.columns.map(c => c.name))
  const keys = Object.keys(patch || {}).filter(k => colNames.has(k))
  if (keys.length === 0) return { ok: false }
  const sql = `UPDATE ${phys} SET ${keys.map(k => `"${k}" = ?`).join(', ')} WHERE rowid = ?`
  try { run(sql, [...keys.map(k => patch[k] ?? null), Number(rowId)]); return { ok: true } } catch { return { ok: false } }
}

/** 按 rowid 删除 */
export function pluginDelete(pluginId: string, tables: PluginTableDef[], logicalTable: string, rowId: string | number): { ok: boolean } {
  const phys = physicalTable(pluginId, logicalTable)
  if (!tableDefOf(pluginId, tables, logicalTable) || !phys) return { ok: false }
  try { run(`DELETE FROM ${phys} WHERE rowid = ?`, [Number(rowId)]); return { ok: true } } catch { return { ok: false } }
}

/** 导出整表（卸载前备份用） */
export function pluginDumpTable(pluginId: string, tables: PluginTableDef[], logicalTable: string): unknown[] {
  const phys = physicalTable(pluginId, logicalTable)
  if (!tableDefOf(pluginId, tables, logicalTable) || !phys) return []
  try { return queryAll(`SELECT rowid AS rowid, * FROM ${phys} LIMIT ${MAX_LIMIT}`) } catch { return [] }
}
