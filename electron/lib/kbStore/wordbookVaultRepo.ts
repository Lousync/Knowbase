import { randomUUID } from 'crypto'
import { readJson, writeJson } from './jsonStore'
import type { WordbookEntryRow, WordbookStatus, WordbookFeedback } from '../../database/repositories/wordbookRepo'

/**
 * 生词本 vault 数据仓库（去库化 P2，用户选迁：wordbook 30 词真实数据）
 *
 * 存储：.knowbase/modules/wordbook/{entries,daily,groups}.json
 * 行结构尽量保留 sql.js 同名字段（snake_case），便于一次性搬迁与双源切换；
 * 复习算法（SM-2 步进/间隔）与 wordbookRepo 完全对齐，仅时间取自本地系统（
 * sqlite 的 datetime('now','localtime') → 本地 'YYYY-MM-DD HH:MM:SS'）。
 */

export type WordbookEntryJson = WordbookEntryRow
interface DailyRow { date: string; new_words: number; reviewed: number }
interface GroupJson { id: string; name: string; created_at: string; words: string[] }

const MOD = 'modules/wordbook'

function localNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function localDay(): string {
  return localNow().slice(0, 10)
}

// ===== 低层存取 =====
export function vaultWordbookSeed(entries: WordbookEntryRow[], daily: Array<{ date: string; new_words: number; reviewed: number }>, groups: Array<{ id: string; name: string; created_at: string; words: string[] }>): boolean {
  writeJson(MOD, 'entries.json', entries)
  writeJson(MOD, 'daily.json', daily)
  writeJson(MOD, 'groups.json', groups)
  return true
}
export function vaultWordbookHasData(): boolean {
  return readJson<unknown[]>(MOD, 'entries.json', []).length > 0
}
function readEntries(): WordbookEntryRow[] { return readJson<WordbookEntryRow[]>(MOD, 'entries.json', []) }
function writeEntries(rows: WordbookEntryRow[]): void { writeJson(MOD, 'entries.json', rows) }
function readDaily(): DailyRow[] { return readJson<DailyRow[]>(MOD, 'daily.json', []) }
export function vaultWordbookDaily(): DailyRow[] { return readDaily() }
function writeDaily(rows: DailyRow[]): void { writeJson(MOD, 'daily.json', rows) }
function readGroups(): GroupJson[] { return readJson<GroupJson[]>(MOD, 'groups.json', []) }
function writeGroups(rows: GroupJson[]): void { writeJson(MOD, 'groups.json', rows) }

// ===== 词条 =====
export function vaultGetWordbookEntry(word: string): WordbookEntryRow | null {
  return readEntries().find((r) => r.word === word) ?? null
}

export function vaultListWordbookEntries(status?: WordbookStatus): WordbookEntryRow[] {
  const rows = readEntries()
  if (status) return rows.filter((r) => r.status === status).sort((a, b) => a.due_at.localeCompare(b.due_at) || a.word.localeCompare(b.word))
  return rows.sort((a, b) => b.added_at.localeCompare(a.added_at) || a.word.localeCompare(b.word)).slice(0, 2000)
}

export function vaultCountWordbookEntries(status: WordbookStatus, sourcePrefix?: string): number {
  return readEntries().filter((r) => r.status === status && (!sourcePrefix || r.source.startsWith(sourcePrefix))).length
}

export function vaultUpsertWordbookEntry(word: string, source: string): void {
  const rows = readEntries()
  const now = localNow()
  const i = rows.findIndex((r) => r.word === word)
  if (i >= 0) {
    rows[i] = { ...rows[i], status: 'learning', due_at: now, interval_days: 0, streak: 0 }
  } else {
    rows.push({
      word, status: 'learning', source, added_at: now, first_answer_at: null, last_review_at: null,
      due_at: now, interval_days: 0, ease: 2.5, streak: 0, review_count: 0, correct_count: 0, fuzzy_count: 0, wrong_count: 0,
    })
  }
  writeEntries(rows)
}

export function vaultDeleteWordbookEntry(word: string): void {
  writeEntries(readEntries().filter((r) => r.word !== word))
}

export function vaultSetWordbookMastered(word: string, mastered: boolean): void {
  const rows = readEntries()
  const i = rows.findIndex((r) => r.word === word)
  if (i < 0) return
  rows[i] = mastered
    ? { ...rows[i], status: 'mastered', due_at: '9999-12-31' }
    : { ...rows[i], status: 'learning', due_at: localNow() }
  writeEntries(rows)
}

