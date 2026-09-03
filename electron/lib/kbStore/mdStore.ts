import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getVaultKbRoot } from './vaultContext'

/**
 * Markdown 文件存储（内容型模块：博客 / 知识库 Vault 化）。
 *
 * 格式对标 Obsidian：frontmatter（title/tags/aliases/created/updated）+ 正文。
 * 支持解析：
 * - `key: value`（去引号）
 * - `key: [a, b]`（内联数组）
 * - 列表块（`key:` 后接 `- item` 行）
 */

export interface MdDoc {
  frontmatter: Record<string, unknown>
  body: string
}

function parseScalar(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

/** 解析 frontmatter YAML 子集 */
export function parseFrontmatter(raw: string): Record<string, unknown> {
  const meta: Record<string, unknown> = {}
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  let listKey: string | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    const arr = /^([\w-]+)\s*:\s*\[([^\]]*)\]\s*$/.exec(trimmed)
    if (arr) {
      meta[arr[1].trim()] = arr[2].split(',').map((s) => parseScalar(s)).filter(Boolean)
      listKey = null
      continue
    }
    const listItem = /^-\s+(.+)$/.exec(trimmed)
    if (listItem && listKey) {
      const cur = meta[listKey]
      if (Array.isArray(cur)) cur.push(parseScalar(listItem[1]))
      continue
    }
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(trimmed)
    if (kv) {
      const k = kv[1].trim()
      const v = kv[2].trim()
      if (v === '') {
        // 列表块开始
        meta[k] = []
        listKey = k
      } else {
        meta[k] = parseScalar(v)
        listKey = null
      }
    }
  }
  return meta
}

/** 解析 Markdown 文本 → frontmatter + 正文 */
export function parseMarkdown(raw: string): MdDoc {
  const text = raw.replace(/\r\n/g, '\n')
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(text)
  if (!m) return { frontmatter: {}, body: text }
  return { frontmatter: parseFrontmatter(m[1]), body: m[2].replace(/^\n/, '') }
}

/** 序列化 frontmatter + 正文 → Markdown 文本 */
export function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const keys = Object.keys(frontmatter)
  if (keys.length === 0) return body
  const lines: string[] = []
  for (const k of keys) {
    const v = frontmatter[k]
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`)
      } else if (v.every((x) => typeof x === 'string' && !/[:,]/.test(x) && !x.includes("'"))) {
        lines.push(`${k}: [${v.join(', ')}]`)
      } else {
        lines.push(`${k}:`)
        for (const item of v) lines.push(`  - ${String(item).replace(/\n/g, ' ')}`)
      }
    } else if (typeof v === 'string') {
      lines.push(`${k}: ${/^[\w\u4e00-\u9fa5\s.-]+$/.test(v) ? v : JSON.stringify(v)}`)
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  if (lines.length === 0) return body
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

/** 读 Markdown 文件（模块 key 可含子路径）；不存在返回 null */
export function readMarkdownFile(module: string, key: string): MdDoc | null {
  const root = getVaultKbRoot()
  if (!root) return null
  const p = join(root, module, key)
  if (!existsSync(p)) return null
  try {
    return parseMarkdown(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** 写 Markdown 文件（原子写），成功返回 true */
export function writeMarkdownFile(module: string, key: string, doc: MdDoc): boolean {
  const root = getVaultKbRoot()
  if (!root) return false
  const p = join(root, module, key)
  const dir = dirname(p)
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    writeFileSync(tmp, serializeMarkdown(doc.frontmatter, doc.body), 'utf-8')
    try {
      renameSync(tmp, p)
    } catch {
      if (existsSync(p)) unlinkSync(p)
      renameSync(tmp, p)
    }
    return true
  } catch {
    return false
  }
}
