import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dropPluginTables, pluginDumpTable } from './pluginDataStore'
import type { PluginTableDef } from './pluginDataStore'

/**
 * 错题本插件数据通道（R6 去库化后 JSON 版）。
 *
 * 历史：错题本拆 C 级模块插件时，数据在「主库主表 ⇄ 插件命名空间表」间迁移
 * （sqlite 时代，MIGRATION_MAP + migrateTo/FromPlugin）。R6 D9 彻底 JSON 化后：
 * - 主库/sql.js 已退役 → 主表不复存在，迁移语义随之终结
 * - 插件命名空间数据改走 pluginDataStore 的 JSON 桶（userData/data/plugin-data.json）
 * - 本文件只剩：导出备份 + 清空（回收三件套，无新写入通道）
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

// 回收三件套（migrationStatus / exportQuizData / dropPluginData）见下方。
// 原 plugin 模式实时写入通道（pluginReportRecord / pluginToggleFavoriteRecord）已随错题本全内置改造删除。

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
