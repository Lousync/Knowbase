import type { Migration } from './types'

export const m040SuperviseModuleMigration: Migration = {
  name: '040_supervise_module',
  up: (db) => {
    // 远程监督：推送日志 + 配置（KV 存表，避免依赖 settings 模块）
    db.run(`
      CREATE TABLE IF NOT EXISTS supervise_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        push_type     TEXT NOT NULL,
        habit_id      TEXT,
        title         TEXT NOT NULL,
        content       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        retry_count   INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        pushed_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_supervise_log_created ON supervise_log(created_at);
      CREATE TABLE IF NOT EXISTS supervise_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  },
}
