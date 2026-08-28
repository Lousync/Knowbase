import type { Migration } from './types'
import { randomUUID } from 'crypto'

export const m015DedupEntriesMigration: Migration = {
  name: '015_dedup_entries',
  up: (db) => {
    // Remove duplicate entries for the same date: keep the earliest-created one,
    // move the rest to recycle bin so no data is silently lost.
    try {
      const dupes = db.exec(
        `SELECT date, COUNT(*) as cnt FROM entries GROUP BY date HAVING cnt > 1`
      )
      if (dupes.length > 0 && dupes[0].values) {
        for (const row of dupes[0].values) {
          const date = row[0] as string
          // Get all entries for this date, ordered by created_at — keep the first
          const stmt = db.prepare('SELECT * FROM entries WHERE date = ? ORDER BY created_at ASC')
          stmt.bind([date])
          const entries: Record<string, unknown>[] = []
          while (stmt.step()) entries.push(stmt.getAsObject())
          stmt.free()
          // Keep the first, soft-delete the rest into recycle bin
          for (let i = 1; i < entries.length; i++) {
            const e = entries[i]
            const entryId = e.id as string
            // Get tags for this entry
            const tStmt = db.prepare(
              `SELECT t.id, t.name, t.color FROM tags t
               JOIN entry_tags et ON t.id = et.tag_id
               WHERE et.entry_id = ?`
            )
            tStmt.bind([entryId])
            const tags: Record<string, unknown>[] = []
            while (tStmt.step()) tags.push(tStmt.getAsObject())
            tStmt.free()
            const data = JSON.stringify({ ...e, tags, contentHtml: (e as Record<string, unknown>).content_html || '' })
            const binId = randomUUID()
            db.run(
              `INSERT INTO recycle_bin (id, original_id, module, title, data) VALUES (?, ?, 'blog', ?, ?)`,
              [binId, entryId, (e as Record<string, unknown>).title || '', data]
            )
            db.run('DELETE FROM entries WHERE id = ?', [entryId])
          }
        }
      }
    } catch (_) { /* ignore dedup errors */ }
  },
}
