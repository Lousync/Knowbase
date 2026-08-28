import type { Migration } from './types'

export const m030WeightTrackerMigration: Migration = {
  name: '030_weight_tracker',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS toolbox_weight_records (
        id          TEXT PRIMARY KEY,
        weight      REAL NOT NULL,
        date        TEXT NOT NULL,
        series      TEXT NOT NULL DEFAULT 'default',
        note        TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_weight_date ON toolbox_weight_records(date);
      CREATE INDEX IF NOT EXISTS idx_weight_series ON toolbox_weight_records(series);
    `)
  },
}
