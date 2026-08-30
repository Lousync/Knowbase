import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDatabase, saveToDisk } from '../database/connection'
import { ensurePluginTables, dropPluginTables } from './pluginDataStore'
import type { PluginTableDef } from './pluginDataStore'

/**
 * 错题本数据迁移（P2）：主表 ⇄ 插件命名空间表。
 *
 * 背景：错题本要拆成 C 级模块插件，数据需从主库主表搬到插件自有表
 * （plugin_knowbase_quizbook_*），插件卸载时数据随之导出/清理。
 *
 * 设计：
 * 1) 可 dry-run：先跑一遍只统计不落盘，供 UI 预览
 * 2) 可回滚：反向写回主表；两次方向都用 INSERT OR REPLACE 保证幂等
 * 3) 先备份：实执行前自动导出主表全量 JSON 到 userData/backups/
 * 4) 不删源表数据：迁移 = 复制，回滚 = 反向覆盖，源表始终留底直到用户确认
 */

/** 错题本插件 id（与插件 manifest 保持一致） */
export const QUIZBOOK_PLUGIN_ID = 'knowbase.quizbook'

/** 插件自有表结构（与主表字段一一对应） */
export const QUIZBOOK_TABLES: PluginTableDef[] = [
  {
    name: 'records',
    columns: [
      { name: 'id', type: 'TEXT', notNull: true },
      { name: 'page_id', type: 'TEXT', notNull: true },
      { name: 'quiz_no', type: 'INTEGER', notNull: true },
      { name: 'page_title', type: 'TEXT' },
      { name: 'is_favorite', type: 'INTEGER', default: '0' },
      { name: 'wrong_count', type: 'INTEGER', default: '0' },
      { name: 'correct_count', type: 'INTEGER', default: '0' },
      { name: 'last_result', type: 'INTEGER' },
      { name: 'streak_correct', type: 'INTEGER', default: '0' },
      { name: 'note', type: 'TEXT', default: "''" },
      { name: 'snapshot_json', type: 'TEXT', default: "''" },
      { name: 'source_space', type: 'TEXT', default: "''" },
      { name: 'source_notebook', type: 'TEXT', default: "''" },
      { name: 'source_chapter', type: 'TEXT', default: "''" },
      { name: 'created_at', type: 'TEXT' },
      { name: 'updated_at', type: 'TEXT' },
    ],
    indexes: [
      { columns: ['page_id'] },
      { columns: ['page_id', 'quiz_no'], unique: true },
      { columns: ['wrong_count'] },
      { columns: ['is_favorite'] },
    ],
  },
  {
    name: 'collections',
    columns: [
      { name: 'id', type: 'TEXT', notNull: true },
      { name: 'name', type: 'TEXT', notNull: true },
      { name: 'sort_order', type: 'INTEGER', default: '0' },
      { name: 'created_at', type: 'TEXT' },
    ],
  },
  {
    name: 'record_collections',
    columns: [
      { name: 'record_id', type: 'TEXT', notNull: true },
      { name: 'collection_id', type: 'TEXT', notNull: true },
    ],
    indexes: [{ columns: ['collection_id'] }],
  },
  {
    name: 'tags',
    columns: [
      { name: 'id', type: 'TEXT', notNull: true },
      { name: 'name', type: 'TEXT', notNull: true },
      { name: 'kind', type: 'TEXT', default: "'custom'" },
      { name: 'color', type: 'TEXT', default: "''" },
      { name: 'sort_order', type: 'INTEGER', default: '0' },
      { name: 'created_at', type: 'TEXT' },
    ],
  },
  {
    name: 'record_tags',
    columns: [
      { name: 'record_id', type: 'TEXT', notNull: true },
      { name: 'tag_id', type: 'TEXT', notNull: true },
    ],
    indexes: [{ columns: ['tag_id'] }],
  },
]

