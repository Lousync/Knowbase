import * as V from '../../lib/kbStore/wordbookVaultRepo'

/**
 * 生词本（迁移 051）：词条 + SRS 状态 + 每日学习量。
 * R6 去库化：真相源 = .knowbase/modules/wordbook/*.json（sql.js 路径已移除，D9）。
 */

export type WordbookStatus = 'learning' | 'mastered'
export type WordbookFeedback = 'known' | 'fuzzy' | 'unknown'
/** 兼容别名（wordbookService 及历史调用方按此名 import） */
export type WordFeedback = WordbookFeedback

export interface WordbookEntryRow {
  word: string
  status: WordbookStatus
  source: string
  added_at: string
  first_answer_at: string | null
  last_review_at: string | null
  due_at: string
  interval_days: number
  ease: number
  streak: number
  review_count: number
  correct_count: number
  fuzzy_count: number
  wrong_count: number
}

export function getWordbookEntry(word: string): WordbookEntryRow | null {
  return V.vaultGetWordbookEntry(word)
}

export function listWordbookEntries(status?: WordbookStatus): WordbookEntryRow[] {
  return V.vaultListWordbookEntries(status)
}

export function countWordbookEntries(status: WordbookStatus, sourcePrefix?: string): number {
  return V.vaultCountWordbookEntries(status, sourcePrefix)
}

export function upsertWordbookEntry(word: string, source: string): void {
  return V.vaultUpsertWordbookEntry(word, source)
}

export function deleteWordbookEntry(word: string): void {
  return V.vaultDeleteWordbookEntry(word)
}

export function setWordbookMastered(word: string, mastered: boolean): void {
  return V.vaultSetWordbookMastered(word, mastered)
}

/** 应用一次记忆反馈并推进 SRS（simplified SM-2）。
 *  调用方保证词条已存在：新词先 upsertWordbookEntry 再调本函数。 */
export function applyWordFeedback(word: string, feedback: WordbookFeedback): WordbookEntryRow | null {
  return V.vaultApplyWordFeedback(word, feedback)
}

// ===== 每日学习量 =====

export function todayKey(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function getDailyStat(date: string): { new_words: number; reviewed: number } {
  return V.vaultGetDailyStat(date)
}

export function bumpDailyStat(date: string, isNew: boolean): void {
  return V.vaultBumpDailyStat(date, isNew)
}

/** 最近 N 天每日学习量（含无学习日的 0，用于连续天数与趋势） */
export function listDailyStats(days: number): { date: string; new_words: number; reviewed: number }[] {
  return V.vaultListDailyStats(days)
}

// ===== 自定义词汇分组（话题归类，迁移 054） =====

export interface WordbookGroupRow {
  id: string
  name: string
  created_at: string
}

export function listWordbookGroups(): (WordbookGroupRow & { wordCount: number })[] {
  return V.vaultListWordbookGroups()
}

export function createWordbookGroup(name: string): WordbookGroupRow {
  return V.vaultCreateWordbookGroup(name)
}

export function renameWordbookGroup(id: string, name: string): void {
  return V.vaultRenameWordbookGroup(id, name)
}

export function deleteWordbookGroup(id: string): void {
  return V.vaultDeleteWordbookGroup(id)
}

export function addWordToGroup(groupId: string, word: string): void {
  return V.vaultAddWordToGroup(groupId, word)
}

export function removeWordFromGroup(groupId: string, word: string): void {
  return V.vaultRemoveWordFromGroup(groupId, word)
}

export function listGroupWords(groupId: string): string[] {
  return V.vaultListGroupWords(groupId)
}

export function getWordbookGroup(id: string): WordbookGroupRow | null {
  return V.vaultGetWordbookGroup(id)
}
