#!/usr/bin/env node
/**
 * CHANGELOG.md → electron/lib/releaseNotes/data.ts
 *
 * 用途：应用内「更新说明」页的**完整条目清单**由 CHANGELOG 单一源生成，
 * 保证「网站更新日志 / 应用内更新说明」两处永不漂移。
 *
 * 设计取舍：
 * - 生成 TS 常量（而非 resources/ 下的 JSON）——随 electron-vite 打进主进程包，
 *   不需要 extraResources 配置，也没有 dev / 生产两条路径分支。
 * - **不写生成时间戳**：重跑必须零 diff（否则每次跑都产生无意义改动）。
 * - 解析容错优先于严格：CHANGELOG 是手写文档，格式会漂；遇到不认识的写法退化为
 *   普通条目而非丢弃，宁可多显示也不要漏（漏条目 = 用户以为这版没做这件事）。
 *
 * 用法：
 *   node .AGENT/scripts/release-notes/build-release-notes.mjs            # 生成
 *   node .AGENT/scripts/release-notes/build-release-notes.mjs --dry      # 只打印统计
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const SRC = join(ROOT, 'CHANGELOG.md')
const OUT = join(ROOT, 'electron', 'lib', 'releaseNotes', 'data.ts')

const DRY = process.argv.includes('--dry')
const STATS = process.argv.includes('--stats')

/** CHANGELOG 里 `## v2.6.4` 连着出现两次（前一个是空块，手写笔误）。
 *  按版本号归并而不是各出一条 —— 否则应用内会冒出两个同名版本，
 *  「上次展示的版本」比对也会含糊。归并后标题重复只是多写一行，不再产生幽灵版本。 */
const byVersion = new Map()

/** emoji / 关键词 → 分组类别。类别只用于渲染时的徽标与配色，不参与数据语义。 */
const KIND_RULES = [
  [/重构|🏗/, 'internal'],
  [/外壳|🖥/, 'feature'],
  [/新增|✨/, 'feature'],
  [/体验|🎨/, 'ux'],
  [/修复|🐛/, 'fix'],
  [/内部|🔧/, 'internal'],
]

function inferKind(rawHeading) {
  for (const [re, kind] of KIND_RULES) if (re.test(rawHeading)) return kind
  return 'other'
}

/** 去掉标题开头的 emoji / 变体选择符 / 零宽连接符 */
function stripEmoji(s) {
  return s.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim()
}

/** 去掉 Markdown 粗体标记（反引号保留，交给渲染层做行内 code） */
function plain(s) {
  return s.replace(/\*\*/g, '').trim()
}

/**
 * `- **标题**：正文` → { lead:'标题', rest:'正文' }；没有粗体前缀时 lead 为空串。
 * 正文里还混有粗体时一并剥掉（视觉层级已由 lead 表达，正文不再二次强调）。
 */
function splitLead(raw) {
  const m = /^\*\*(.+?)\*\*\s*[：:]\s*([\s\S]*)$/.exec(raw.trim())
  if (m) return { lead: plain(m[1]), rest: plain(m[2]) }
  return { lead: '', rest: plain(raw) }
}

