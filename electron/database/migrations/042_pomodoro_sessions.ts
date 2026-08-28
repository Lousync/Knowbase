import type { Migration } from './types'

export const m042PomodoroSessionsMigration: Migration = {
  name: '042_pomodoro_sessions',
  up: (db) => {
    // 番茄钟专注记录：每自然完成一次专注写入一行（分钟数按预设时长）
    db.run(`
      CREATE TABLE IF NOT EXISTS pomodoro_sessions (
        id         TEXT PRIMARY KEY,
        minutes    INTEGER NOT NULL,
        date       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_pomodoro_date ON pomodoro_sessions(date);
    `)
  },
}
