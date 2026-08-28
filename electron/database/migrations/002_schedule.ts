import type { Migration } from './types'

export const m002ScheduleMigration: Migration = {
  name: '002_schedule',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_todos (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT DEFAULT '',
        date        TEXT NOT NULL,
        time        TEXT,
        quadrant    INTEGER DEFAULT 1,
        task_type   TEXT DEFAULT 'plan',
        tag_id      TEXT,
        status      TEXT DEFAULT 'pending',
        sort_order  INTEGER DEFAULT 0,
        end_criteria TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS schedule_tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6b7280'
      );

      CREATE INDEX IF NOT EXISTS idx_stodos_date ON schedule_todos(date);
      CREATE INDEX IF NOT EXISTS idx_stodos_status ON schedule_todos(status);
    `)
  },
}
