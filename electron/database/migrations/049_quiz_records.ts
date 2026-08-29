import type { Migration } from './types'

export const m049QuizRecordsMigration: Migration = {
  name: '049_quiz_records',
  up: (db) => {
    // 刷题记录：收藏 + 错题合一（一题一行，UNIQUE 去重计数）
    // 数学/英语/政治/408 知识包通用，靠 source_space 快照区分来源
    db.run(`
      CREATE TABLE IF NOT EXISTS quiz_records (
        id              TEXT PRIMARY KEY,
        page_id         TEXT NOT NULL,
        quiz_no         INTEGER NOT NULL,
        page_title      TEXT NOT NULL DEFAULT '',
        is_favorite     INTEGER NOT NULL DEFAULT 0,
        wrong_count     INTEGER NOT NULL DEFAULT 0,
        correct_count   INTEGER NOT NULL DEFAULT 0,
        last_result     INTEGER,
        snapshot_json   TEXT NOT NULL DEFAULT '',
        source_space    TEXT NOT NULL DEFAULT '',
        source_notebook TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        UNIQUE(page_id, quiz_no)
      );
      CREATE INDEX IF NOT EXISTS idx_quiz_records_page ON quiz_records(page_id);
      CREATE INDEX IF NOT EXISTS idx_quiz_records_fav ON quiz_records(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_quiz_records_wrong ON quiz_records(wrong_count);
    `)
    // 自定义分组（"新建本子分类"）：用户可建「马原易错」「计算题」等分组，一题可归多组
    db.run(`
      CREATE TABLE IF NOT EXISTS quiz_collections (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS quiz_record_collections (
        record_id     TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        PRIMARY KEY (record_id, collection_id)
      );
    `)
  },
}
