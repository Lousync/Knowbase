import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { DictExchange, DictLookupResult, DictStatus, DictWordEntry } from '../../src/lib/translateTypes'

/**
 * 离线词典：ECDICT 精简库（resources/dict/ecdict-exam.json，构建脚本
 * scripts/build-exam-dict.py 从全量 ECDICT 筛选四六级/考研等考纲词生成）。
 * 惰性加载一次进内存，查询为纯 Map 命中；词形还原依赖数据内嵌的 lemma 反查表，
 * 未命中时再做规则式变形尝试（复数/时态/分词）。
 */

// 精简库词条字段（数组按下标取值，省文件体积）
// [phonetic, translation, definition, tag, collins, oxford, bnc, frq, exchange]
type RawEntry = [string, string, string, string, number, number, number, number, string]

interface RootInfo { m: string; c: string; o: string; words: string[] }

interface DictData {
  v: number
  words: Record<string, RawEntry>
  lemma: Record<string, string>
  roots?: Record<string, RootInfo>
  wordRoots?: Record<string, string[]>
  synonyms?: Record<string, string[]>
}

let data: DictData | null = null

function dictPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(base, 'resources', 'dict', 'ecdict-exam.json')
}

function ensureLoaded(): DictData {
  if (data) return data
  try {
    data = JSON.parse(readFileSync(dictPath(), 'utf-8')) as DictData
  } catch (err) {
    console.error('[dict] 词典数据加载失败:', dictPath(), err)
    data = { v: 1, words: {}, lemma: {} }
  }
  return data
}

function parseExchange(raw: string): DictExchange {
  const out: DictExchange = {}
  if (!raw) return out
  for (const part of raw.split('/')) {
    const i = part.indexOf(':')
    if (i < 1) continue
    const key = part.slice(0, i)
    const value = part.slice(i + 1).trim()
    if (!value) continue
    // ECDICT exchange 键位: p过去式 d过去分词 i现在分词 3三单 r比较级 t最高级 s复数
    if (key === 'p') out.past = value
    else if (key === 'd') out.pp = value
    else if (key === 'i') out.ing = value
    else if (key === '3') out.s3 = value
    else if (key === 's') out.plural = value
    else if (key === 'r') out.er = value
    else if (key === 't') out.est = value
  }
  return out
}

function toEntry(query: string, word: string, raw: RawEntry, inflectedFrom?: string): DictWordEntry {
  return {
    word,
    query,
    inflectedFrom,
    phonetic: raw[0] || '',
    translationLines: (raw[1] || '').split('\n').map(l => l.trim()).filter(Boolean),
    definition: raw[2] || '',
    tags: (raw[3] || '').split(/\s+/).filter(Boolean),
    collins: Number(raw[4]) || 0,
    oxford: Number(raw[5]) || 0,
    bnc: Number(raw[6]) || 0,
    frq: Number(raw[7]) || 0,
    exchange: parseExchange(raw[8] || ''),
  }
}

function normalize(word: string): string {
  return word.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '')
}

/** 规则式变形还原（lemma 表未覆盖时兜底） */
function morphologicalCandidates(w: string): string[] {
  const cands: string[] = []
  const push = (s: string) => { if (s.length > 1) cands.push(s) }
  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) push(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1))
  if (w.endsWith('ied')) push(w.slice(0, -3) + 'y')
  if (w.endsWith('ed')) {
    push(w.slice(0, -1))       // doubled consonant: stopped → stopp-ed? 先试去 e
    push(w.slice(0, -2))
    push(w.slice(0, -2) + 'e') // hoped → hope
  }
  if (w.endsWith('ing')) {
    push(w.slice(0, -3))
    push(w.slice(0, -3) + 'e') // hoping → hope
  }
  // 双写辅音还原: stopped → stopp → stop
  if (/(.)\1ed$/.test(w) || /(.)\1ing$/.test(w)) {
    push(w.slice(0, -3))
  }
  if (w.endsWith('est')) {
    push(w.slice(0, -3))
    push(w.slice(0, -3) + 'e')
  }
  if (w.endsWith('er')) {
    push(w.slice(0, -2))
    push(w.slice(0, -2) + 'e')
  }
  return cands
}

export function lookupWord(rawWord: string): DictLookupResult {
  const d = ensureLoaded()
  const query = rawWord.trim()
  if (!d || !query) return { found: false }
  const norm = normalize(query)
  if (!norm) return { found: false }

  const direct = d.words[norm]
  if (direct) return { found: true, entry: toEntry(query, norm, direct) }

  // 词形还原表（inflected → base）优先
  const base = d.lemma[norm]
  if (base) {
    const hit = d.words[base]
    if (hit) return { found: true, entry: toEntry(query, base, hit, norm) }
  }
  // 规则式变形兜底
  for (const cand of morphologicalCandidates(norm)) {
    const candBase = d.lemma[cand] ?? cand
    const hit = d.words[candBase]
    if (hit) return { found: true, entry: toEntry(query, candBase, hit, norm) }
  }
  return { found: false }
}