function parse(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const notes = []
  const duplicates = []
  let cur = null
  let group = null
  let lastItem = null

  for (const line of lines) {
    const mVer = /^##\s+v(\S+?)(?:\s*[（(]([^）)]*)[）)])?\s*$/.exec(line)
    if (mVer) {
      const version = mVer[1]
      const dup = byVersion.get(version)
      if (dup) {
        duplicates.push(version)
        cur = dup
      } else {
        cur = { version, date: (mVer[2] || '').trim(), summary: '', groups: [] }
        byVersion.set(version, cur)
        notes.push(cur)
      }
      group = null
      lastItem = null
      continue
    }
    if (!cur) continue

    const mCat = /^###\s+(.+?)\s*$/.exec(line)
    if (mCat) {
      group = {
        title: stripEmoji(mCat[1]),
        kind: inferKind(mCat[1]),
        items: [],
      }
      cur.groups.push(group)
      lastItem = null
      continue
    }

    const mQuote = /^>\s?(.*)$/.exec(line)
    if (mQuote) {
      const t = plain(mQuote[1])
      if (t) cur.summary = cur.summary ? `${cur.summary} ${t}` : t
      continue
    }

    const mItem = /^(\s*)[-*]\s+(.+?)\s*$/.exec(line)
    if (mItem) {
      const indent = mItem[1].replace(/\t/g, '  ').length
      const { lead, rest } = splitLead(mItem[2])
      if (indent >= 2 && lastItem) {
        lastItem.sub.push(lead ? `${lead}：${rest}` : rest)
        continue
      }
      if (!group) {
        group = { title: '变更', kind: 'other', items: [] }
        cur.groups.push(group)
      }
      lastItem = { lead, rest, sub: [] }
      group.items.push(lastItem)
      continue
    }

    // 兜底：版本块内的游离文本行（手写文档偶有段落式描述），不丢
    const stray = line.trim()
    if (stray && !/^\[TOC\]$/i.test(stray) && !/^#/.test(stray) && !/^!\[/.test(stray)) {
      if (!group) {
        group = { title: '变更', kind: 'other', items: [] }
        cur.groups.push(group)
      }
      lastItem = { lead: '', rest: plain(stray), sub: [] }
      group.items.push(lastItem)
    }
  }

  // 空分组（只有标题没条目）丢弃，避免页面上出现空节
  for (const n of notes) n.groups = n.groups.filter((g) => g.items.length > 0)
  return { notes, duplicates }
}

function main() {
  const md = readFileSync(SRC, 'utf-8')
  const { notes, duplicates } = parse(md)

  const itemCount = notes.reduce((a, n) => a + n.groups.reduce((b, g) => b + g.items.length, 0), 0)
  const subCount = notes.reduce(
    (a, n) => a + n.groups.reduce((b, g) => b + g.items.reduce((c, i) => c + i.sub.length, 0), 0),
    0,
  )
  const withDate = notes.filter((n) => n.date).length

  console.log(`[release-notes] 解析 ${notes.length} 个版本 / ${itemCount} 条条目（含 ${subCount} 条子项）`)
  console.log(`[release-notes] 带日期的版本 ${withDate}/${notes.length}（其余为 CHANGELOG 原文缺日期）`)
  console.log(`[release-notes] 最新版本 ${notes[0]?.version ?? '(无)'}  最老版本 ${notes[notes.length - 1]?.version ?? '(无)'}`)
  if (duplicates.length) {
    console.warn(`[release-notes] ⚠ CHANGELOG 有重复版本号（已归并，建议修原文）：${[...new Set(duplicates)].join(', ')}`)
  }
  if (STATS) {
    for (const n of notes.slice(0, 3).concat(notes.slice(-2))) {
      const g = n.groups.map((x) => `${x.kind}:${x.title}(${x.items.length})`).join(' | ')
      console.log(`  ${n.version}${n.date ? ` (${n.date})` : ''} 摘要${n.summary ? '有' : '无'} → ${g || '(无分组)'}`)
    }
  }
  if (notes.length === 0) {
    console.error('[release-notes] 没有解析出任何版本 —— CHANGELOG 标题格式可能变了，终止')
    process.exit(1)
  }
  if (DRY) return

  const body = JSON.stringify(notes, null, 2)
  const file = `/**
 * 更新说明数据（完整条目清单）—— 由 CHANGELOG.md 生成，请勿手改。
 *
 * 重新生成：node .AGENT/scripts/release-notes/build-release-notes.mjs
 * 手写亮点（页面上部的「本版亮点」，不在此文件）：electron/lib/releaseNotes/highlights.ts
 *
 * 版本数：${notes.length}
 */
import type { ReleaseNote } from './types'

export const RELEASE_NOTES = ${body} as const satisfies readonly ReleaseNote[]
`

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, file, 'utf-8')
  console.log(`[release-notes] 已写出 ${OUT}（${Buffer.byteLength(file)} 字节）`)
}

main()
