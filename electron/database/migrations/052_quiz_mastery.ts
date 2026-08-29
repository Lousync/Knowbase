import type { Migration } from './types'

export const m052QuizMasteryMigration: Migration = {
  name: '052_quiz_mastery',
  up: (db) => {
    // 错题本掌握机制：连续答对 2 次才算掌握移出（streak_correct），
    // 答对不再把 wrong_count 归零（保留历史错次供档位分层）；note 为个人备注。
    const cols = new Set(
      (db.exec('PRAGMA table_info(quiz_records)')[0]?.values ?? [])
        .map((r: unknown[]) => String(r[1]))
    )
    if (!cols.has('streak_correct')) {
      db.run("ALTER TABLE quiz_records ADD COLUMN streak_correct INTEGER NOT NULL DEFAULT 0")
    }
    if (!cols.has('note')) {
      db.run("ALTER TABLE quiz_records ADD COLUMN note TEXT NOT NULL DEFAULT ''")
    }
  },
}
