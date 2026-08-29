/**
 * 单词本共享类型（主进程与渲染层共用）。
 * tsconfig.node 只显式放行 settings.ts / translateTypes.ts / 本文件。
 */

export type WordbookBook = 'cet4' | 'cet6' | 'ky'
export type WordFeedback = 'known' | 'fuzzy' | 'unknown'
export type WordbookStatus = 'learning' | 'mastered'

/** 学习队列里的一张卡：词条信息 + 四选一选项 */
export interface WordbookItemDto {
  word: string
  /** true=新词（首次学习）/ false=到期复习 */
  isNew: boolean
  phonetic: string
  translationLines: string[]
  tags: string[]
  /** 四个释义选项（乱序后的翻译首行） */
  options: string[]
  /** 正确选项文本（=translationLines[0]） */
  answer: string
  /** 词书新词的所属词书 */
  book?: WordbookBook
}

export interface WordbookEntryDto {
  word: string
  status: WordbookStatus
  source: string
  addedAt: string
  dueAt: string
  intervalDays: number
  ease: number
  streak: number
  reviewCount: number
  correctCount: number
  fuzzyCount: number
  wrongCount: number
  phonetic: string
  translationLines: string[]
  tags: string[]
}

export interface WordbookTodayDto {
  book: WordbookBook | ''
  /** 词书总词数 / 已学（该词书中已在生词本且首答过的词） */
  bookTotal: number
  bookLearned: number
  /** 今日计划新学数（设置）与已完成 */
  newTarget: number
  newDone: number
  /** 今日已答题数 */
  answeredToday: number
  /** 连续学习天数 */
  streakDays: number
  items: WordbookItemDto[]
}

export interface WordbookStatsDto {
  streakDays: number
  answeredToday: number
  totalLearning: number
  totalMastered: number
  recent: { date: string; new_words: number; reviewed: number }[]
}
