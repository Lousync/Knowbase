import type { Migration } from './types'

/**
 * 053_quiz_tags
 * 1) quiz_records 补 source_chapter：题目所在页面的章节路径（如"树 › 遍历"），
 *    供错题本按章节/小节归档（原快照只存了空间+笔记本，章节层级丢失）
 * 2) 标签体系：quiz_tags（考点/题型/难度/关键词）+ quiz_record_tags（多对多）
 * 3) 存量回填：按当前知识库结构重新计算已有记录的章节路径
 */
export const m053QuizTagsMigration: Migration = {
  name: '053_quiz_tags',
  up: (db) => {
    const cols = new Set(
      (db.exec('PRAGMA table_info(quiz_records)')[0]?.values ?? []).map((r: unknown[]) => String(r[1]))
    )
    if (!cols.has('source_chapter')) {
      db.run("ALTER TABLE quiz_records ADD COLUMN source_chapter TEXT NOT NULL DEFAULT ''")
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS quiz_tags (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'custom',
        color       TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS quiz_record_tags (
        record_id TEXT NOT NULL,
        tag_id    TEXT NOT NULL,
        PRIMARY KEY (record_id, tag_id)
      );
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_quiz_record_tags_tag ON quiz_record_tags(tag_id)')
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_tags_name_kind ON quiz_tags(name, kind)')

    // ---- 存量回填章节路径 ----
    backfillSourceChapter(db)
  },
}

/** 查某条记录（page_id）所在页面的章节路径：笔记本以下的 folder 层级，由外到内用 " › " 连接 */
function backfillSourceChapter(db: any): void {
  let rows: Array<[string, string]> = []
  try {
    const res = db.exec('SELECT id, page_id FROM quiz_records')
    rows = (res[0]?.values ?? []) as Array<[string, string]>
  } catch { return }

  for (const [id, pageId] of rows) {
    if (!pageId) continue
    let chapter = ''
    try {
      const pageRes = db.exec('SELECT category_id FROM knowledge_pages WHERE id = ?', [pageId])
      let curId = (pageRes[0]?.values?.[0]?.[0] as string | null) ?? null
      const folders: string[] = []
      let guard = 0
      while (curId && guard++ < 12) {
        const catRes = db.exec('SELECT parent_id, name, category_type FROM knowledge_categories WHERE id = ?', [curId])
        const row = catRes[0]?.values?.[0] as [string | null, string, string] | undefined
        if (!row) break
        const [parentId, name, type] = row
        // 只收集笔记本以下的 folder（章节/小节）；遇到 notebook/space 停止
        if (type === 'notebook' || type === 'space') break
        if (type === 'folder' && name) folders.unshift(name)
        curId = parentId
      }
      chapter = folders.join(' › ')
    } catch { chapter = '' }
    if (chapter) {
      try { db.run('UPDATE quiz_records SET source_chapter = ? WHERE id = ?', [chapter, id]) } catch { /* ignore */ }
    }
  }
}
