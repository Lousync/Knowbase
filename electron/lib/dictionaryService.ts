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

interface DictData {
  v: number
  words: Record<string, RawEntry>
  lemma: Record<string, string>
}

let data: DictData | null = null

function dictPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(base, 'resources', 'dict', 'ecdict-exam.json')
}

function ensureLoaded(): DictData | null {
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
  const d = ensureLoaded()
  const count = d ? Object.keys(d.words).length : 0
  return { available: count > 0, wordCount: count }
}
