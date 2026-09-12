import type { KnowledgePageIndexEntry } from './knowledgeIndex'

/**
 * 知识检索纯算法（knowledge-index-design §8）—— 从 knowledgeSearch 抽出便于 node 冒烟。
 * 关键词评分 / RRF 融合 / 摘要截取，全部无 IO、无 electron。
 */

export interface KnowledgeSearchFilters {
  tags?: string[]
  categoryId?: string | null
  /** 排除页（相似笔记场景排除自身） */
  excludePageIds?: string[]
}

export interface KeywordHit { page: KnowledgePageIndexEntry; score: number; matched: number }

/**
 * 关键词路评分：v1 是布尔 AND（一票否决），这里放宽为
 * 「命中词数为主 + 标题命中与词频加权」——部分命中也能进融合池，由排序决定位置。
 */
export function scoreKeywordPages(
  query: string,
  pages: KnowledgePageIndexEntry[],
  textById: Record<string, string>,
  filters?: KnowledgeSearchFilters,
): KeywordHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const exclude = new Set(filters?.excludePageIds ?? [])
  const needTags = (filters?.tags ?? []).map((t) => t.toLowerCase())
  const out: KeywordHit[] = []
  for (const page of pages) {
    if (exclude.has(page.id)) continue
    if (filters?.categoryId != null && page.categoryId !== filters.categoryId) continue
    if (needTags.length > 0) {
      const pageTags = page.tags.map((t) => t.toLowerCase())
      if (!needTags.every((t) => pageTags.some((pt) => pt.includes(t)))) continue
    }
    const plain = (textById[page.id] ?? '').toLowerCase()
    const titleL = page.title.toLowerCase()
    let matched = 0
    let titleHits = 0
    let bodyHits = 0
    for (const term of terms) {
      const inTitle = titleL.includes(term)
      const inBody = plain.includes(term)
      if (!inTitle && !inBody) continue
      matched++
      if (inTitle) titleHits++
      if (inBody) bodyHits += Math.min(plain.split(term).length - 1, 8)
    }
    if (matched === 0) continue
    out.push({ page, score: matched * 10 + titleHits * 3 + bodyHits * 0.5, matched })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

/**
 * RRF 融合（k=60）：两路排名倒数求和。via 标注单路来源或 hybrid，
 * 供 AI 工具结果与 UI 展示「这条是怎么命中的」。
 */
export function rrfFuse(
  keywordRanked: string[],
  semanticRanked: string[],
  k = 60,
): Map<string, { score: number; via: 'keyword' | 'semantic' | 'hybrid' }> {
  const fused = new Map<string, { score: number; via: 'keyword' | 'semantic' | 'hybrid' }>()
  keywordRanked.forEach((id, i) => {
    const e = fused.get(id) ?? { score: 0, via: 'keyword' as const }
    e.score += 1 / (k + i + 1)
    fused.set(id, e)
  })
  semanticRanked.forEach((id, i) => {
    const e = fused.get(id) ?? { score: 0, via: 'semantic' as const }
    e.score += 1 / (k + i + 1)
    e.via = fused.has(id) ? 'hybrid' : 'semantic'
    fused.set(id, e)
  })
  return fused
}

/** 摘要：优先在首个命中词附近开窗（关键词路）；语义路不用（块原文即摘要） */
export function excerptAround(plain: string, terms: string[], max = 200): string {
  const p = plain.trim()
  if (p.length <= max) return p
  for (const term of terms) {
    const at = p.toLowerCase().indexOf(term.toLowerCase())
    if (at >= 0) {
      const start = Math.max(0, at - 60)
      return (start > 0 ? '…' : '') + p.slice(start, start + max) + (start + max < p.length ? '…' : '')
    }
  }
  return p.slice(0, max) + '…'
}