/** 主表 → 插件表的列映射（列名一致，显式列出防止主表加列后误拷） */
const MIGRATION_MAP: Array<{ from: string; to: string; cols: string[] }> = [
  {
    from: 'quiz_records', to: 'records',
    cols: ['id', 'page_id', 'quiz_no', 'page_title', 'is_favorite', 'wrong_count', 'correct_count',
      'last_result', 'streak_correct', 'note', 'snapshot_json', 'source_space', 'source_notebook',
      'source_chapter', 'created_at', 'updated_at'],
  },
  { from: 'quiz_collections', to: 'collections', cols: ['id', 'name', 'sort_order', 'created_at'] },
  { from: 'quiz_record_collections', to: 'record_collections', cols: ['record_id', 'collection_id'] },
  { from: 'quiz_tags', to: 'tags', cols: ['id', 'name', 'kind', 'color', 'sort_order', 'created_at'] },
  { from: 'quiz_record_tags', to: 'record_tags', cols: ['record_id', 'tag_id'] },
]

function safeId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '_').toLowerCase()
}

function phys(table: string): string {
  return `plugin_${safeId(QUIZBOOK_PLUGIN_ID)}_${table}`
}

function tableExists(name: string): boolean {
  try {
    const db = getDatabase()
    const stmt = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    stmt.bind([name])
    const ok = stmt.step()
    stmt.free()
    return ok
  } catch { return false }
}

function countRows(name: string): number {
  if (!tableExists(name)) return 0
  try {
    const db = getDatabase()
    const stmt = db.prepare(`SELECT COUNT(*) AS n FROM ${name}`)
    stmt.step()
    const row = stmt.getAsObject() as { n: number }
    stmt.free()
    return row.n ?? 0
  } catch { return 0 }
}

function exec(sql: string): void {
  getDatabase().run(sql)
}

function queryAll<T>(sql: string): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

/** 主表/插件表当前行数对比（供 UI 显示迁移状态） */
export function migrationStatus(): {
  main: Record<string, number>
  plugin: Record<string, number>
  pluginTablesExist: boolean
} {
  const main: Record<string, number> = {}
  const plugin: Record<string, number> = {}
  for (const m of MIGRATION_MAP) {
    main[m.to] = countRows(m.from)
    plugin[m.to] = countRows(phys(m.to))
  }
  return { main, plugin, pluginTablesExist: tableExists(phys('records')) }
}

/** 带参数的查询（内部用） */
function queryAllP<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function execP(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
}

/**
 * 插件模式判题上报：写入插件命名空间表 records（与主表语义一致：
 * 答对 correct_count+1 / streak_correct+1 / last_result=1；
 * 答错 wrong_count+1 / streak_correct=0 / last_result=0；不存在则插入）。
 * 按 (page_id, quiz_no) 定位，幂等。
 */
