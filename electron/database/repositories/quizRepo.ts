import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getKnowledgeIndex } from '../../lib/kbStore/knowledgeIndex'
import * as V from '../../lib/kbStore/quizVaultRepo'
import { migrationStatus, exportQuizData, migrateToPlugin, migrateFromPlugin, dropPluginData, pluginReportRecord, pluginToggleFavoriteRecord, QUIZBOOK_PLUGIN_ID } from '../../lib/quizMigration'

/**
 * R6 去库化：真相源 = .knowbase/modules/quiz/*.json（sql.js 路径已移除，D9）
 *
 * 刷题记录（收藏 + 错题）数据层。
 * 通用能力：408 / 数学 / 英语 / 政治知识包共用一套，靠 source_space 快照区分来源。
 * - 收藏与错题同表（一题一行，按 (page_id, quiz_no) 幂等去重）
 * - 重刷全对自动移出：连续答对次数达到阈值即视为已掌握
 * - 两级分类：source_space 自动维度 + quiz_collections 自定义分组
 * - 五文件对应原五张表，行结构 snake_case 原样
 *
 * 插件命名空间表（quizbookMode=plugin / quizMigrate:* / quiz:plugin*）仍由
 * quizMigration.ts 管辖，本文件不为其提供 vault 路径。
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

// ===== vault 数据层：真相源 = .knowbase/modules/quiz/*.json =====
// 行结构与原表一致（snake_case）；以下把主表五张表的 SQL 语义逐一用内存过滤/排序复刻，
// 返回 DTO 逐字段保持原语义。插件命名空间表（quizMigrate:* / quiz:plugin*）
// 仍走 quizMigration.ts，此处不为其提供 vault 路径。

/** 字符串比较：对齐 sqlite BINARY collation 的码序比较（时间串/UUID 场景与字典序一致） */
function strCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** quiz_record_collections 关联 → 某记录的 collection_id 列表（文件序=插入序，对齐无 ORDER BY 查询） */
function vaultCollectionIdsOf(recordId: string): string[] {
  return V.readQuizRecordCollections().filter((l) => l.record_id === recordId).map((l) => l.collection_id)
}

/** quiz_record_tags 关联 → 某记录的 tag_id 列表 */
function vaultTagIdsOf(recordId: string): string[] {
  return V.readQuizRecordTags().filter((l) => l.record_id === recordId).map((l) => l.tag_id)
}

