import type { Migration } from './types'

export const m051WordbookMigration: Migration = {
  name: '051_wordbook',
  up: (db) => {
    // 生词本：一行一个词。SRS 用简化 SM-2（interval_days/ease/streak），
    // status=mastered 即「斩词」：保留词条与统计，但不再进入复习队列。
    db.run(`
      CREATE TABLE IF NOT EXISTS wordbook_entries (
        word           TEXT PRIMARY KEY,
        status         TEXT NOT NULL DEFAULT 'learning',
        source         TEXT NOT NULL DEFAULT 'manual',
        added_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        first_answer_at TEXT,
        last_review_at TEXT,
        due_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        interval_days  REAL NOT NULL DEFAULT 0,
        ease           REAL NOT NULL DEFAULT 2.5,
        streak         INTEGER NOT NULL DEFAULT 0,
        review_count   INTEGER NOT NULL DEFAULT 0,
        correct_count  INTEGER NOT NULL DEFAULT 0,
        fuzzy_count    INTEGER NOT NULL DEFAULT 0,
        wrong_count    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_wordbook_due ON wordbook_entries(status, due_at);
    `)
    // 每日学习量（打卡联动反查源 + 连续天数计算）
    db.run(`
      CREATE TABLE IF NOT EXISTS wordbook_daily (
        date      TEXT PRIMARY KEY,
        new_words INTEGER NOT NULL DEFAULT 0,
        reviewed  INTEGER NOT NULL DEFAULT 0
      );
    `)
  },
}
