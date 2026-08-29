/**
 * 单词本共享类型（主进程与渲染层共用）。
 * tsconfig.node 只显式放行 settings.ts / translateTypes.ts / wordbookTypes.ts / 本文件。
 */

export type WordbookBook = 'cet4' | 'cet6' | 'ky'
export type WordFeedback = 'known' | 'fuzzy' | 'unknown'
export type WordbookStatus = 'learning' | 'mastered'

/** 题型：choice=四选一辨义 listen=听音辨义 spell=拼写 cloze=例句填空 */
export type QuestionType = 'choice' | 'listen' | 'spell' | 'cloze'

/** 学习队列里的一张卡 */
export interface WordbookItemDto {
  word: string
  /** true=新词（首次学习）/ false=到期复习 */
  isNew: boolean
  /** 本卡题型（主进程按新词/复习轮换指派） */
  type: QuestionType
  phonetic: string
  translationLines: string[]
  /** 英文释义（翻面详情） */
  definition: string
  tags: string[]
  /** 词形变化（翻面详情，离线） */
  exchange: WordbookExchangeDto
  /** choice/listen 题的四个释义选项（已格式化对齐） */
  options: string[]
  /** choice/listen 的正确选项文本 */
  answer: string
  /** cloze 题的四个单词拼写选项 */
  wordOptions: string[]
  /** cloze 题：挖空后的例句（目标词替换为 ____） */
  clozeSentence: string
  /** 词书新词的所属词书 */
  book?: WordbookBook
}

export interface WordbookExchangeDto {
  past?: string
  pp?: string
  ing?: string
  s3?: string
  plural?: string
  er?: string
  est?: string
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
  /** 本队列构成：复习 / 新词（顶部账本展示） */
  reviewTotal: number
  newTotal: number
  items: WordbookItemDto[]
}

export interface WordbookStatsDto {
  streakDays: number
  answeredToday: number
  totalLearning: number
  totalMastered: number
  recent: { date: string; new_words: number; reviewed: number }[]
}

/** 词书词表浏览行（status: none=未入库 learning=学习中 mastered=已斩/已认识） */
export interface BookWordRowDto {
  word: string
  frq: number
  phonetic: string
  translationLine: string
  status: 'none' | 'learning' | 'mastered'
}

export interface BookWordsResultDto {
  total: number
  items: BookWordRowDto[]
}

// ===== 词汇体系：同根词 / 近义词 / 话题分组 =====

export interface WordRelationRowDto {
  word: string
  translationLine: string
  phonetic: string
  /** 生词本状态：none=未收藏 learning=学习中 mastered=已斩 */
  status: 'none' | 'learning' | 'mastered'
}

/** 同根词聚类（词根来自 ECDICT wordroot，即时推导不落库） */
export interface RootClusterDto {
  root: string
  meaning: string
  origin: string
  words: WordRelationRowDto[]
}

/** 近义词聚类（生词本内词按同义关系连通聚簇，上限 12 词） */
export interface SynonymClusterDto {
  words: WordRelationRowDto[]
}

export interface WordbookGroupDto {
  id: string
  name: string
  wordCount: number
}

/** 自定义强化复习队列（分组/词根/近义入口发起） */
export interface WordbookCustomQueueDto {
  label: string
  items: WordbookItemDto[]
}
