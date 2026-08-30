import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { migrationStatus, exportQuizData, migrateToPlugin, migrateFromPlugin, dropPluginData, pluginReportRecord, pluginToggleFavoriteRecord, QUIZBOOK_PLUGIN_ID } from '../../lib/quizMigration'

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
  /** 连续答对次数：>= 2 视为已掌握（从错题本列表移出） */
  streakCorrect: number
  /** 个人备注 */
  note: string
  snapshot: QuizSnapshotDto | null
  sourceSpace: string
  sourceNotebook: string
  /** 题目所在页面的章节路径（笔记本以下的 folder 层级，如"树 › 遍历"） */
  sourceChapter: string
  collectionIds: string[]
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export interface QuizTagDto {
  id: string
  name: string
  /** topic 考点 / type 题型 / difficulty 难度 / custom 关键词 */
  kind: string
  color: string
  sortOrder: number
  createdAt: string
  count: number
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
  streak_correct?: number; note?: string; source_chapter?: string
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

/**
 * 解析题目来源：空间 / 笔记本 / 章节路径。
 * 章节 = 笔记本以下所有 folder 层级（由外到内，如"树 › 遍历"）——
 * 原题快照只存 space+notebook 导致归档最细只能到笔记本，这里补上章节层级。
 */
function resolveSource(pageId: string): { space: string; notebook: string; chapter: string } {
  let space = ''
  let notebook = ''
  const page = queryAll<{ category_id: string }>('SELECT category_id FROM knowledge_pages WHERE id = ?', [pageId])[0]
  if (!page) return { space, notebook, chapter: '' }
  const folders: string[] = []
  let curId: string | null = page.category_id
  let guard = 0
  while (curId && guard++ < 12) {
    const cat: { parent_id: string | null; name: string; category_type: string } | undefined = queryAll<{ parent_id: string | null; name: string; category_type: string }>(
      'SELECT parent_id, name, category_type FROM knowledge_categories WHERE id = ?', [curId]
    )[0]
    if (!cat) break
    if (cat.category_type === 'notebook') { notebook = cat.name; break }
    if (cat.category_type === 'space') { space = cat.name; break }
    if (cat.category_type === 'folder' && cat.name) folders.unshift(cat.name)
    curId = cat.parent_id
  }
  return { space, notebook, chapter: folders.join(' › ') }
}

function collectionIdsOf(recordId: string): string[] {
  return queryAll<{ collection_id: string }>(
    'SELECT collection_id FROM quiz_record_collections WHERE record_id = ?', [recordId]
  ).map(r => r.collection_id)
}

function tagIdsOf(recordId: string): string[] {
  return queryAll<{ tag_id: string }>(
    'SELECT tag_id FROM quiz_record_tags WHERE record_id = ?', [recordId]
  ).map(r => r.tag_id)
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
    streakCorrect: row.streak_correct ?? 0,
    note: row.note ?? '',
    snapshot: parseSnapshot(row.snapshot_json),
    sourceSpace: row.source_space,
    sourceNotebook: row.source_notebook,
    sourceChapter: row.source_chapter ?? '',
    collectionIds: collectionIdsOf(row.id),
    tagIds: tagIdsOf(row.id),
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
  const { space, notebook, chapter } = resolveSource(pageId)
  const id = randomUUID()
  run(
    `INSERT INTO quiz_records (id, page_id, quiz_no, page_title, is_favorite, wrong_count, correct_count, last_result, snapshot_json, source_space, source_notebook, source_chapter)
     VALUES (?, ?, ?, ?, 0, 0, 0, NULL, ?, ?, ?, ?)`,
    [id, pageId, quizNo, meta.pageTitle, meta.snapshot ? JSON.stringify(meta.snapshot) : '', space, notebook, chapter]
  )
  return queryAll<RecordRow>('SELECT * FROM quiz_records WHERE id = ?', [id])[0]
}

/**
 * 判题/收藏上报的存储目标：
 * - quizbookMode=plugin 且插件表存在 → 写插件命名空间表（错题本彻底插件化）
 * - 否则 → 主表（回退/内置模式）
 */
function pluginModeEnabled(getSettingValue?: (key: string) => unknown): boolean {
  try {
    return getSettingValue?.('quizbookMode') === 'plugin'
  } catch { return false }
}

export function registerQuizHandlers(deps?: { getSettingValue?: (key: string) => unknown }): void {
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
    // 彻底插件化：quizbookMode=plugin 时判题直接写插件命名空间表
    if (pluginModeEnabled(deps?.getSettingValue)) {
      pluginReportRecord(QUIZBOOK_PLUGIN_ID, pageId, no, Boolean(correct), {
        pageTitle: typeof meta?.pageTitle === 'string' ? meta.pageTitle : '',
        snapshot: meta?.snapshot ?? null,
      })
      return null
    }
    const row = ensureRecord(pageId, no, {
      pageTitle: typeof meta?.pageTitle === 'string' ? meta.pageTitle : '',
      snapshot: meta?.snapshot ?? null,
    })
    if (correct) {
      // 答对：correct_count+1、连续答对 streak_correct+1；wrong_count 保留（历史错次供档位分层）。
      // 连续答对 2 次（streak_correct >= 2）视为已掌握，从错题本列表移出。
      run(
        "UPDATE quiz_records SET correct_count = correct_count + 1, streak_correct = streak_correct + 1, last_result = 1, updated_at = datetime('now', 'localtime') WHERE id = ?",
        [row.id]
      )
    } else {
      // 答错：wrong_count+1、连续答对清零（回流错题本）
      run(
        "UPDATE quiz_records SET wrong_count = wrong_count + 1, streak_correct = 0, last_result = 0, updated_at = datetime('now', 'localtime') WHERE id = ?",
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
    // 彻底插件化：收藏同样写插件表
    if (pluginModeEnabled(deps?.getSettingValue)) {
      const r = pluginToggleFavoriteRecord(QUIZBOOK_PLUGIN_ID, pageId, no)
      return { id: `${pageId}:${no}`, pageId, quizNo: no, pageTitle: '', isFavorite: r.favorite, wrongCount: 0, correctCount: 0, lastResult: null, streakCorrect: 0, note: '', snapshot: null, sourceSpace: '', sourceNotebook: '', sourceChapter: '', collectionIds: [], tagIds: [], createdAt: '', updatedAt: '' } as QuizRecordDto
    }
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
    tagIds?: string[]
  }) => {
    const kind = opts?.kind ?? 'all'
    const conds: string[] = []
    const params: unknown[] = []
    if (kind === 'favorite') conds.push('r.is_favorite = 1')
    else if (kind === 'wrong') conds.push('r.wrong_count > 0 AND r.streak_correct < 2')
    else conds.push('(r.is_favorite = 1 OR (r.wrong_count > 0 AND r.streak_correct < 2))')
    if (opts?.sourceSpace) { conds.push('r.source_space = ?'); params.push(opts.sourceSpace) }
    if (opts?.collectionId) {
      conds.push('EXISTS (SELECT 1 FROM quiz_record_collections c WHERE c.record_id = r.id AND c.collection_id = ?)')
      params.push(opts.collectionId)
    }
    // 标签筛选：命中任一选中标签即算匹配
    const tagIds = Array.isArray(opts?.tagIds) ? opts!.tagIds!.filter(t => typeof t === 'string' && t) : []
    if (tagIds.length > 0) {
      conds.push(`EXISTS (SELECT 1 FROM quiz_record_tags t WHERE t.record_id = r.id AND t.tag_id IN (${tagIds.map(() => '?').join(',')}))`)
      params.push(...tagIds)
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

  /** 同步 QuizTagDto 的 kind 取值：考点 / 题型 / 难度 / 关键词 */
  const TAG_KINDS = ['topic', 'type', 'difficulty', 'custom']
  function validKind(k: unknown): string {
    return typeof k === 'string' && TAG_KINDS.includes(k) ? k : 'custom'
  }

  const TAG_COLORS: Record<string, string> = {
    topic: '#7f77dd', type: '#378add', difficulty: '#ba7517', custom: '#1d9e75',
  }

  ipcMain.handle('quizTag:list', () => {
    const rows = queryAll<{ id: string; name: string; kind: string; color: string; sort_order: number; created_at: string }>(
      'SELECT * FROM quiz_tags ORDER BY sort_order ASC, created_at ASC'
    )
    return rows.map(t => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      color: t.color || TAG_COLORS[t.kind] || '#888780',
      sortOrder: t.sort_order,
      createdAt: t.created_at,
      count: queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM quiz_record_tags WHERE tag_id = ?', [t.id])[0]?.n ?? 0,
    })) as QuizTagDto[]
  })

  ipcMain.handle('quizTag:create', (_e, name: string, kind?: string) => {
    const nm = typeof name === 'string' ? name.trim().slice(0, 24) : ''
    if (!nm) throw new Error('标签名缺失')
    const k = validKind(kind)
    const exist = queryAll<{ id: string }>('SELECT id FROM quiz_tags WHERE name = ? AND kind = ?', [nm, k])[0]
    if (exist) {
      return queryAll<{ id: string; name: string; kind: string; color: string; sort_order: number; created_at: string }>(
        'SELECT * FROM quiz_tags WHERE id = ?', [exist.id]
      ).map(t => ({ id: t.id, name: t.name, kind: t.kind, color: t.color, sortOrder: t.sort_order, createdAt: t.created_at, count: 0 }))[0] as QuizTagDto
    }
    const id = randomUUID()
    const maxOrder = queryAll<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM quiz_tags')[0]?.m ?? 0
    run('INSERT INTO quiz_tags (id, name, kind, color, sort_order) VALUES (?, ?, ?, ?, ?)', [id, nm, k, TAG_COLORS[k] ?? '', maxOrder])
    return { id, name: nm, kind: k, color: TAG_COLORS[k] ?? '', sortOrder: maxOrder, createdAt: '', count: 0 } as QuizTagDto
  })

  ipcMain.handle('quizTag:delete', (_e, tagId: string) => {
    if (typeof tagId !== 'string' || !tagId) return
    run('DELETE FROM quiz_record_tags WHERE tag_id = ?', [tagId])
    run('DELETE FROM quiz_tags WHERE id = ?', [tagId])
  })

  /** 单题设置标签（整体覆盖） */
  ipcMain.handle('quizRecord:setTags', (_e, recordId: string, tagIds: string[]) => {
    if (typeof recordId !== 'string' || !recordId) throw new Error('recordId 缺失')
    run('DELETE FROM quiz_record_tags WHERE record_id = ?', [recordId])
    for (const tid of Array.isArray(tagIds) ? tagIds : []) {
      if (typeof tid !== 'string' || !tid) continue
      run('INSERT OR IGNORE INTO quiz_record_tags (record_id, tag_id) VALUES (?, ?)', [recordId, tid])
    }
  })

  /** 批量打标：给多条记录追加标签（去重） */
  ipcMain.handle('quizRecord:addTags', (_e, recordIds: string[], tagIds: string[]) => {
    const rids = Array.isArray(recordIds) ? recordIds.filter(x => typeof x === 'string' && x) : []
    const tids = Array.isArray(tagIds) ? tagIds.filter(x => typeof x === 'string' && x) : []
    if (rids.length === 0 || tids.length === 0) return
    for (const rid of rids) {
      for (const tid of tids) {
        run('INSERT OR IGNORE INTO quiz_record_tags (record_id, tag_id) VALUES (?, ?)', [rid, tid])
      }
    }
  })

  ipcMain.handle('quizRecord:setNote', (_e, recordId: string, note: string) => {
    if (typeof recordId !== 'string' || !recordId) throw new Error('recordId 缺失')
    const text = typeof note === 'string' ? note.slice(0, 500) : ''
    run("UPDATE quiz_records SET note = ? WHERE id = ?", [text, recordId])
  })

  ipcMain.handle('quizRecord:stats', (_e, opts?: { sourceSpace?: string }) => {
    const conds: string[] = []
    const params: unknown[] = []
    if (opts?.sourceSpace) { conds.push('r.source_space = ?'); params.push(opts.sourceSpace) }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
    const agg = queryAll<{ wrong: number; mastered: number; today_wrong: number; sum_correct: number; sum_wrong: number }>(
      `SELECT
        SUM(CASE WHEN r.wrong_count > 0 AND r.streak_correct < 2 THEN 1 ELSE 0 END) AS wrong,
        SUM(CASE WHEN r.wrong_count > 0 AND r.streak_correct >= 2 THEN 1 ELSE 0 END) AS mastered,
        SUM(CASE WHEN r.last_result = 0 AND date(r.updated_at) = date('now', 'localtime') THEN 1 ELSE 0 END) AS today_wrong,
        SUM(r.correct_count) AS sum_correct,
        SUM(r.wrong_count) AS sum_wrong
       FROM quiz_records r ${where}`,
      params
    )[0] ?? { wrong: 0, mastered: 0, today_wrong: 0, sum_correct: 0, sum_wrong: 0 }
    const total = (agg.sum_correct ?? 0) + (agg.sum_wrong ?? 0)
    return {
      wrong: agg.wrong ?? 0,
      mastered: agg.mastered ?? 0,
      todayWrong: agg.today_wrong ?? 0,
      correctRate: total > 0 ? Math.round(((agg.sum_correct ?? 0) / total) * 100) : 0,
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

  // ===== 数据迁移（P2：主表 ⇄ 插件命名空间表） =====

  ipcMain.handle('quizMigrate:status', () => migrationStatus())
  ipcMain.handle('quizMigrate:export', () => exportQuizData())
  ipcMain.handle('quizMigrate:toPlugin', (_e, opts?: { dryRun?: boolean; backup?: boolean }) => migrateToPlugin(opts))
  ipcMain.handle('quizMigrate:fromPlugin', () => migrateFromPlugin())
  ipcMain.handle('quizMigrate:dropPluginData', () => dropPluginData())

  // 插件模式判题上报 / 收藏切换（写入插件命名空间表）
  ipcMain.handle('quiz:pluginReport', (_e, pluginId: string, pageId: string, quizNo: number, correct: boolean, meta?: { pageTitle?: string; snapshot?: unknown }) => {
    return pluginReportRecord(pluginId, pageId, Number(quizNo), Boolean(correct), meta)
  })
  ipcMain.handle('quiz:pluginToggleFavorite', (_e, pluginId: string, pageId: string, quizNo: number) => {
    return pluginToggleFavoriteRecord(pluginId, pageId, Number(quizNo))
  })
}
