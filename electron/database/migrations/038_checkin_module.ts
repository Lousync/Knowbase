import type { Migration } from './types'

export const m038CheckinModuleMigration: Migration = {
  name: '038_checkin_module',
  up: (db) => {
    // 打卡模块：习惯定义 + 每日打卡记录（纯勾选模型，某天有记录即已打卡）
    db.run(`
      CREATE TABLE IF NOT EXISTS habits (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        color         TEXT NOT NULL DEFAULT '#3B82F6',
        icon          TEXT NOT NULL DEFAULT 'check',
        rule_type     TEXT NOT NULL DEFAULT 'daily',
        rule_days     TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,0]',
        weekly_target INTEGER NOT NULL DEFAULT 3,
        sort_order    REAL NOT NULL DEFAULT 0,
        archived      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS habit_records (
        id         TEXT PRIMARY KEY,
        habit_id   TEXT NOT NULL,
        date       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(habit_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_habit_records_date ON habit_records(date);
    `)
  },
}
