/**
 * 划词翻译 / 词典共享类型（主进程与渲染层共用）。
 * 放在 src/lib 下是因为 tsconfig.node 只显式放行 settings.ts 与本文件。
 */

/** 单词查询结果（离线 ECDICT 精简库） */
export interface DictWordEntry {
  /** 实际命中的词条拼写（含原型还原后的词） */
  word: string
  /** 原始查询词 */
  query: string
  /** 若经词形还原命中，此处为用户输入的原形（如 queried → query） */
  inflectedFrom?: string
  /** 音标（ECDICT 单字段，通常是英式） */
  phonetic: string
  /** 中文释义，按换行拆分（每行自带词性前缀，如 "n. 苹果"） */
  translationLines: string[]
  /** 英文释义 */
  definition: string
  /** 考纲标签原始值：cet4 / cet6 / ky / toefl / ielts / gre / gk / zk */
  tags: string[]
  /** 柯林斯星级 1-5（0 = 无标注） */
  collins: number
  /** 牛津三千核心词 1/0 */
  oxford: number
  /** BNC 词频排名（0 = 未入榜） */
  bnc: number
  /** 当代语料库词频排名（0 = 未入榜） */
  frq: number
  /** 词形变化（已解析） */
  exchange: DictExchange
}

export interface DictExchange {
  /** 过去式 */
  past?: string
  /** 过去分词 */
  pp?: string
  /** 现在分词 */
  ing?: string
  /** 第三人称单数 */
  s3?: string
  /** 名词复数 */
  plural?: string
  /** 比较级 */
  er?: string
  /** 最高级 */
  est?: string
}

export interface DictLookupResult {
  found: boolean
  entry?: DictWordEntry
}

export interface DictStatus {
  available: boolean
  wordCount: number
}

export type TranslateMode = 'word' | 'sentence'

export interface TranslateInvokeRequest {
  text: string
  /** 不传自动判断：单个英文 token 为 word，否则 sentence */
  mode?: TranslateMode
  /** word 模式下是否附加 AI 精讲（句子模式恒为 LLM 翻译） */
  ai?: boolean
}

export type TranslateInvokeResult = {
  ok: true
  mode: TranslateMode
  /** sentence 模式的 LLM 译文 / word+ai 模式的 AI 精讲 Markdown */
  markdown: string
  model: string
  /** 命中本地缓存，未消耗 token */
  cached: boolean
  /** word 模式附带离线词典结果（无论是否 ai） */
  dict?: DictLookupResult
} | {
  ok: false
  mode?: TranslateMode
  error: string
  code?: 'NO_DEFAULT_MODEL' | 'PROVIDER_NOT_FOUND' | 'PROVIDER_DISABLED' | 'BUDGET_EXCEEDED' | 'EMPTY_TEXT' | 'TOO_LONG' | 'LLM_ERROR'
  /** word 模式即使 LLM 失败也会带回词典结果 */
  dict?: DictLookupResult
}