export function getDictionaryStatus(): DictStatus {
  const count = Object.keys(ensureLoaded().words).length
  return { available: count > 0, wordCount: count }
}

// ===== 词书词表（按 ECDICT 考纲标签派生，供单词本模块使用） =====

export type BookId = 'cet4' | 'cet6' | 'ky'

const BOOK_IDS: BookId[] = ['cet4', 'cet6', 'ky']

export function isBookId(v: string): v is BookId {
  return (BOOK_IDS as string[]).includes(v)
}

interface BookWord { word: string; frq: number }

const bookCache = new Map<BookId, BookWord[]>()

/** 词书词表：按使用词频升序（高频在前），惰性构建并缓存 */
export function getBookWords(book: BookId): BookWord[] {
  const cached = bookCache.get(book)
  if (cached) return cached
  const d = ensureLoaded()
  const list: BookWord[] = []
  for (const [word, raw] of Object.entries(d.words)) {
    if ((raw[3] || '').split(/\s+/).includes(book)) {
      list.push({ word, frq: Number(raw[7]) || 999999 })
    }
  }
  list.sort((a, b) => a.frq - b.frq)
  bookCache.set(book, list)
  return list
}

/** 取翻译首行（选项展示用）；未收录返回空串 */
export function getPrimaryTranslation(word: string): string {
  const raw = ensureLoaded().words[word.toLowerCase()]
  if (!raw) return ''
  return (raw[1] || '').split('\n')[0].trim()
}

/** 选项文本对齐处理：剥领域标签前缀、截到统一长度，避免答案靠格式泄露 */
export function formatOptionLine(line: string): string {
  let s = line.replace(/^\[[^\]]*\]\s*/, '')   // "[计] 查询" → "查询"
  // 逗号切分，保留词性前缀与第一个释义，总长不超过 14 字
  const posMatch = /^([a-z]+\.\s*)/.exec(s)
  const pos = posMatch ? posMatch[1] : ''
  let body = s.slice(pos.length)
  const seg = body.split(/[,，;；]/)[0].trim()
  if (seg.length >= 4) body = seg
  if (pos + body !== s && body.length > 14) body = body.slice(0, 14)
  return (pos + body).trim()
}

/** 为答案词挑 n 个干扰项释义（同词书优先，格式化后互不相同） */
export function pickDistractors(answer: string, book: BookId | null, n: number): string[] {
  const d = ensureLoaded()
  const answerLine = formatOptionLine(getPrimaryTranslation(answer))
  const pool: string[] = book ? getBookWords(book).map(w => w.word) : Object.keys(d.words)
  const out: string[] = []
  const seen = new Set([answerLine])
  const start = Math.floor(Math.random() * pool.length)
  for (let i = 0; i < pool.length && out.length < n; i++) {
    const w = pool[(start + i) % pool.length]
    if (w === answer.toLowerCase()) continue
    const line = formatOptionLine(getPrimaryTranslation(w))
    if (!line || line.length < 2 || seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/** 为 cloze 题挑 n 个拼写干扰词（同词书、长度相近） */
export function pickWordDistractors(answer: string, book: BookId | null, n: number): string[] {
  const d = ensureLoaded()
  const target = answer.toLowerCase()
  const pool = (book ? getBookWords(book).map(w => w.word) : Object.keys(d.words))
    .filter(w => Math.abs(w.length - target.length) <= 2 && w !== target)
  const out: string[] = []
  const seen = new Set([target])
  const start = Math.floor(Math.random() * Math.max(1, pool.length))
  for (let i = 0; i < pool.length && out.length < n; i++) {
    const w = pool[(start + i) % pool.length]
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

// ===== 词根（同根词体系，数据来自 ECDICT wordroot） =====

export interface RootCluster {
  root: string
  meaning: string
  wordClass: string
  origin: string
  words: string[]
}

/** 一个词的词根列表（可能为空） */
export function getWordRoots(word: string): string[] {
  return ensureLoaded().wordRoots?.[word.trim().toLowerCase()] ?? []
}

/** 词根详情与同根词 */
export function getRootCluster(root: string): RootCluster | null {
  const info = ensureLoaded().roots?.[root]
  if (!info) return null
  return { root, meaning: info.m, wordClass: info.c, origin: info.o, words: info.words }
}

/** 一个词的近义词（同在词典内的，最多 6 个；可能为空） */
export function getSynonyms(word: string): string[] {
  return ensureLoaded().synonyms?.[word.trim().toLowerCase()] ?? []
}
