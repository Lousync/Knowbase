import { getDatabase, saveToDisk } from '../connection'

/** 划词翻译缓存（迁移 050）：LLM 结果按 cache_key 幂等复用 */

export interface TranslationCacheRow {
  cache_key: string
  mode: string
  source_text: string
  result_md: string
  model: string
  created_at: string
  updated_at: string
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDatabase().prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

export function getTranslationCache(key: string): TranslationCacheRow | null {
  const rows = queryAll<TranslationCacheRow>('SELECT * FROM translation_cache WHERE cache_key = ?', [key])
  return rows.length > 0 ? rows[0] : null
}

export function upsertTranslationCache(key: string, mode: string, sourceText: string, resultMd: string, model: string): void {
  run(
    `INSERT INTO translation_cache (cache_key, mode, source_text, result_md, model)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       result_md = excluded.result_md,
       model = excluded.model,
       updated_at = datetime('now', 'localtime')`,
    [key, mode, sourceText, resultMd, model]
  )
}