function vaultRowToDto(row: V.VaultQuizRecordRow): QuizRecordDto {
  return {
    id: row.id,
    pageId: row.page_id,
    quizNo: row.quiz_no,
    pageTitle: row.page_title,
    isFavorite: !!row.is_favorite,
    wrongCount: row.wrong_count ?? 0,
    correctCount: row.correct_count ?? 0,
    lastResult: row.last_result ?? null,
    streakCorrect: row.streak_correct ?? 0,
    note: row.note ?? '',
    snapshot: parseSnapshot(row.snapshot_json),
    sourceSpace: row.source_space,
    sourceNotebook: row.source_notebook,
    sourceChapter: row.source_chapter ?? '',
    collectionIds: vaultCollectionIdsOf(row.id),
    tagIds: vaultTagIdsOf(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 知识页/分类以知识索引为准：空间 / 笔记本 / 章节路径解析 */
function vaultResolveSource(pageId: string): { space: string; notebook: string; chapter: string } {
  let space = ''
  let notebook = ''
  const idx = getKnowledgeIndex()
  const page = idx.byId[pageId]
  if (!page) return { space, notebook, chapter: '' }
  const catById = new Map(idx.categories.map((c) => [c.id, c]))
  const folders: string[] = []
  let curId: string | null | undefined = page.categoryId
  let guard = 0
  while (curId && guard++ < 12) {
    const cat = catById.get(curId)
    if (!cat) break
    if (cat.categoryType === 'notebook') { notebook = cat.name; break }
    if (cat.categoryType === 'space') { space = cat.name; break }
    if (cat.categoryType === 'folder' && cat.name) folders.unshift(cat.name)
    curId = cat.parentId
  }
  return { space, notebook, chapter: folders.join(' › ') }
}

/** ensureRecord：按 (page_id, quiz_no) 幂等 find-or-create；新行字段对齐原 INSERT 列 + 建表 DEFAULT */
function vaultEnsureRecord(pageId: string, quizNo: number, meta: {
  pageTitle: string
  snapshot: QuizSnapshotDto | null
}): V.VaultQuizRecordRow {
  const rows = V.readQuizRecords()
  const existing = rows.find((r) => r.page_id === pageId && r.quiz_no === quizNo)
  if (existing) return existing
  const { space, notebook, chapter } = vaultResolveSource(pageId)
  const now = V.vaultLocalNow() // 对齐 datetime('now','localtime') 列默认值
  const row: V.VaultQuizRecordRow = {
    id: randomUUID(),
    page_id: pageId,
    quiz_no: quizNo,
    page_title: meta.pageTitle,
    is_favorite: 0,
    wrong_count: 0,
    correct_count: 0,
    last_result: null,
    streak_correct: 0,
    note: '',
    snapshot_json: meta.snapshot ? JSON.stringify(meta.snapshot) : '',
    source_space: space,
    source_notebook: notebook,
    source_chapter: chapter,
    created_at: now,
    updated_at: now,
  }
  V.writeQuizRecords([...rows, row])
  return row
}

/**
 * 判题/收藏上报的存储目标：
 * - quizbookMode=plugin 且插件表存在 → 写插件命名空间表（错题本彻底插件化）
 * - 否则 → vault 主表（内置模式）
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
    // SELECT * WHERE page_id = ? ORDER BY quiz_no ASC
    return V.readQuizRecords()
      .filter((r) => r.page_id === pageId)
      .sort((a, b) => a.quiz_no - b.quiz_no)
      .map(vaultRowToDto)
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
    const row = vaultEnsureRecord(pageId, no, {
      pageTitle: typeof meta?.pageTitle === 'string' ? meta.pageTitle : '',
      snapshot: meta?.snapshot ?? null,
    })
    const rows = V.readQuizRecords()
    const i = rows.findIndex((r) => r.id === row.id)
    if (i < 0) return vaultRowToDto(row)
    const now = V.vaultLocalNow() // 对齐 datetime('now', 'localtime')
    if (correct) {
      // correct_count+1、streak_correct+1（wrong_count 保留供档位分层）
      rows[i] = {
        ...rows[i],
        correct_count: (rows[i].correct_count ?? 0) + 1,
        streak_correct: (rows[i].streak_correct ?? 0) + 1,
        last_result: 1,
        updated_at: now,
      }
    } else {
      // 答错：wrong_count+1、连续答对清零（回流错题本）
      rows[i] = {
        ...rows[i],
        wrong_count: (rows[i].wrong_count ?? 0) + 1,
        streak_correct: 0,
        last_result: 0,
        updated_at: now,
      }
    }
    V.writeQuizRecords(rows)
    return vaultRowToDto(rows[i])
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
    const row = vaultEnsureRecord(pageId, no, {
      pageTitle: typeof meta?.pageTitle === 'string' ? meta.pageTitle : '',
      snapshot: meta?.snapshot ?? null,
    })
    const rows = V.readQuizRecords()
    const i = rows.findIndex((r) => r.id === row.id)
    if (i < 0) return vaultRowToDto(row)
    rows[i] = { ...rows[i], is_favorite: rows[i].is_favorite ? 0 : 1, updated_at: V.vaultLocalNow() }
    V.writeQuizRecords(rows)
    return vaultRowToDto(rows[i])
  })

  ipcMain.handle('quizRecord:list', (_e, opts?: {
    kind?: 'favorite' | 'wrong' | 'all'
    sourceSpace?: string
    collectionId?: string
    tagIds?: string[]
  }) => {
    const kind = opts?.kind ?? 'all'
    const sourceSpace = typeof opts?.sourceSpace === 'string' && opts.sourceSpace ? opts.sourceSpace : ''
    const collectionId = typeof opts?.collectionId === 'string' && opts.collectionId ? opts.collectionId : ''
    // 标签筛选：命中任一选中标签即算匹配
    const tagIds = Array.isArray(opts?.tagIds) ? opts!.tagIds!.filter(t => typeof t === 'string' && t) : []
    // EXISTS 子查询 → 关联表 join：先归约成命中记录 id 集合
    const colHit = collectionId
      ? new Set(V.readQuizRecordCollections().filter((l) => l.collection_id === collectionId).map((l) => l.record_id))
      : null
    const tagHit = tagIds.length > 0
      ? new Set(V.readQuizRecordTags().filter((l) => tagIds.includes(l.tag_id)).map((l) => l.record_id))
      : null
    const matchKind = (r: V.VaultQuizRecordRow): boolean => {
      const hasWrong = (r.wrong_count ?? 0) > 0 && (r.streak_correct ?? 0) < 2
      if (kind === 'favorite') return !!r.is_favorite
      if (kind === 'wrong') return hasWrong
      return !!r.is_favorite || hasWrong
    }
    return V.readQuizRecords()
      .filter((r) => matchKind(r)
        && (!sourceSpace || r.source_space === sourceSpace)
        && (!colHit || colHit.has(r.id))
        && (!tagHit || tagHit.has(r.id)))
      .sort((a, b) => strCmp(b.updated_at ?? '', a.updated_at ?? '') || strCmp(a.page_id, b.page_id) || a.quiz_no - b.quiz_no)
      .map(vaultRowToDto)
  })

  ipcMain.handle('quizRecord:remove', (_e, pageId: string, quizNo: number) => {
    const no = Number(quizNo)
    const row = V.readQuizRecords().find((r) => r.page_id === pageId && r.quiz_no === no)
    if (!row) return
    V.writeQuizRecordCollections(V.readQuizRecordCollections().filter((l) => l.record_id !== row.id))
    V.writeQuizRecords(V.readQuizRecords().filter((r) => r.id !== row.id))
  })

  ipcMain.handle('quizRecord:setCollections', (_e, recordId: string, collectionIds: string[]) => {
    if (typeof recordId !== 'string' || !recordId) throw new Error('recordId 缺失')
    // DELETE + 逐条 INSERT OR IGNORE（联合主键去重）：整体重写该记录的关联行
    const kept = V.readQuizRecordCollections().filter((l) => l.record_id !== recordId)
    const seen = new Set<string>()
    for (const cid of Array.isArray(collectionIds) ? collectionIds : []) {
      if (typeof cid !== 'string' || !cid || seen.has(cid)) continue
      seen.add(cid)
      kept.push({ record_id: recordId, collection_id: cid })
    }
    V.writeQuizRecordCollections(kept)
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
    // ORDER BY sort_order ASC, created_at ASC；count 由关联表计数
    const rows = V.readQuizTags().sort((a, b) => a.sort_order - b.sort_order || strCmp(a.created_at ?? '', b.created_at ?? ''))
    const links = V.readQuizRecordTags()
    return rows.map(t => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      color: t.color || TAG_COLORS[t.kind] || '#888780',
      sortOrder: t.sort_order,
      createdAt: t.created_at,
      count: links.filter((l) => l.tag_id === t.id).length,
    })) as QuizTagDto[]
  })

  ipcMain.handle('quizTag:create', (_e, name: string, kind?: string) => {
    const nm = typeof name === 'string' ? name.trim().slice(0, 24) : ''
    if (!nm) throw new Error('标签名缺失')
    const k = validKind(kind)
    // 唯一索引 (name, kind) 等义：按 name+kind 查找，命中即原样返回（含 count: 0 的现语义）
    const exist = V.readQuizTags().find((t) => t.name === nm && t.kind === k)
    if (exist) {
      return { id: exist.id, name: exist.name, kind: exist.kind, color: exist.color, sortOrder: exist.sort_order, createdAt: exist.created_at, count: 0 } as QuizTagDto
    }
    const id = randomUUID()
    // COALESCE(MAX(sort_order), -1) + 1
    const tags = V.readQuizTags()
    const maxOrder = tags.reduce((m, t) => Math.max(m, t.sort_order), -1) + 1
    V.writeQuizTags([...tags, { id, name: nm, kind: k, color: TAG_COLORS[k] ?? '', sort_order: maxOrder, created_at: V.vaultLocalNow() }])
    // 保持原语义：该分支不回填 createdAt，保持 ''
    return { id, name: nm, kind: k, color: TAG_COLORS[k] ?? '', sortOrder: maxOrder, createdAt: '', count: 0 } as QuizTagDto
  })

  ipcMain.handle('quizTag:delete', (_e, tagId: string) => {
    if (typeof tagId !== 'string' || !tagId) return
    V.writeQuizRecordTags(V.readQuizRecordTags().filter((l) => l.tag_id !== tagId))
    V.writeQuizTags(V.readQuizTags().filter((t) => t.id !== tagId))
  })

  /** 单题设置标签（整体覆盖） */
  ipcMain.handle('quizRecord:setTags', (_e, recordId: string, tagIds: string[]) => {
    if (typeof recordId !== 'string' || !recordId) throw new Error('recordId 缺失')
    // DELETE + 逐条 INSERT OR IGNORE（联合主键去重）：整体重写该记录的标签关联
    const kept = V.readQuizRecordTags().filter((l) => l.record_id !== recordId)
    const seen = new Set<string>()
    for (const tid of Array.isArray(tagIds) ? tagIds : []) {
      if (typeof tid !== 'string' || !tid || seen.has(tid)) continue
      seen.add(tid)
      kept.push({ record_id: recordId, tag_id: tid })
    }
    V.writeQuizRecordTags(kept)
  })

  /** 批量打标：给多条记录追加标签（去重） */
  ipcMain.handle('quizRecord:addTags', (_e, recordIds: string[], tagIds: string[]) => {
    const rids = Array.isArray(recordIds) ? recordIds.filter(x => typeof x === 'string' && x) : []
    const tids = Array.isArray(tagIds) ? tagIds.filter(x => typeof x === 'string' && x) : []
    if (rids.length === 0 || tids.length === 0) return
    // 全矩阵 INSERT OR IGNORE：已存在的 (record_id, tag_id) 跳过
    const links = V.readQuizRecordTags()
    const have = new Set(links.map((l) => `${l.record_id}\u0000${l.tag_id}`))
    for (const rid of rids) {
      for (const tid of tids) {
        const key = `${rid}\u0000${tid}`
        if (have.has(key)) continue
        have.add(key)
        links.push({ record_id: rid, tag_id: tid })
      }
    }
    V.writeQuizRecordTags(links)
  })

  ipcMain.handle('quizRecord:setNote', (_e, recordId: string, note: string) => {
    if (typeof recordId !== 'string' || !recordId) throw new Error('recordId 缺失')
    const text = typeof note === 'string' ? note.slice(0, 500) : ''
    const rows = V.readQuizRecords()
    const i = rows.findIndex((r) => r.id === recordId)
    if (i >= 0) {
      // 仅更新 note，不触碰 updated_at
      rows[i] = { ...rows[i], note: text }
      V.writeQuizRecords(rows)
    }
  })

  ipcMain.handle('quizRecord:stats', (_e, opts?: { sourceSpace?: string }) => {
    const space = typeof opts?.sourceSpace === 'string' && opts.sourceSpace ? opts.sourceSpace : ''
    const rows = V.readQuizRecords().filter((r) => !space || r.source_space === space)
    const today = V.vaultLocalToday() // date('now','localtime')
    let wrong = 0
    let mastered = 0
    let todayWrong = 0
    let sumCorrect = 0
    let sumWrong = 0
    for (const r of rows) {
      const hasWrong = (r.wrong_count ?? 0) > 0
      const sc = r.streak_correct ?? 0
      if (hasWrong && sc < 2) wrong += 1
      if (hasWrong && sc >= 2) mastered += 1
      // date(r.updated_at) = date('now','localtime')：'YYYY-MM-DD HH:MM:SS' 取前 10 位即日期
      if (r.last_result === 0 && (r.updated_at ?? '').slice(0, 10) === today) todayWrong += 1
      sumCorrect += r.correct_count ?? 0
      sumWrong += r.wrong_count ?? 0
    }
    const total = sumCorrect + sumWrong
    return {
      wrong,
      mastered,
      todayWrong,
      correctRate: total > 0 ? Math.round((sumCorrect / total) * 100) : 0,
    }
  })

  // ===== 自定义分组 =====

  ipcMain.handle('quizCollection:list', () => {
    // ORDER BY sort_order ASC, created_at ASC；count 由关联表计数
    const cols = V.readQuizCollections().sort((a, b) => a.sort_order - b.sort_order || strCmp(a.created_at ?? '', b.created_at ?? ''))
    const links = V.readQuizRecordCollections()
    return cols.map(c => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sort_order,
      createdAt: c.created_at,
      count: links.filter((l) => l.collection_id === c.id).length,
    })) as QuizCollectionDto[]
  })

  ipcMain.handle('quizCollection:create', (_e, name: string) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n) throw new Error('分组名不能为空')
    if (n.length > 50) throw new Error('分组名过长')
    const cols = V.readQuizCollections()
    const id = randomUUID()
    // COALESCE(MAX(sort_order), -1) + 1
    const maxOrder = cols.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1
    const created: V.VaultQuizCollectionRow = { id, name: n, sort_order: maxOrder, created_at: V.vaultLocalNow() }
    V.writeQuizCollections([...cols, created])
    // 回读整行 + count: 0
    return { id: created.id, name: created.name, sortOrder: created.sort_order, createdAt: created.created_at, count: 0 } as QuizCollectionDto
  })

  ipcMain.handle('quizCollection:rename', (_e, id: string, name: string) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n) throw new Error('分组名不能为空')
    if (n.length > 50) throw new Error('分组名过长')
    const cols = V.readQuizCollections()
    const i = cols.findIndex((c) => c.id === id)
    if (i < 0) throw new Error('分组不存在')
    cols[i] = { ...cols[i], name: n }
    V.writeQuizCollections(cols)
    return {
      id: cols[i].id,
      name: cols[i].name,
      sortOrder: cols[i].sort_order,
      createdAt: cols[i].created_at,
      count: V.readQuizRecordCollections().filter((l) => l.collection_id === id).length,
    } as QuizCollectionDto
  })

  ipcMain.handle('quizCollection:delete', (_e, id: string) => {
    V.writeQuizRecordCollections(V.readQuizRecordCollections().filter((l) => l.collection_id !== id))
    V.writeQuizCollections(V.readQuizCollections().filter((c) => c.id !== id))
  })

  // ===== 数据迁移（主表 ⇄ 插件命名空间表） =====
  // 以下 quizMigrate:* / quiz:plugin* handler 全部作用于插件命名空间表
  // （quizMigration.ts 管辖），不属于主表 vault 数据层，故保持原样。

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
