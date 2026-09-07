import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dropPluginTables, ensurePluginTables, pluginDumpTable, pluginInsert, pluginUpdate } from './pluginDataStore'
import type { PluginTableDef } from './pluginDataStore'

/**
 * 错题本插件数据通道（R6 去库化后 JSON 版）。
 *
 * 历史：错题本拆 C 级模块插件时，数据在「主库主表 ⇄ 插件命名空间表」间迁移
 * （sqlite 时代，MIGRATION_MAP + migrateTo/FromPlugin）。R6 D9 彻底 JSON 化后：
 * - 主库/sql.js 已退役 → 主表不复存在，迁移语义随之终结
 * - 插件命名空间数据改走 pluginDataStore 的 JSON 桶（userData/data/plugin-data.json）
 * - 本文件只剩：plugin 模式的实时记录通道（判题上报/收藏切换）+ 导出备份 + 清空
 * - 旧 migrateTo/FromPlugin 通道已随主表删除（QuizMigratePanel 同步精简）
 */

/** 错题本插件 id（与插件 manifest 保持一致） */
export const QUIZBOOK_PLUGIN_ID = 'knowbase.quizbook'

/** 插件自有表结构（与插件 manifest contributes.tables 一致；JSON 桶按需自动建，定义作列白名单） */
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

/** 本地时间戳（对齐 sqlite datetime('now','localtime') 与 quizVaultRepo.vaultLocalNow 格式） */
function localNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 按 (page_id, quiz_no) 在 JSON 桶内定位记录（含 rowid，供 pluginUpdate 定位） */
function findRecord(pageId: string, quizNo: number): Record<string, unknown> | null {
  const rows = pluginDumpTable(QUIZBOOK_PLUGIN_ID, QUIZBOOK_TABLES, 'records') as Array<Record<string, unknown>>
  return rows.find((r) => r.page_id === pageId && Number(r.quiz_no) === quizNo) ?? null
}

/**
 * 插件模式判题上报：写 JSON 桶 records（与内置版语义一致：
 * 答对 correct_count+1 / streak_correct+1 / last_result=1；
 * 答错 wrong_count+1 / streak_correct=0 / last_result=0；不存在则插入）。
 * 按 (page_id, quiz_no) 定位，幂等。
 */
export function pluginReportRecord(pluginId: string, pageId: string, quizNo: number, correct: boolean, meta?: {
  pageTitle?: string
  snapshot?: unknown
}): { ok: boolean; error?: string } {
  try {
    const now = localNow()
    const existing = findRecord(pageId, quizNo)
    if (existing) {
      const rid = Number(existing.rowid)
      if (correct) {
        pluginUpdate(pluginId, QUIZBOOK_TABLES, 'records', rid, {
          correct_count: Number(existing.correct_count ?? 0) + 1,
          streak_correct: Number(existing.streak_correct ?? 0) + 1,
          last_result: 1,
          updated_at: now,
        })
      } else {
        pluginUpdate(pluginId, QUIZBOOK_TABLES, 'records', rid, {
          wrong_count: Number(existing.wrong_count ?? 0) + 1,
          streak_correct: 0,
          last_result: 0,
          updated_at: now,
        })
      }
    } else {
      ensurePluginTables(pluginId, QUIZBOOK_TABLES)
      pluginInsert(pluginId, QUIZBOOK_TABLES, 'records', {
        id: pageId + ':' + quizNo,
        page_id: pageId,
        quiz_no: quizNo,
        page_title: meta?.pageTitle ?? '',
        is_favorite: 0,
        wrong_count: correct ? 0 : 1,
        correct_count: correct ? 1 : 0,
        last_result: correct ? 1 : 0,
        streak_correct: correct ? 1 : 0,
        note: '',
        snapshot_json: meta?.snapshot ? JSON.stringify(meta.snapshot) : '',
        source_space: '',
        source_notebook: '',
        source_chapter: '',
        created_at: now,
        updated_at: now,
      })
    }
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** 插件模式收藏切换：翻转 JSON 桶 records.is_favorite */
export function pluginToggleFavoriteRecord(pluginId: string, pageId: string, quizNo: number): { ok: boolean; favorite: boolean; error?: string } {
  try {
    const row = findRecord(pageId, quizNo)
    if (!row) return { ok: false, favorite: false }
    const next = row.is_favorite ? 0 : 1
    const r = pluginUpdate(pluginId, QUIZBOOK_TABLES, 'records', Number(row.rowid), { is_favorite: next, updated_at: localNow() })
    return { ok: r.ok, favorite: !!next }
  } catch {
    return { ok: false, favorite: false }
  }
}

/**
 * 迁移状态（主表/sql.js 已退役，main 恒为 0——保留通道签名兼容既有 UI，
 * QuizMigratePanel 据此显示「无需迁移」）。
 */
export function migrationStatus(): {
  main: Record<string, number>
  plugin: Record<string, number>
  pluginTablesExist: boolean
} {
  const plugin: Record<string, number> = {}
  for (const t of QUIZBOOK_TABLES) {
    plugin[t.name] = pluginDumpTable(QUIZBOOK_PLUGIN_ID, QUIZBOOK_TABLES, t.name).length
  }
  return { main: {}, plugin, pluginTablesExist: (plugin.records ?? 0) > 0 }
}

/** 导出插件表全量为 JSON（备份） */
export function exportQuizData(): { ok: boolean; path?: string; data?: Record<string, unknown[]>; error?: string } {
  try {
    const data: Record<string, unknown[]> = {}
    for (const t of QUIZBOOK_TABLES) {
      data[t.name] = pluginDumpTable(QUIZBOOK_PLUGIN_ID, QUIZBOOK_TABLES, t.name)
    }
    const dir = join(app.getPath('userData'), 'backups')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = join(dir, `quiz-plugin-backup-${Date.now()}.json`)
    writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2), 'utf-8')
    return { ok: true, path: file, data }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** 清空插件数据（用户确认不再需要插件版数据时使用；调用前应先导出备份） */
export function dropPluginData(): { ok: boolean; error?: string } {
  try {
    dropPluginTables(QUIZBOOK_PLUGIN_ID, QUIZBOOK_TABLES)
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}
