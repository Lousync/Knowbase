import { ipcMain } from 'electron'
import {
  applyWordFeedback, bumpDailyStat, deleteWordbookEntry, getDailyStat, todayKey,
  listDailyStats, listWordbookEntries, setWordbookMastered, upsertWordbookEntry,
  type WordFeedback,
} from '../database/repositories/wordbookRepo'
import { getBookWords, getPrimaryTranslation, isBookId, lookupWord, pickDistractors, type BookId } from './dictionaryService'
import { recordActivity } from './habitLinkService'
import type { WordbookBook, WordbookEntryDto, WordbookItemDto, WordbookStatsDto, WordbookTodayDto } from '../../src/lib/wordbookTypes'

/**
 * 单词本：每日队列 = 到期复习 + 词书新词（或未首答的收藏词），
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

function buildItem(word: string, isNew: boolean, book: BookId | null, extra?: { dueAt?: string }): WordbookItemDto {
  const dict = lookupWord(word)
  const e = dict.entry
  const answerLine = e?.translationLines[0] ?? getPrimaryTranslation(word) ?? '(词典未收录)'
  const distractors = pickDistractors(word, book, 3)
  const options = [answerLine, ...distractors]
  // Fisher-Yates 洗牌
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return {
    word,
    isNew,
    phonetic: e?.phonetic ?? '',
    translationLines: e?.translationLines ?? [],
    tags: e?.tags ?? [],
    options,
    answer: answerLine,
    book: book ?? undefined,
  }
}

function computeStreakDays(): number {
  const days = listDailyStats(400)
  const active = new Set(days.filter(d => d.reviewed > 0).map(d => d.date))
  // 从今天(或昨天,今天还没学)往回数连续天数
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

  // 1) 到期复习
  const dueRows = listWordbookEntries('learning')
    .filter(r => r.first_answer_at && r.due_at.slice(0, 10) <= today)
    .slice(0, MAX_QUEUE)
  for (const r of dueRows) items.push(buildItem(r.word, false, null))

  // 2) 新词：词书未学词按词频升序；无词书时给收藏了但没学过的词
  const newQuota = Math.max(0, newTarget - daily.new_words)
  const existing = new Set(listWordbookEntries().map(r => r.word))
  if (newQuota > 0) {
    if (book) {
      let taken = 0
      for (const w of getBookWords(book)) {
        if (taken >= newQuota || items.length >= MAX_QUEUE) break
        if (existing.has(w.word)) continue
        items.push(buildItem(w.word, true, book))
        existing.add(w.word)
        taken++
      }
    } else {
      const neverAnswered = listWordbookEntries('learning').filter(r => !r.first_answer_at)
      for (const r of neverAnswered) {
        if (items.length >= MAX_QUEUE) break
        items.push(buildItem(r.word, true, null))
      }
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
    items,
  }
}

function answer(word: string, feedback: WordFeedback, deps: Deps): { ok: boolean; error?: string } {
  const w = String(word ?? '').trim().toLowerCase()
  if (!w) return { ok: false, error: '词语为空' }
  if (!['known', 'fuzzy', 'unknown'].includes(feedback)) return { ok: false, error: '反馈值非法' }
  const existing = listWordbookEntries().find(r => r.word === w)
  const isNew = !existing?.first_answer_at
  if (!existing) {
    // 未收藏的词直接作答(词书新词的正常路径)：来源记当前词书
    const bookRaw = String(deps.getSettingValue('wordbookActiveBook') ?? '')
    upsertWordbookEntry(w, isBookId(bookRaw) ? `book:${bookRaw}` : 'manual')
  }
  applyWordFeedback(w, feedback)
  bumpDailyStat(todayKey(), isNew)
  // 打卡联动：上报行为，由 habitLinkService 反查 wordbook_daily 现值判定
  try { recordActivity({ source: 'wordbook', date: todayKey() }) } catch { /* 打卡联动失败不影响学习 */ }
  return { ok: true }
}

export function registerWordbookHandlers(deps: Deps): void {
  ipcMain.handle('wordbook:add', (_e, word: string) => {
    const w = String(word ?? '').trim().toLowerCase()
    if (!w) return { ok: false, error: '词语为空' }
    const before = listWordbookEntries().find(r => r.word === w)
    if (before) return { ok: true, already: true }
    upsertWordbookEntry(w, 'manual')
    return { ok: true, already: false }
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
}
