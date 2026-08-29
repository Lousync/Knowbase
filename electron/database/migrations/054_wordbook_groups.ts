import type { Migration } from './types'

export const m054WordbookGroupsMigration: Migration = {
  name: '054_wordbook_groups',
  up: (db) => {
    // 自定义词汇分组（话题归类）：用户建组（如「经济类」「法律类」），一词可入多组。
    // 词根聚合不落库——由词典数据即时推导。
    db.run(`
      CREATE TABLE IF NOT EXISTS wordbook_groups (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS wordbook_group_words (
        group_id TEXT NOT NULL,
        word     TEXT NOT NULL,
        PRIMARY KEY (group_id, word)
      );
    `)
  },
}