/** 应用一次记忆反馈并推进 SRS（与 wordbookRepo.applyWordFeedback 同算法） */
export function vaultApplyWordFeedback(word: string, feedback: WordbookFeedback): WordbookEntryRow | null {
  const rows = readEntries()
  const i = rows.findIndex((r) => r.word === word)
  if (i < 0) return null
  const entry = rows[i]
  const isNew = !entry.first_answer_at
  const LADDER = [1, 2, 4, 8, 15, 30, 60]
  let interval: number
  let ease = entry.ease ?? 2.5
  let streak = entry.streak ?? 0

  if (feedback === 'known') {
    streak += 1
    ease = Math.min(3.0, ease + 0.03)
    if (isNew) interval = LADDER[Math.min(streak - 1, LADDER.length - 1)]
    else interval = Math.min((entry.interval_days || 1) * ease, 365)
  } else if (feedback === 'fuzzy') {
    streak = Math.max(0, streak - 1)
    ease = Math.max(1.3, ease - 0.05)
    interval = Math.max(1, Math.floor((entry.interval_days || 1) * 0.6))
  } else {
    streak = 0
    ease = Math.max(1.3, ease - 0.2)
    interval = 0
  }
  const now = localNow()
  const next: WordbookEntryRow = {
    ...entry,
    first_answer_at: entry.first_answer_at ?? now,
    last_review_at: now,
    due_at: interval === 0 ? now : localDayPlus(now, Math.round(interval)),
    interval_days: interval,
    ease,
    streak,
    review_count: (entry.review_count ?? 0) + 1,
    correct_count: (entry.correct_count ?? 0) + (feedback === 'known' ? 1 : 0),
    fuzzy_count: (entry.fuzzy_count ?? 0) + (feedback === 'fuzzy' ? 1 : 0),
    wrong_count: (entry.wrong_count ?? 0) + (feedback === 'unknown' ? 1 : 0),
  }
  rows[i] = next
  writeEntries(rows)
  return next
}

function localDayPlus(now: string, days: number): string {
  const d = new Date(now.replace(' ', 'T'))
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ===== 每日学习量 =====
export function vaultGetDailyStat(date: string): { new_words: number; reviewed: number } {
  const r = readDaily().find((x) => x.date === date)
  return r ?? { new_words: 0, reviewed: 0 }
}

export function vaultBumpDailyStat(date: string, isNew: boolean): void {
  const rows = readDaily()
  const i = rows.findIndex((x) => x.date === date)
  if (i >= 0) {
    rows[i] = { date, new_words: rows[i].new_words + (isNew ? 1 : 0), reviewed: rows[i].reviewed + 1 }
  } else {
    rows.push({ date, new_words: isNew ? 1 : 0, reviewed: 1 })
  }
  writeDaily(rows)
}

export function vaultListDailyStats(days: number): Array<{ date: string; new_words: number; reviewed: number }> {
  return readDaily().sort((a, b) => b.date.localeCompare(a.date)).slice(0, days)
}

// ===== 自定义分组 =====
export function vaultListWordbookGroups(): Array<{ id: string; name: string; created_at: string; wordCount: number }> {
  return readGroups().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((g) => ({ id: g.id, name: g.name, created_at: g.created_at, wordCount: g.words.length }))
}

export function vaultCreateWordbookGroup(name: string): { id: string; name: string; created_at: string } {
  const rows = readGroups()
  const g: GroupJson = { id: randomUUID(), name, created_at: localNow(), words: [] }
  writeGroups([...rows, g])
  return { id: g.id, name: g.name, created_at: g.created_at }
}

export function vaultRenameWordbookGroup(id: string, name: string): void {
  writeGroups(readGroups().map((g) => (g.id === id ? { ...g, name } : g)))
}

export function vaultDeleteWordbookGroup(id: string): void {
  writeGroups(readGroups().filter((g) => g.id !== id))
}

export function vaultAddWordToGroup(groupId: string, word: string): void {
  writeGroups(readGroups().map((g) => (g.id === groupId && !g.words.includes(word) ? { ...g, words: [...g.words, word] } : g)))
}

export function vaultRemoveWordFromGroup(groupId: string, word: string): void {
  writeGroups(readGroups().map((g) => (g.id === groupId ? { ...g, words: g.words.filter((w) => w !== word) } : g)))
}

export function vaultListGroupWords(groupId: string): string[] {
  return readGroups().find((g) => g.id === groupId)?.words.slice().sort() ?? []
}

export function vaultGetWordbookGroup(id: string): { id: string; name: string; created_at: string } | null {
  const g = readGroups().find((x) => x.id === id)
  return g ? { id: g.id, name: g.name, created_at: g.created_at } : null
}
