import { ipcMain } from 'electron'
import {
  applyWordFeedback, bumpDailyStat, deleteWordbookEntry, getDailyStat, todayKey,
  listDailyStats, listWordbookEntries, setWordbookMastered, upsertWordbookEntry,
  getWordbookEntry, type WordFeedback,
} from '../database/repositories/wordbookRepo'
import {
  getBookWords, getPrimaryTranslation, formatOptionLine, isBookId, lookupWord,
  pickDistractors, pickWordDistractors, getWordRoots, getRootCluster, getSynonyms, type BookId,
} from './dictionaryService'
import { getTranslationCache } from '../database/repositories/translationRepo'
import { recordActivity } from './habitLinkService'
import {
  createWordbookGroup, deleteWordbookGroup, getWordbookGroup, listGroupWords,
  listWordbookGroups, addWordToGroup, removeWordFromGroup, renameWordbookGroup,
} from '../database/repositories/wordbookRepo'
import { randomUUID } from 'crypto'
import type {
  BookWordRowDto, BookWordsResultDto, QuestionType, RootClusterDto, SynonymClusterDto,
  WordRelationRowDto, WordbookBook, WordbookCustomQueueDto, WordbookEntryDto,
  WordbookGroupDto, WordbookItemDto, WordbookStatsDto, WordbookTodayDto,
} from '../../src/lib/wordbookTypes'

/**
 * 单词本：每日队列 = 到期复习 + 词书新词（或未首答的收藏词）。
 * 题型轮换：新词一律四选一（认识优先），复习词在 choice/listen/spell/cloze 间轮换；
 * cloze 例句从已缓存的 AI 精讲 markdown 中提取，取不到就回落 choice。
 * 答题走简化 SM-2（wordbookRepo.applyWordFeedback），
 * 每次作答上报 habitLink（source=wordbook）供习惯自动打卡。
 */

const MAX_QUEUE = 60

interface Deps {
  getSettingValue: (key: string) => unknown
  setSettingValue: (key: string, value: unknown) => boolean
}

function toEntryDto(word: string, row: {
  status: string; source: string; added_at: string; due_at: string; interval_days: number
  ease: number; streak: number; review_count: number; correct_count: number
  fuzzy_count: number; wrong_count: number
}): WordbookEntryDto {
  const dict = lookupWord(word)
  const e = dict.entry
  return {
    word,
    status: row.status === 'mastered' ? 'mastered' : 'learning',
    source: row.source,
    addedAt: row.added_at,
    dueAt: row.due_at,
    intervalDays: row.interval_days,
    ease: row.ease,
    streak: row.streak,
    reviewCount: row.review_count,
    correctCount: row.correct_count,
    fuzzyCount: row.fuzzy_count,
    wrongCount: row.wrong_count,
    phonetic: e?.phonetic ?? '',
    translationLines: e?.translationLines ?? [],
    tags: e?.tags ?? [],
  }
}

/** 从已缓存的 AI 精讲 markdown 提取含目标词的例句并挖空；取不到返回空串 */
function extractClozeSentence(word: string): string {
  const cached = getTranslationCache(`word:${word}`)
  if (!cached) return ''
  const section = /###\s*例句[\s\S]*?(?=\n###|\n##|$)/.exec(cached.result_md)
  if (!section) return ''
  const w = word.toLowerCase()
  const re = new RegExp(`\\b${w.replace(/[^a-z]/g, '')}\\b`, 'i')
  for (const rawLine of section[0].split('\n')) {
    const line = rawLine.replace(/^\s*\d+[.、)]\s*/, '').trim()
    if (!line || !re.test(line)) continue
    // 截掉行内中文翻译部分（例句与翻译常同行/邻行混排）
    let sentence = line.split(/[\u4e00-\u9fff]/)[0].trim().replace(/[-—–:：]\s*$/, '')
    if (!sentence || !re.test(sentence)) continue
    const blanked = sentence.replace(re, '____')
    if (blanked !== sentence && sentence.length <= 160) return blanked
  }
  return ''
}

