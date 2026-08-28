import type { Migration } from './types'

export const m003ScheduleEndCriteriaMigration: Migration = {
  name: '003_schedule_end_criteria',
  up: (db) => {
    // Add end_criteria column for existing databases
    try { db.run("ALTER TABLE schedule_todos ADD COLUMN end_criteria TEXT DEFAULT ''") } catch { /* column may already exist */ }
  },
}
