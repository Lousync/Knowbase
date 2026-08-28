import type { Migration } from './types'

// 019 — normalize file_type: lowercase, strip leading dot
export const m019NormalizeFileTypeMigration: Migration = {
  name: '019_normalize_file_type',
  up: (db) => {
    // Update rows where file_type starts with '.'
    db.run("UPDATE knowledge_pages SET file_type = LOWER(SUBSTR(file_type, 2)) WHERE file_type LIKE '.%'")
    // Update rows where file_type has uppercase letters
    db.run("UPDATE knowledge_pages SET file_type = LOWER(file_type) WHERE file_type != LOWER(file_type)")
  },
}