export function pluginReportRecord(pluginId: string, pageId: string, quizNo: number, correct: boolean, meta?: {
  pageTitle?: string
  snapshot?: unknown
}): { ok: boolean; error?: string } {
  const table = phys('records')
  if (!tableExists(table)) return { ok: false, error: '插件表不存在' }
  try {
    const now = `datetime('now', 'localtime')`
    const existing = queryAllP<{ id: string }>(
      `SELECT id FROM ${table} WHERE page_id = ? AND quiz_no = ?`, [pageId, quizNo]
    )[0]
    if (existing) {
      if (correct) {
        execP(`UPDATE ${table} SET correct_count = correct_count + 1, streak_correct = streak_correct + 1, last_result = 1, updated_at = ${now} WHERE page_id = ? AND quiz_no = ?`, [pageId, quizNo])
      } else {
        execP(`UPDATE ${table} SET wrong_count = wrong_count + 1, streak_correct = 0, last_result = 0, updated_at = ${now} WHERE page_id = ? AND quiz_no = ?`, [pageId, quizNo])
      }
    } else {
      const id = pageId + ':' + quizNo
      const snap = meta?.snapshot ? JSON.stringify(meta.snapshot) : ''
      const title = meta?.pageTitle ?? ''
      execP(
        `INSERT INTO ${table} (id, page_id, quiz_no, page_title, is_favorite, wrong_count, correct_count, last_result, streak_correct, note, snapshot_json, source_space, source_notebook, source_chapter, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, '', ?, '', '', '', ${now}, ${now})`,
        [id, pageId, quizNo, title, correct ? 0 : 1, correct ? 0 : 1, correct ? 1 : 0, correct ? 1 : 0, snap]
      )
    }
    saveToDisk()
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** 插件模式收藏切换：翻转插件表 records.is_favorite */
export function pluginToggleFavoriteRecord(pluginId: string, pageId: string, quizNo: number): { ok: boolean; favorite: boolean; error?: string } {
  const table = phys('records')
  if (!tableExists(table)) return { ok: false, favorite: false }
  try {
    const row = queryAllP<{ id: string; is_favorite: number }>(
      `SELECT id, is_favorite FROM ${table} WHERE page_id = ? AND quiz_no = ?`, [pageId, quizNo]
    )[0]
    if (!row) return { ok: false, favorite: false }
    const next = row.is_favorite ? 0 : 1
    execP(`UPDATE ${table} SET is_favorite = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [next, row.id])
    saveToDisk()
    return { ok: true, favorite: !!next }
  } catch {
    return { ok: false, favorite: false }
  }
}

/** 导出主表全量为 JSON（备份） */
export function exportQuizData(): { ok: boolean; path?: string; data?: Record<string, unknown[]>; error?: string } {
  try {
    const data: Record<string, unknown[]> = {}
    for (const m of MIGRATION_MAP) {
      data[m.to] = tableExists(m.from) ? queryAll(`SELECT * FROM ${m.from}`) : []
    }
    const dir = join(app.getPath('userData'), 'backups')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = join(dir, `quiz-migration-${Date.now()}.json`)
    writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2), 'utf-8')
    return { ok: true, path: file, data }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/**
 * 主表 → 插件表（复制，不删源）。
 * dryRun=true 时只统计不落盘；否则先备份再写入，INSERT OR REPLACE 保证幂等。
 */
export function migrateToPlugin(opts?: { dryRun?: boolean; backup?: boolean }): {
  ok: boolean; dryRun: boolean; moved: Record<string, number>; backupPath?: string; error?: string
} {
  const moved: Record<string, number> = {}
  try {
    if (!opts?.dryRun) ensurePluginTables(QUIZBOOK_PLUGIN_ID, QUIZBOOK_TABLES)
    let backupPath: string | undefined
    if (!opts?.dryRun && opts?.backup !== false) {
      const b = exportQuizData()
      backupPath = b.path
    }
    for (const m of MIGRATION_MAP) {
      if (!tableExists(m.from)) { moved[m.to] = 0; continue }
      // 主表可能缺新列（老库未跑迁移），只取实际存在的列
      const existing = queryAll<{ name: string }>(`PRAGMA table_info(${m.from})`).map(r => r.name)
      const cols = m.cols.filter(c => existing.includes(c))
      const src = cols.join(', ')
      moved[m.to] = countRows(m.from)
      if (opts?.dryRun) continue
      exec(`INSERT OR REPLACE INTO ${phys(m.to)} (${src}) SELECT ${src} FROM ${m.from}`)
    }
    if (!opts?.dryRun) saveToDisk()
    return { ok: true, dryRun: !!opts?.dryRun, moved, backupPath }
  } catch (e: unknown) {
    return { ok: false, dryRun: !!opts?.dryRun, moved, error: String((e as Error)?.message || e) }
  }
}

/**
 * 回滚：插件表 → 主表（反向覆盖，不删插件表）。
 * 主表缺列时（老库）跳过该列，避免回滚失败。
 */
export function migrateFromPlugin(): { ok: boolean; moved: Record<string, number>; error?: string } {
  const moved: Record<string, number> = {}
  try {
    for (const m of MIGRATION_MAP) {
      if (!tableExists(phys(m.to))) { moved[m.to] = 0; continue }
      const existing = queryAll<{ name: string }>(`PRAGMA table_info(${m.from})`).map(r => r.name)
      const cols = m.cols.filter(c => existing.includes(c))
      if (cols.length === 0) { moved[m.to] = 0; continue }
      const src = cols.join(', ')
      moved[m.to] = countRows(phys(m.to))
      exec(`INSERT OR REPLACE INTO ${m.from} (${src}) SELECT ${src} FROM ${phys(m.to)}`)
    }
    saveToDisk()
    return { ok: true, moved }
  } catch (e: unknown) {
    return { ok: false, moved, error: String((e as Error)?.message || e) }
  }
}

/** 删除插件表（用户确认不再需要插件版时使用；调用前应先导出备份） */
export function dropPluginData(): { ok: boolean; error?: string } {
  try {
    dropPluginTables(QUIZBOOK_PLUGIN_ID, QUIZBOOK_TABLES)
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}
