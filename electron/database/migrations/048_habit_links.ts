import type { Migration } from './types'

export const m048HabitLinksMigration: Migration = {
  name: '048_habit_links',
  up: (db) => {
    // 习惯跨模块自动打卡：习惯 ↔ 行为来源绑定（值不落表，触发时从各模块源表按业务日期反查现值）
    db.run(`
      CREATE TABLE IF NOT EXISTS habit_links (
        id         TEXT PRIMARY KEY,
        habit_id   TEXT NOT NULL,
        source     TEXT NOT NULL,   -- blog | pomodoro | schedule | knowledge
        threshold  INTEGER NOT NULL DEFAULT 1,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_hl_habit ON habit_links(habit_id);
      CREATE INDEX IF NOT EXISTS idx_hl_lookup ON habit_links(source, enabled);
    `)
    // 打卡记录溯源：区分手动与自动，供界面标注与手动撤销
    db.run("ALTER TABLE habit_records ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
  },
}