function buildItem(word: string, isNew: boolean, book: BookId | null, forcedType?: QuestionType): WordbookItemDto {
  const dict = lookupWord(word)
  const e = dict.entry
  const rawAnswer = e?.translationLines[0] ?? getPrimaryTranslation(word) ?? '(词典未收录)'
  const answer = formatOptionLine(rawAnswer)

  // 题型指派：新词一律 choice（首次接触以辨认优先）；复习词随机轮换，cloze 取不到例句时回落
  let type: QuestionType = forcedType ?? 'choice'
  if (!forcedType && !isNew) {
    const rotation: QuestionType[] = ['choice', 'listen', 'spell', 'cloze']
    type = rotation[Math.floor(Math.random() * rotation.length)]
  }
  let clozeSentence = ''
  let wordOptions: string[] = []
  if (type === 'cloze') {
    clozeSentence = extractClozeSentence(word)
    if (!clozeSentence) type = 'choice'
    else wordOptions = shuffle([word, ...pickWordDistractors(word, book, 3)])
  }

  let options: string[] = []
  if (type === 'choice' || type === 'listen') {
    options = shuffle([answer, ...pickDistractors(word, book, 3)])
  }

  return {
    word,
    isNew,
    type,
    phonetic: e?.phonetic ?? '',
    translationLines: e?.translationLines ?? [],
    definition: e?.definition ?? '',
    tags: e?.tags ?? [],
    exchange: e?.exchange ?? {},
    options,
    answer,
    wordOptions,
    clozeSentence,
    book: book ?? undefined,
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function computeStreakDays(): number {
  const days = listDailyStats(400)
  const active = new Set(days.filter(d => d.reviewed > 0).map(d => d.date))
  const cursor = new Date()
  if (!active.has(fmtDate(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (active.has(fmtDate(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function bookLearnedCount(book: BookId): number {
  const bookWords = new Set(getBookWords(book).map(w => w.word))
  const rows = listWordbookEntries()
  let n = 0
  for (const r of rows) if (bookWords.has(r.word)) n++
  return n
}

function getToday(deps: Deps): WordbookTodayDto {
  const bookRaw = String(deps.getSettingValue('wordbookActiveBook') ?? '')
  const book: BookId | null = isBookId(bookRaw) ? bookRaw : null
  const newTarget = Math.max(0, Math.min(200, Math.floor(Number(deps.getSettingValue('wordbookNewPerDay') ?? 10))))
  const today = todayKey()
  const daily = getDailyStat(today)
  const items: WordbookItemDto[] = []
  let reviewTotal = 0
  let newTotal = 0

  // 1) 到期复习
  const dueRows = listWordbookEntries('learning')
    .filter(r => r.first_answer_at && r.due_at.slice(0, 10) <= today)
    .slice(0, MAX_QUEUE)
  for (const r of dueRows) {
    items.push(buildItem(r.word, false, null))
    reviewTotal++
  }

  // 2) 新词。核心场景是"阅读中收藏的不会的词"：收藏词全部进当日队列，不受每日新词数限制；
  //    只有词书推送（可选的辅助功能）受 newQuota 约束，防止复习雪崩
  const existing = new Set(listWordbookEntries().map(r => r.word))
  {
    const neverAnswered = listWordbookEntries('learning').filter(r => !r.first_answer_at)
    for (const r of neverAnswered) {
      if (items.length >= MAX_QUEUE) break
      items.push(buildItem(r.word, true, null))
      existing.add(r.word)
      newTotal++
    }
  }
  const newQuota = Math.max(0, newTarget - daily.new_words)
  if (book && newQuota > 0) {
    let taken = 0
    for (const w of getBookWords(book)) {
      if (taken >= newQuota || items.length >= MAX_QUEUE) break
      if (existing.has(w.word)) continue
      items.push(buildItem(w.word, true, book))
      existing.add(w.word)
      newTotal++
      taken++
    }
  }

  return {
    book: book ?? '',
    bookTotal: book ? getBookWords(book).length : 0,
    bookLearned: book ? bookLearnedCount(book) : 0,
    newTarget,
    newDone: daily.new_words,
    answeredToday: daily.reviewed,
    streakDays: computeStreakDays(),
    reviewTotal,
    newTotal,
    items,
  }
}

function answer(word: string, feedback: WordFeedback, deps: Deps): { ok: boolean; error?: string } {
  const w = String(word ?? '').trim().toLowerCase()
  if (!w) return { ok: false, error: '词语为空' }
  if (!['known', 'fuzzy', 'unknown'].includes(feedback)) return { ok: false, error: '反馈值非法' }
  const existing = getWordbookEntry(w)
  const isNew = !existing?.first_answer_at
  if (!existing) {
    const bookRaw = String(deps.getSettingValue('wordbookActiveBook') ?? '')
    upsertWordbookEntry(w, isBookId(bookRaw) ? `book:${bookRaw}` : 'manual')
  }
  applyWordFeedback(w, feedback)
  bumpDailyStat(todayKey(), isNew)
  try { recordActivity({ source: 'wordbook', date: todayKey() }) } catch { /* 打卡联动失败不影响学习 */ }
  return { ok: true }
}

export function registerWordbookHandlers(deps: Deps): void {
  /** 生词本状态行（同根/近义/分组展示用） */
  const relationRows = (words: string[]): WordRelationRowDto[] => {
    const statusMap = new Map(listWordbookEntries().map(r => [r.word, r.status as 'learning' | 'mastered']))
    return words.map(w => ({
      word: w,
      translationLine: formatOptionLine(getPrimaryTranslation(w)),
      phonetic: lookupWord(w).entry?.phonetic ?? '',
      status: statusMap.get(w) ?? 'none',
    }))
  }

  /** 从一批词构建强化复习队列（分组/词根/近义入口） */
  const buildCustomQueue = (label: string, words: string[]): WordbookCustomQueueDto => {
    const statusMap = new Map(listWordbookEntries().map(r => [r.word, r]))
    const items = words
      .filter(w => lookupWord(w).found)
      .slice(0, MAX_QUEUE)
      .map(w => buildItem(w, !statusMap.get(w)?.first_answer_at, null))
    return { label, items }
  }
  ipcMain.handle('wordbook:add', (_e, word: string) => {
    const w = String(word ?? '').trim().toLowerCase()
    if (!w) return { ok: false, error: '词语为空' }
    const before = getWordbookEntry(w)
    if (before) return { ok: true, already: true }
    upsertWordbookEntry(w, 'manual')
    return { ok: true, already: false }
  })

  ipcMain.handle('wordbook:check', (_e, word: string) => {
    const row = getWordbookEntry(String(word ?? '').trim().toLowerCase())
    return { inBook: !!row, status: row?.status }
  })

  ipcMain.handle('wordbook:markKnown', (_e, word: string) => {
    const w = String(word ?? '').trim().toLowerCase()
    if (!w) return { ok: false, error: '词语为空' }
    if (!getWordbookEntry(w)) {
      const bookRaw = String(deps.getSettingValue('wordbookActiveBook') ?? '')
      upsertWordbookEntry(w, isBookId(bookRaw) ? `book:${bookRaw}` : 'manual')
    }
    setWordbookMastered(w, true)
    return { ok: true }
  })

  ipcMain.handle('wordbook:remove', (_e, word: string) => {
    deleteWordbookEntry(String(word ?? '').trim().toLowerCase())
    return { ok: true }
  })

  ipcMain.handle('wordbook:setMastered', (_e, word: string, mastered: boolean) => {
    const w = String(word ?? '').trim().toLowerCase()
    if (!w) return { ok: false, error: '词语为空' }
    setWordbookMastered(w, Boolean(mastered))
    return { ok: true }
  })

  ipcMain.handle('wordbook:list', (_e, status?: string): WordbookEntryDto[] => {
    const rows = (status === 'learning' || status === 'mastered') ? listWordbookEntries(status) : listWordbookEntries()
    return rows.map(r => toEntryDto(r.word, r))
  })

  ipcMain.handle('wordbook:getToday', (): WordbookTodayDto => getToday(deps))

  ipcMain.handle('wordbook:answer', (_e, word: string, feedback: WordFeedback) => answer(word, feedback, deps))

  ipcMain.handle('wordbook:setBook', (_e, book: string) => {
    deps.setSettingValue('wordbookActiveBook', isBookId(book) ? book : '')
    return { ok: true }
  })

  ipcMain.handle('wordbook:stats', (): WordbookStatsDto => {
    const today = todayKey()
    const daily = getDailyStat(today)
    return {
      streakDays: computeStreakDays(),
      answeredToday: daily.reviewed,
      totalLearning: listWordbookEntries('learning').length,
      totalMastered: listWordbookEntries('mastered').length,
      recent: listDailyStats(14),
    }
  })

  // 词书词表浏览（搜索按前缀，分页；orderBy: frq=词频序 word=字母序）
  ipcMain.handle('wordbook:bookWords', (_e, book: string, query: string, offset: number, limit: number, orderBy?: string): BookWordsResultDto => {
    if (!isBookId(book)) return { total: 0, items: [] }
    const q = String(query ?? '').trim().toLowerCase()
    const all0 = getBookWords(book)
    const filtered = q ? all0.filter(w => w.word.startsWith(q)) : all0
    const all = orderBy === 'word' ? [...filtered].sort((a, b) => a.word.localeCompare(b.word)) : filtered
    const off = Math.max(0, Math.floor(Number(offset) || 0))
    const lim = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)))
    const entryByWord = new Map(listWordbookEntries().map(r => [r.word, r.status]))
    const items: BookWordRowDto[] = filtered.slice(off, off + lim).map(w => {
      const st = entryByWord.get(w.word)
      return {
        word: w.word,
        frq: w.frq,
        phonetic: lookupWord(w.word).entry?.phonetic ?? '',
        translationLine: formatOptionLine(getPrimaryTranslation(w.word)),
        status: st === 'mastered' ? 'mastered' : st === 'learning' ? 'learning' : 'none',
      }
    })
    return { total: filtered.length, items }
  })

  // ===== 词汇体系：同根词 / 近义词 / 话题分组 =====

  // 生词本内的词按词根聚类（一个词可能属于多个词根，出现在多个簇里）
  ipcMain.handle('wordbook:rootClusters', (): RootClusterDto[] => {
    const collected = listWordbookEntries().map(r => r.word)
    const byRoot = new Map<string, Set<string>>()
    for (const w of collected) {
      for (const root of getWordRoots(w)) {
        if (!byRoot.has(root)) byRoot.set(root, new Set())
        byRoot.get(root)!.add(w)
      }
    }
    const out: RootClusterDto[] = []
    for (const [root, words] of byRoot) {
      if (words.size < 2) continue // 单词不成簇，没有强化价值
      const info = getRootCluster(root)
      out.push({
        root,
        meaning: info?.meaning ?? '',
        origin: info?.origin ?? '',
        words: relationRows([...words].sort((a, b) => a.localeCompare(b))),
      })
    }
    return out.sort((a, b) => b.words.length - a.words.length)
  })

  // 生词本内的词按同义关系连通聚簇（BFS，簇上限 12 词防链式爆炸）
  ipcMain.handle('wordbook:synonymClusters', (): SynonymClusterDto[] => {
    const collected = listWordbookEntries().map(r => r.word)
    const collectedSet = new Set(collected)
    const neighbors = new Map<string, string[]>()
    for (const w of collected) {
      const syns = getSynonyms(w).filter(s => s !== w)
      // 近义词不要求已收藏：簇里带上词典同义词，复习时顺便认识
      neighbors.set(w, syns)
    }
    const visited = new Set<string>()
    const clusters: SynonymClusterDto[] = []
    for (const start of collected) {
      if (visited.has(start) || (neighbors.get(start)?.length ?? 0) === 0) continue
      const comp = new Set<string>([start])
      const queue = [start]
      while (queue.length > 0 && comp.size < 12) {
        const cur = queue.shift()!
        for (const nb of neighbors.get(cur) ?? []) {
          if (!comp.has(nb) && (collectedSet.has(nb) || (neighbors.get(nb)?.length ?? 0) > 0)) {
            comp.add(nb)
            queue.push(nb)
          }
        }
      }
      for (const w of comp) visited.add(w)
      if (comp.size >= 2) {
        clusters.push({ words: relationRows([...comp].sort((a, b) => a.localeCompare(b))) })
      }
    }
    return clusters.sort((a, b) => b.words.length - a.words.length)
  })

  // 单词的同根/近义关系（学习翻面详情 chips）
  ipcMain.handle('wordbook:relations', (_e, word: string) => {
    const w = String(word ?? '').trim().toLowerCase()
    const roots: RootClusterDto[] = getWordRoots(w).map(root => {
      const info = getRootCluster(root)
      const words = (info?.words ?? []).filter(x => x !== w)
      return { root, meaning: info?.meaning ?? '', origin: info?.origin ?? '', words: relationRows(words) }
    }).filter(r => r.words.length > 0)
    const synonyms = relationRows(getSynonyms(w))
    return { roots, synonyms }
  })

  // ===== 话题分组（自定义，落库） =====

  ipcMain.handle('wordbook:groups:list', (): WordbookGroupDto[] =>
    listWordbookGroups().map(g => ({ id: g.id, name: g.name, wordCount: g.wordCount })))

  ipcMain.handle('wordbook:groups:create', (_e, name: string) => {
    const n = String(name ?? '').trim()
    if (!n) return { ok: false, error: '分组名不能为空' }
    if (n.length > 30) return { ok: false, error: '分组名过长' }
    return { ok: true, id: createWordbookGroup(n).id }
  })

  ipcMain.handle('wordbook:groups:rename', (_e, id: string, name: string) => {
    const n = String(name ?? '').trim()
    if (!n || !getWordbookGroup(id)) return { ok: false, error: '参数非法' }
    renameWordbookGroup(id, n)
    return { ok: true }
  })

  ipcMain.handle('wordbook:groups:delete', (_e, id: string) => {
    deleteWordbookGroup(id)
    return { ok: true }
  })

  ipcMain.handle('wordbook:groups:addWord', (_e, id: string, word: string) => {
    const w = String(word ?? '').trim().toLowerCase()
    if (!getWordbookGroup(id) || !w) return { ok: false, error: '参数非法' }
    if (!lookupWord(w).found) return { ok: false, error: `「${w}」不在离线词典中` }
    addWordToGroup(id, w)
    return { ok: true }
  })

  ipcMain.handle('wordbook:groups:removeWord', (_e, id: string, word: string) => {
    removeWordFromGroup(id, String(word ?? '').trim().toLowerCase())
    return { ok: true }
  })

  ipcMain.handle('wordbook:groups:words', (_e, id: string) => listGroupWords(id))

  // 分组/词根/近义 → 强化复习队列（到期的复习，没到期也一并强化，作答照常计 SRS）
  ipcMain.handle('wordbook:customQueue', (_e, label: string, words: string[]): WordbookCustomQueueDto =>
    buildCustomQueue(String(label ?? '强化复习'), Array.isArray(words) ? words.map(w => String(w).toLowerCase()) : []))
}
