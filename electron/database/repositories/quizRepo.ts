import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

/**
 * 刷题记录（收藏 + 错题）数据层。
 * 通用能力：408 / 数学 / 英语 / 政治知识包共用一套，靠 source_space 快照区分来源。
 * - 收藏与错题同表（一题一行，UNIQUE(page_id, quiz_no) 去重计数）
 * - 重刷全对自动移出：答对时 wrong_count 归零
 * - 两级分类：source_space 自动维度 + quiz_collections 自定义分组
 */

export interface QuizOptionDto { key: string; text: string }

export interface QuizSnapshotDto {
  no: number
  question: string
  options: QuizOptionDto[]
  answer: string
  explanation: string
}

export interface QuizRecordDto {
  id: string
  pageId: string
  quizNo: number
  pageTitle: string
  isFavorite: boolean
  wrongCount: number
  correctCount: number
  lastResult: number | null
  snapshot: QuizSnapshotDto | null
  sourceSpace: string
  sourceNotebook: string
  collectionIds: string[]
  createdAt: string
  updatedAt: string
}

export interface QuizCollectionDto {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  count: number
}

interface RecordRow {
  id: string; page_id: string; quiz_no: number; page_title: string
  is_favorite: number; wrong_count: number; correct_count: number; last_result: number | null
  snapshot_json: string; source_space: string; source_notebook: string
  created_at: string; updated_at: string
}

interface CollectionRow { id: string; name: string; sort_order: number; created_at: string }

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
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

function parseSnapshot(json: string): QuizSnapshotDto | null {
  if (!json) return null
  try {
    const v = JSON.parse(json) as QuizSnapshotDto
    if (!v || typeof v !== 'object' || !Array.isArray(v.options)) return null
    return v
  } catch {
    return null
  }
}

function resolveSource(pageId: string): { space: string; notebook: string } {
  let space = ''
  let notebook = ''
  const page = queryAll<{ category_id: string }>('SELECT category_id FROM knowledge_pages WHERE id = ?', [pageId])[0]
  if (!page) return { space, notebook }
  let curId: string | null = page.category_id
  let guard = 0
  while (curId && guard++ < 12) {
    const cat: { parent_id: string | null; name: string; category_type: string } | undefined = queryAll<{ parent_id: string | null; name: string; category_type: string }>(
      'SELECT parent_id, name, category_type FROM knowledge_categories WHERE id = ?', [curId]
    )[0]
    if (!cat) break
    if (cat.category_type === 'notebook') notebook = cat.name
    else if (cat.category_type === 'space') space = cat.name
    curId = cat.parent_id
  }
  return { space, notebook }
}

function collectionIdsOf(recordId: string): string[] {
  return queryAll<{ collection_id: string }>(
    'SELECT collection_id FROM quiz_record_collections WHERE record_id = ?', [recordId]
  ).map(r => r.collection_id)
}

