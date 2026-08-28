import type { Migration } from './types'

export const m009SubtasksMigration: Migration = {
  name: '009_subtasks',
  up: (db) => {
    try { db.run("ALTER TABLE schedule_todos ADD COLUMN parent_id TEXT") } catch { /* column may already exist */ }
    db.run("CREATE INDEX IF NOT EXISTS idx_stodos_parent ON schedule_todos(parent_id)")
  },
}
