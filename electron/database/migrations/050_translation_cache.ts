import type { Migration } from './types'

export const m050TranslationCacheMigration: Migration = {
  name: '050_translation_cache',
  up: (db) => {
    // 划词翻译缓存：LLM 翻译/AI 精讲结果按 cache_key 去重，
    // cache_key = 模式前缀 + 原文哈希（word:<word> / sent:<sha1>），重复划词不再消耗 token
    db.run(`
      CREATE TABLE IF NOT EXISTS translation_cache (
        cache_key   TEXT PRIMARY KEY,
        mode        TEXT NOT NULL,
        source_text TEXT NOT NULL,
        result_md   TEXT NOT NULL,
        model       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_translation_cache_mode ON translation_cache(mode);
    `)
  },
}
