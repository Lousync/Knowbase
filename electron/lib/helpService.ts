import { app } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

/**
 * 帮助手册服务（主进程侧）
 *
 * 背景：帮助文档原先只存在于 `src/modules/help/docs/`，由渲染层 `import.meta.glob` 编译进
 * bundle —— 主进程（AI）完全读不到。2026-09-10 迁到项目根的 `resources/help/`，
 * 渲染层与主进程读同一份，喂给 AI 的知识与用户看到的手册不会再漂移。
 * 设计见 docs/ai-learn-center-design.md §7.3 / §7.5。
 *
 * 只做「读 + 检索」，不做写。检索结果直接作为工具返回值给模型。
 */

export interface HelpDocRaw {
  /** 文件名去扩展名，如「快速上手」 */
  id: string
  title: string
  category: string
  /** frontmatter 里的检索别名（用户口语说法） */
  keywords: string[]
  body: string
}

export interface HelpHit {
  id: string
  title: string
  category: string
  /** 命中位置附近的正文片段 */
  snippet: string
  score: number
}

/** 资源根解析（与 dictionaryService 同款；直接以 js 启动时 appPath 可能偏，故多探几个位置） */
function helpDirCandidates(): string[] {
  if (app.isPackaged) return [join(process.resourcesPath, 'help')]
  const appPath = app.getAppPath()
  return [
    join(appPath, 'resources', 'help'),
    resolve(appPath, '..', '..', 'resources', 'help'),
    join(process.cwd(), 'resources', 'help'),
  ]
}

function helpDir(): string | null {
  for (const p of helpDirCandidates()) {
    try { if (existsSync(p)) return p } catch { /* 下一个 */ }
  }
  return null
}

/** 极简 frontmatter：与渲染层 docsLoader 同规则（CRLF 必须先归一，否则 kv 正则吃不到行尾） */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const text = raw.replace(/\r\n/g, '\n')
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!m) return null
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w ]*?)\s*:\s*(.+)$/)
    if (kv) meta[kv[1].trim()] = kv[2].trim()
  }
  return { meta, body: m[2] }
}

/** `[a, b, c]` 或 `a, b` → 字符串数组 */
function parseList(v?: string): string[] {
  if (!v) return []
  return v.replace(/^\[|\]$/g, '').split(/[,，]/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
}

/** 读取全部手册（无目录/读失败 → 空数组，绝不抛给调用方） */
export function loadHelpDocs(): HelpDocRaw[] {
  const dir = helpDir()
  if (!dir) return []
  let files: string[] = []
  try { files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md')) } catch { return [] }

  const out: HelpDocRaw[] = []
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf8')
      const parsed = parseFrontmatter(raw)
      if (!parsed) continue
      const id = f.replace(/\.md$/i, '')
      out.push({
        id,
        title: parsed.meta.title || id,
        category: parsed.meta.category || '未分类',
        keywords: parseList(parsed.meta.keywords),
        body: parsed.body,
      })
    } catch { /* 单篇失败不影响其它 */ }
  }
  return out
}

/** 取命中位置附近的片段（前后各留一段，尽量落在段落边界） */
function snippetOf(body: string, needle: string, span = 700): string {
  const idx = body.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return body.slice(0, span)
  const start = Math.max(0, idx - Math.floor(span / 3))
  const text = body.slice(start, start + span)
  return (start > 0 ? '…' : '') + text + (start + span < body.length ? '…' : '')
}

/** 停用词（bigram 形式）：这些词在任何文档里都常见，留着只会稀释信号 */
const STOP_TERMS = new Set([
  '怎么', '为什么', '什么', '如何', '是否', '可以', '能不能', '有没有', '一个', '这个', '那个',
  '哪里', '在哪', '为什', '请问', '帮我', '一下', '的话', '不会', '不是', '我要', '我想', '我的',
])

/**
 * 查询分词：英文按原词，中文切 **bigram**（相邻两字滑窗）。
 *
 * 为什么必须切：中文没有空格，把「知识库看不到文件」整句当一个词去匹配，
 * 文档里根本不存在这个连续串 —— 必然全部落空（2026-09-10 自检实测 14 问错 6 问）。
 * 切成 bigram 后，「知识」「识库」「看不」「不到」「文件」各自命中，召回恢复正常。
 */
export function tokenize(query: string): string[] {
  const cleaned = query.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
  const out = new Set<string>()
  for (const m of cleaned.matchAll(/[a-z0-9][a-z0-9._-]*/g)) {
    if (m[0].length >= 2) out.add(m[0])
  }
  for (const run of cleaned.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (run.length === 1) { out.add(run); continue }
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2))
  }
  for (const s of STOP_TERMS) out.delete(s)
  return [...out]
}

/**
 * 手册检索：标题 > keywords > 正文，按命中词数累加。
 * 只算「命中与否」而不算出现次数 —— 出现次数会让长文档霸榜，而这里要的是相关性排序。
 */
export function searchHelp(query: string, limit = 3, id?: string): { hits: HelpHit[]; total: number; hint?: string } {
  const all = loadHelpDocs()
  if (all.length === 0) {
    return { hits: [], total: 0, hint: '帮助手册目录未找到（resources/help）。请如实告知用户当前无法查阅手册，不要凭空编造软件用法。' }
  }

  // 指定 id → 直接返回全文（供模型深读某一篇）
  if (id) {
    const doc = all.find(d => d.id === id || d.title === id)
    if (!doc) return { hits: [], total: all.length, hint: `没有名为「${id}」的手册，可用的是：${all.map(d => d.id).join('、')}` }
    return {
      hits: [{ id: doc.id, title: doc.title, category: doc.category, snippet: doc.body.slice(0, 4000), score: 99 }],
      total: all.length,
    }
  }

  const terms = tokenize(query)
  if (terms.length === 0) return { hits: [], total: all.length, hint: '请给出更具体的关键词' }

  const hits: HelpHit[] = []
  for (const d of all) {
    const lowerTitle = d.title.toLowerCase()
    const lowerKeys = d.keywords.join(' ').toLowerCase()
    const lowerBody = d.body.toLowerCase()
    let score = 0
    for (const t of terms) {
      if (lowerTitle.includes(t)) score += 10
      else if (lowerKeys.includes(t)) score += 6
      if (lowerBody.includes(t)) score += 1
    }
    if (score > 0) {
      const first = terms.find(t => lowerBody.includes(t)) ?? terms[0]
      hits.push({ id: d.id, title: d.title, category: d.category, snippet: snippetOf(d.body, first), score })
    }
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  const top = hits.slice(0, Math.max(1, Math.min(5, limit)))
  return {
    hits: top,
    total: all.length,
    ...(top.length === 0
      ? { hint: `未命中任何手册。现有手册：${all.map(d => d.title).join('、')}。若确实没有相关内容，如实说明，不要编造软件用法。` }
      : { hint: '以上为官方手册原文片段，回答时请以这些内容为准，并注明手册标题。' }),
  }
}
