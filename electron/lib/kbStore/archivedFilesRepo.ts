import { existsSync, lstatSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import { randomUUID } from 'crypto'
import { readJson, writeJsonOrThrow } from './jsonStore'
import { getCurrentVault } from './vaultContext'
import { getVaultIgnore, isDirIgnored } from './ignoreFile'

/**
 * 全类型归档清单（docs/vault-archive-all-files-design.md §3）。
 *
 * md 的归档状态走 frontmatter 双态（id + status），非 md 文件与目录走本清单：
 * - 目录条目 = 动态前缀语义（D3）：rebuild 时凡位于该目录下的文件都算已归档，
 *   后续新增自动纳入；目录状态优先于 md 自身 frontmatter（B1，2026-09-10 拍板）。
 * - path 一律仓库内 posix 相对路径（与知识索引口径一致）。
 * - 写入必须落盘成功（writeJsonOrThrow）——归档动作会向用户报成功，静默失败
 *   会伪装成 ok（与 AI 写工具同一铁律）。
 */

export interface ArchivedEntry {
  id: string
  /** 仓库内 posix 相对路径 */
  path: string
  type: 'file' | 'dir'
  archivedAt: string
}

export interface ArchivedManifest {
  schemaVersion: 1
  entries: ArchivedEntry[]
}

const MANIFEST_MODULE = 'modules/knowledge'
const MANIFEST_KEY = 'archived-files.json'
const EMPTY_MANIFEST: ArchivedManifest = { schemaVersion: 1, entries: [] }

function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** 读清单并做形状消毒（坏条目丢弃；path 归一为 posix） */
export function readManifest(): ArchivedManifest {
  const raw = readJson<Partial<ArchivedManifest> | null>(MANIFEST_MODULE, MANIFEST_KEY, null)
  if (!raw || !Array.isArray(raw.entries)) return { ...EMPTY_MANIFEST, entries: [] }
  const entries: ArchivedEntry[] = []
  for (const e of raw.entries) {
    if (!e || typeof e !== 'object') continue
    const id = typeof (e as ArchivedEntry).id === 'string' ? (e as ArchivedEntry).id : ''
    const path = typeof (e as ArchivedEntry).path === 'string' ? toPosix((e as ArchivedEntry).path) : ''
    const type = (e as ArchivedEntry).type === 'dir' ? 'dir' : 'file'
    if (!id || !path) continue
    entries.push({ id, path, type, archivedAt: typeof (e as ArchivedEntry).archivedAt === 'string' ? (e as ArchivedEntry).archivedAt : new Date().toISOString() })
  }
  return { schemaVersion: 1, entries }
}

function writeManifest(manifest: ArchivedManifest): void {
  writeJsonOrThrow(MANIFEST_MODULE, MANIFEST_KEY, manifest)
}

/**
 * 归档路径校验（§3）：系统区 / .ignore / 符号链接 / 根本身一律拒绝。
 * 只校验目标自身；子路径命中 .ignore 由扫描层自然剪枝（B2 时序口径：外部后加规则
 * 同样只影响读层，不做归档时快照递归校验）。
 * 返回错误消息；null = 通过。
 */
export function validateArchivablePath(relPath: string, expectType: 'file' | 'dir'): string | null {
  const rel = toPosix(relPath)
  if (!rel) return '不能归档仓库根目录'
  const current = getCurrentVault()
  if (!current) return '没有打开的仓库'
  const segments = rel.split('/')
  for (const seg of segments) {
    // 系统区：. 开头（.knowbase/.git/.ignore…）、收件箱、历史遗留附件目录
    if (seg.startsWith('.')) return `「${seg}」是系统区（. 开头），不能归档`
    if (seg.toLowerCase() === '_inbox') return '收件箱（_inbox）是内部草稿区，不能归档'
    if (seg === '_attachments') return '附件目录（_attachments）是内部目录，不能归档'
  }
  // 逐段符号链接检查（防逃逸；祖先不存在会在下方存在性检查兜住）
  let cur = current.rootPath
  for (const seg of segments) {
    cur = join(cur, seg)
    try {
      if (lstatSync(cur).isSymbolicLink()) return '符号链接路径不能归档'
    } catch {
      return '路径不存在'
    }
  }
  const abs = join(current.rootPath, rel)
  try {
    const st = lstatSync(abs)
    if (expectType === 'dir' && !st.isDirectory()) return '目标不是目录'
    if (expectType === 'file' && !st.isFile()) return '目标不是文件'
  } catch {
    return '路径不存在'
  }
  // .ignore 命中拒绝（与扫描层同一套判定）
  const { ign } = getVaultIgnore()
  if (ign) {
    if (expectType === 'dir' ? isDirIgnored(ign, rel) : ign.ignores(rel)) {
      return '该路径被 .ignore 规则命中，不能归档'
    }
  }
  return null
}

/**
 * rel 是否被清单覆盖（文件条目精确命中 || 任一目录条目前缀命中）。
 * 供索引 rebuild / kbview 白名单判定；目录命中即覆盖一切文件类型（B1）。
 */
export function isArchivedByManifest(relPath: string, manifest?: ArchivedManifest): boolean {
  const rel = toPosix(relPath)
  if (!rel) return false
  const m = manifest ?? readManifest()
  return m.entries.some((e) => e.type === 'file' ? e.path === rel : rel === e.path || rel.startsWith(`${e.path}/`))
}

/** 找到覆盖 rel 的目录条目（供 B1：目录状态优先于 md frontmatter status） */
export function findCoveringDirEntry(relPath: string, manifest?: ArchivedManifest): ArchivedEntry | null {
  const rel = toPosix(relPath)
  if (!rel) return null
  const m = manifest ?? readManifest()
  return m.entries.find((e) => e.type === 'dir' && (rel === e.path || rel.startsWith(`${e.path}/`))) ?? null
}

/**
 * 追加归档条目（幂等：同 path 已存在直接返回既有条目）。
 * 返回 { id, count }：count = 目录归档时目录下的常规文件数（跳过 . 开头/_inbox/_attachments
 * 与符号链接，供 toast 文案）；文件归档为 1。
 */
export function addArchiveEntry(relPath: string, type: 'file' | 'dir'): { id: string; count: number } {
  const rel = toPosix(relPath)
  const err = validateArchivablePath(rel, type)
  if (err) throw new Error(err)
  const manifest = readManifest()
  const existing = manifest.entries.find((e) => e.path === rel)
  if (existing) return { id: existing.id, count: type === 'file' ? 1 : countFilesUnder(rel) }
  const entry: ArchivedEntry = { id: randomUUID(), path: rel, type, archivedAt: new Date().toISOString() }
  writeManifest({ schemaVersion: 1, entries: [...manifest.entries, entry] })
  return { id: entry.id, count: type === 'file' ? 1 : countFilesUnder(rel) }
}

/** 统计目录下常规文件数（toast 文案用；跳过系统区与符号链接，不递归 . 开头目录） */
function countFilesUnder(dirRel: string): number {
  const current = getCurrentVault()
  if (!current) return 0
  let count = 0
  const walk = (abs: string): void => {
    let names: string[]
    try {
      names = existsSync(abs) ? readdirSync(abs) : []
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.') || name.toLowerCase() === '_inbox' || name === '_attachments') continue
      const full = join(abs, name)
      try {
        const st = lstatSync(full)
        if (st.isSymbolicLink()) continue
        if (st.isDirectory()) walk(full)
        else if (st.isFile()) count++
      } catch {
        /* skip */
      }
    }
  }
  walk(join(current.rootPath, dirRel))
  return count
}

/** 取消归档：文件条目精确删；目录条目删目录条目本身（目录内独立归档的文件条目保留，语义独立） */
export function removeArchiveEntry(relPath: string): void {
  const rel = toPosix(relPath)
  const manifest = readManifest()
  const next = manifest.entries.filter((e) => e.path !== rel)
  if (next.length === manifest.entries.length) return // 幂等：本来就没有
  writeManifest({ schemaVersion: 1, entries: next })
}

/**
 * rename/移动跟随（workspaceManager.renameWorkspacePath 挂钩）：
 * - 文件条目：path 精确匹配改写
 * - 目录条目：本身改写 + 所有位于其下的条目（file/dir）前缀级联
 * 无变化不写盘。
 */
export function renameArchiveEntries(oldRel: string, newRel: string): void {
  const from = toPosix(oldRel)
  const to = toPosix(newRel)
  if (!from || !to || from === to) return
  const manifest = readManifest()
  let changed = false
  for (const e of manifest.entries) {
    if (e.path === from) {
      e.path = to
      changed = true
    } else if (e.path.startsWith(`${from}/`)) {
      e.path = `${to}${e.path.slice(from.length)}`
      changed = true
    }
  }
  if (changed) writeManifest({ schemaVersion: 1, entries: manifest.entries })
}

/**
 * rebuild 对账 GC（B3）：磁盘已消失的条目删除（文件/目录同判）。
 * 返回清理数（供索引 warnings 提示）。
 */
export function gcArchiveEntries(): number {
  const current = getCurrentVault()
  if (!current) return 0
  const manifest = readManifest()
  const kept = manifest.entries.filter((e) => {
    try {
      return existsSync(join(current.rootPath, e.path))
    } catch {
      return false
    }
  })
  if (kept.length === manifest.entries.length) return 0
  writeManifest({ schemaVersion: 1, entries: kept })
  return manifest.entries.length - kept.length
}

/** 仓库内 posix 相对路径（workspaceManager 侧统一换算用，避免各自手写） */
export function relPosixOf(rootPath: string, abs: string): string {
  return relative(rootPath, abs).replace(/\\/g, '/')
}
