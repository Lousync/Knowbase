import type { Migration } from './types'

export const m044PluginAuditLogMigration: Migration = {
  name: '044_plugin_audit_log',
  up: (db) => {
    // 插件/AI 工具行为审计日志：安装、授权变更、工具调用等追加式记录（见 .claude/plans/plugin-security-tiers.md 第八节）
    // created_at 用本地时间：月度调用量按用户感知的自然月统计
    db.run(`
      CREATE TABLE IF NOT EXISTS plugin_audit_log (
        id         TEXT PRIMARY KEY,
        plugin_id  TEXT NOT NULL DEFAULT '',
        action     TEXT NOT NULL,
        detail     TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_pal_created ON plugin_audit_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_pal_action ON plugin_audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_plugin_audit ON plugin_audit_log(plugin_id, created_at);
    `)
  },
}