function rowToDto(row: RecordRow): QuizRecordDto {
  return {
    id: row.id,
    pageId: row.page_id,
    quizNo: row.quiz_no,
    pageTitle: row.page_title,
    isFavorite: !!row.is_favorite,
    wrongCount: row.wrong_count ?? 0,
    correctCount: row.correct_count ?? 0,
    lastResult: row.last_result,
    snapshot: parseSnapshot(row.snapshot_json),
    sourceSpace: row.source_space,
    sourceNotebook: row.source_notebook,
    collectionIds: collectionIdsOf(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 查找或创建一条记录（按 page_id + quiz_no 幂等），返回记录行 */
function ensureRecord(pageId: string, quizNo: number, meta: {
  pageTitle: string
  snapshot: QuizSnapshotDto | null
}): RecordRow {
  const existing = queryAll<RecordRow>('SELECT * FROM quiz_records WHERE page_id = ? AND quiz_no = ?', [pageId, quizNo])[0]
  if (existing) return existing
  const { space, notebook } = resolveSource(pageId)
  const id = randomUUID()
  run(
    `INSERT INTO quiz_records (id, page_id, quiz_no, page_title, is_favorite, wrong_count, correct_count, last_result, snapshot_json, source_space, source_notebook)
     VALUES (?, ?, ?, ?, 0, 0, 0, NULL, ?, ?, ?)`,
    [id, pageId, quizNo, meta.pageTitle, meta.snapshot ? JSON.stringify(meta.snapshot) : '', space, notebook]
  )
  return queryAll<RecordRow>('SELECT * FROM quiz_records WHERE id = ?', [id])[0]
}

export function registerQuizHandlers(): void {
  // ===== 记录 =====

  ipcMain.handle('quizRecord:getByPage', (_e, pageId: string) => {
    if (typeof pageId !== 'string' || !pageId) return []
    return queryAll<RecordRow>('SELECT * FROM quiz_records WHERE page_id = ? ORDER BY quiz_no ASC', [pageId]).map(rowToDto)
  })

  ipcMain.handle('quizRecord:report', (_e, pageId: string, quizNo: number, correct: boolean, meta: {
    pageTitle?: string
    snapshot?: QuizSnapshotDto
  }) => {
    if (typeof pageId !== 'string' || !pageId) throw new Error('pageId 缺失')
    const no = Number(quizNo)
    if (!Number.isInteger(no)) throw new Error('quizNo 非法')
    const row = ensureRecord(pageId, no, {
      pageTitle: typeof meta?.pageTitle === 'string' ? meta.pageTitle : '',
      snapshot: meta?.snapshot ?? null,
    })
    if (correct) {
      // 答对：correct_count+1，且 wrong_count 归零（重刷全对自动移出错题本）
      run(
        "UPDATE quiz_records SET correct_count = correct_count + 1, wrong_count = 0, last_result = 1, updated_at = datetime('now', 'localtime') WHERE id = ?",
        [row.id]
      )
    } else {
      run(
        "UPDATE quiz_records SET wrong_count = wrong_count + 1, last_result = 0, updated_at = datetime('now', 'localtime') WHERE id = ?",
        [row.id]
      )
    }
    return rowToDto(queryAll<RecordRow>('SELECT * FROM quiz_records WHERE id = ?', [row.id])[0])
  })

  ipcMain.handle('quizRecord:toggleFavorite', (_e, pageId: string, quizNo: number, meta: {
    pageTitle?: string
    snapshot?: QuizSnapshotDto
  }) => {
    if (typeof pageId !== 'string' || !pageId) throw new Error('pageId 缺失')
    const no = Number(quizNo)
    if (!Number.isInteger(no)) throw new Error('quizNo 非法')
    const row = ensureRecord(pageId, no, {
      pageTitle: typeof meta?.pageTitle === 'string' ? meta.pageTitle : '',
      snapshot: meta?.snapshot ?? null,
    })
    const next = row.is_favorite ? 0 : 1
    run("UPDATE quiz_records SET is_favorite = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [next, row.id])
    return rowToDto(queryAll<RecordRow>('SELECT * FROM quiz_records WHERE id = ?', [row.id])[0])
  })

  ipcMain.handle('quizRecord:list', (_e, opts?: {
    kind?: 'favorite' | 'wrong' | 'all'
    sourceSpace?: string
    collectionId?: string
  }) => {
    const kind = opts?.kind ?? 'all'
    const conds: string[] = []
    const params: unknown[] = []
    if (kind === 'favorite') conds.push('r.is_favorite = 1')
    else if (kind === 'wrong') conds.push('r.wrong_count > 0')
    else conds.push('(r.is_favorite = 1 OR r.wrong_count > 0)')
    if (opts?.sourceSpace) { conds.push('r.source_space = ?'); params.push(opts.sourceSpace) }
    if (opts?.collectionId) {
      conds.push('EXISTS (SELECT 1 FROM quiz_record_collections c WHERE c.record_id = r.id AND c.collection_id = ?)')
      params.push(opts.collectionId)
    }
    const rows = queryAll<RecordRow>(
      `SELECT r.* FROM quiz_records r WHERE ${conds.join(' AND ')} ORDER BY r.updated_at DESC, r.page_id ASC, r.quiz_no ASC`,
      params
    )
    return rows.map(rowToDto)
  })

  ipcMain.handle('quizRecord:remove', (_e, pageId: string, quizNo: number) => {
    const row = queryAll<RecordRow>('SELECT id FROM quiz_records WHERE page_id = ? AND quiz_no = ?', [pageId, Number(quizNo)])[0]
    if (!row) return
    run('DELETE FROM quiz_record_collections WHERE record_id = ?', [row.id])
    run('DELETE FROM quiz_records WHERE id = ?', [row.id])
  })

  ipcMain.handle('quizRecord:setCollections', (_e, recordId: string, collectionIds: string[]) => {
    if (typeof recordId !== 'string' || !recordId) throw new Error('recordId 缺失')
    run('DELETE FROM quiz_record_collections WHERE record_id = ?', [recordId])
    for (const cid of Array.isArray(collectionIds) ? collectionIds : []) {
      if (typeof cid !== 'string' || !cid) continue
      run('INSERT OR IGNORE INTO quiz_record_collections (record_id, collection_id) VALUES (?, ?)', [recordId, cid])
    }
  })

  // ===== 自定义分组 =====

  ipcMain.handle('quizCollection:list', () => {
    const cols = queryAll<CollectionRow>('SELECT * FROM quiz_collections ORDER BY sort_order ASC, created_at ASC')
    return cols.map(c => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sort_order,
      createdAt: c.created_at,
      count: queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM quiz_record_collections WHERE collection_id = ?', [c.id])[0]?.n ?? 0,
    })) as QuizCollectionDto[]
  })

  ipcMain.handle('quizCollection:create', (_e, name: string) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n) throw new Error('分组名不能为空')
    if (n.length > 50) throw new Error('分组名过长')
    const id = randomUUID()
    const maxOrder = queryAll<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM quiz_collections')[0]?.m ?? 0
    run('INSERT INTO quiz_collections (id, name, sort_order) VALUES (?, ?, ?)', [id, n, maxOrder])
    const c = queryAll<CollectionRow>('SELECT * FROM quiz_collections WHERE id = ?', [id])[0]
    return { id: c.id, name: c.name, sortOrder: c.sort_order, createdAt: c.created_at, count: 0 } as QuizCollectionDto
  })

  ipcMain.handle('quizCollection:rename', (_e, id: string, name: string) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n) throw new Error('分组名不能为空')
    if (n.length > 50) throw new Error('分组名过长')
    run('UPDATE quiz_collections SET name = ? WHERE id = ?', [n, id])
    const c = queryAll<CollectionRow>('SELECT * FROM quiz_collections WHERE id = ?', [id])[0]
    if (!c) throw new Error('分组不存在')
    return { id: c.id, name: c.name, sortOrder: c.sort_order, createdAt: c.created_at, count: queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM quiz_record_collections WHERE collection_id = ?', [id])[0]?.n ?? 0 } as QuizCollectionDto
  })

  ipcMain.handle('quizCollection:delete', (_e, id: string) => {
    run('DELETE FROM quiz_record_collections WHERE collection_id = ?', [id])
    run('DELETE FROM quiz_collections WHERE id = ?', [id])
  })
}
