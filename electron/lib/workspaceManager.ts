import { ipcMain, BrowserWindow, dialog } from 'electron'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, openSync, readSync, closeSync } from 'fs'
import { basename, join, relative, resolve, sep, extname } from 'path'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../database/connection'
import { setCurrentVault, ensureKbRoot, readCurrentVaultId, getCurrentVault } from './kbStore/vaultContext'
import { invalidateKnowledgeIndex } from './kbStore/knowledgeIndex'
import { invalidateGraphIndex } from './kbStore/graphIndex'

/**
 * 编辑器工作区（Vault 仓库）文件服务。
 *
 * 设计对标 Obsidian 的 Vault + FileSystemAdapter：
 * - 任何磁盘文件夹经系统对话框授权后登记为仓库（rootId），后续所有操作
 *   只接受 { rootId, relPath } —— 渲染层永不接触绝对路径，路径合法性由主进程单向保证。
 * - 核心逻辑（resolveSafe / listDirEntries / readWorkspaceFile / writeWorkspaceFile）
 *   为纯函数，供 tmp/smoke 冒烟脚本直接断言。
 * - 删除一律走系统回收站（trash 包），绝不 rm；符号链接全路径拒绝，防逃逸。
 */

const MAX_EDIT_SIZE = 10 * 1024 * 1024 // >10MB 拒绝编辑（只读）
const MAX_OPEN_SIZE = 50 * 1024 * 1024 // >50MB 拒绝打开
const BINARY_NUL_RATIO = 0.05 // 前 512 字节 NUL 占比 >5% 判二进制
const HIDDEN_DIRS = new Set([
  '.git', 'node_modules', 'out', 'dist', '.obsidian', '__pycache__',
  '.vscode', '.idea', '.claude', '.turbo', '.next', 'build',
])

/** 应用内部目录（去库化/迁移器约定）：文件树对用户隐藏，避免与软件数据混淆 */
const APP_INTERNAL_DIRS = new Set(['blog', '_attachments', '_inbox'])

interface RootInfo {
  id: string
  name: string
  rootPath: string
}

const roots = new Map<string, RootInfo>()

// ===== 纯逻辑（可单测）=====

/** 目标绝对路径是否位于根目录内（Windows 大小写不敏感） */
export function isInside(rootPath: string, target: string): boolean {
  const base = resolve(rootPath).toLowerCase()
  const abs = resolve(target).toLowerCase()
  const baseWithSep = base.endsWith(sep) ? base : base + sep
  return abs === base || abs.startsWith(baseWithSep)
}

/**
 * 把 { rootId, relPath } 安全解析为根内绝对路径。
 * 空字符串 = 根本身（枚举根目录）。
 * 拒绝：非字符串、盘符绝对路径、UNC、POSIX/Windows 绝对路径、`..` 越出根、
 * 路径任意一段是符号链接（防 symlink 逃逸读/写根外文件）。
 * 非法输入返回 null。
 */
export function resolveSafe(rootPath: string, relPath: unknown): string | null {
  if (typeof relPath !== 'string') return null
  if (relPath.length === 0) return resolve(rootPath) // 根本身
  if (/^[a-zA-Z]:[\\/]/.test(relPath)) return null
  if (relPath.startsWith('\\\\') || relPath.startsWith('//')) return null
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return null
  const target = resolve(rootPath, relPath)
  if (!isInside(rootPath, target)) return null
  const rel = relative(rootPath, target)
  if (rel === '') return target // 根本身
  const parts = rel.split(sep).filter(Boolean)
  let cur = resolve(rootPath)
  for (const p of parts) {
    cur = join(cur, p)
    try {
      if (lstatSync(cur).isSymbolicLink()) return null
    } catch {
      break // 目标或其祖先尚不存在（新建场景），后续段也不再存在
    }
  }
  return target
}

/** 二进制检测：前 512 字节 NUL 占比 > 5% */
export function detectBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 512)
  if (n === 0) return false
  let nul = 0
  for (let i = 0; i < n; i++) if (buf[i] === 0) nul++
  return nul / n > BINARY_NUL_RATIO
}

export interface WorkspaceEntry {
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: number
}

/** 枚举目录：跳过符号链接与隐藏目录，文件夹优先 + 中文友好字典序 */
export function listDirEntries(absPath: string): WorkspaceEntry[] {
  const out: WorkspaceEntry[] = []
  let names: string[] = []
  try {
    names = readdirSync(absPath)
  } catch {
    return out
  }
  for (const name of names) {
    const full = join(absPath, name)
    try {
      const lst = lstatSync(full)
      if (lst.isSymbolicLink()) continue
      if (lst.isDirectory()) {
        if (name.startsWith('.') || HIDDEN_DIRS.has(name.toLowerCase()) || APP_INTERNAL_DIRS.has(name.toLowerCase())) continue
        out.push({ name, type: 'dir', size: 0, mtime: lst.mtimeMs })
      } else if (lst.isFile()) {
        out.push({ name, type: 'file', size: lst.size, mtime: lst.mtimeMs })
      }
    } catch {
      /* skip 瞬时不可读条目 */
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
  return out
}

export interface ReadFileResult {
  content: string
  binary: boolean
  size: number
  editable: boolean
  truncated: boolean
  /** 磁盘 mtime（毫秒）：作为保存冲突检测的基线 */
  mtimeMs: number
}

/** 读文件：大小门槛 + 二进制检测（二进制不返回内容，避免乱码跨 IPC） */
export function readWorkspaceFile(absPath: string): ReadFileResult {
  const st = statSync(absPath)
  if (st.size > MAX_OPEN_SIZE) {
    return { content: '', binary: false, size: st.size, editable: false, truncated: true, mtimeMs: st.mtimeMs }
  }
  const buf = readFileSync(absPath)
  if (detectBinary(buf)) {
    return { content: '', binary: true, size: buf.length, editable: false, truncated: false, mtimeMs: st.mtimeMs }
  }
  return {
    content: buf.toString('utf-8'),
    binary: false,
    size: buf.length,
    editable: buf.length <= MAX_EDIT_SIZE,
    truncated: false,
    mtimeMs: st.mtimeMs,
  }
}

// ===== 二进制范围读取（PDF 阅读器懒加载通道，plugin-pdf-reader-design §4）=====

/** 范围读取白名单扩展名：范围通道 = 二进制放行口，只允许可视化文档类型（防变成任意二进制窃取口） */
const RANGE_EXT_WHITELIST = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']

export interface ReadRangeResult {
  /** base64 编码的 [offset, offset+len) 段数据（不足段取到文件尾） */
  data: string
  /** 本段实际起始字节偏移 */
  offset: number
  /** 文件总字节数（pdf.js 据此知道全貌，配合 range 懒加载） */
  size: number
  /** 本段是否截断（end < size） */
  truncated: boolean
}

/**
 * 范围读取：open+read 精确读段（不整文件载入内存），仅白名单扩展名放行。
 * 纯逻辑可冒烟（不依赖 electron）。
 */
export function readWorkspaceRange(absPath: string, offset: unknown, length: unknown): ReadRangeResult | { error: string } {
  try {
    const ext = extname(absPath).slice(1).toLowerCase()
    if (!RANGE_EXT_WHITELIST.includes(ext)) return { error: `文件类型不支持范围读取: .${ext}` }
    const st = statSync(absPath)
    const start = Math.max(0, Math.floor(Number(offset) || 0))
    const want = Math.max(0, Math.floor(Number(length) || 0))
    const end = Math.min(st.size, start + want)
    if (start >= st.size) {
      return { data: '', offset: start, size: st.size, truncated: false }
    }
    const fd = openSync(absPath, 'r')
    try {
      const buf = Buffer.alloc(end - start)
      readSync(fd, buf, 0, buf.length, start)
      return { data: buf.toString('base64'), offset: start, size: st.size, truncated: end < st.size }
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/**
 * 保存前冲突检测（对标 VS Code 的 FILE_MODIFIED_SINCE）。
 *
 * 渲染层打开文件时记录磁盘 mtime 作为"基线"，保存时把基线传回主进程：
 * 若磁盘 mtime 已变化（被其它程序改过），拒绝写入并回报磁盘现状，
 * 由渲染层提示用户三选（重新加载 / 覆盖磁盘 / 取消），避免静默覆盖外部改动。
 *
 * 未传基线（expectedMtimeMs 为空）视为不校验，直接放行（兼容旧调用路径）。
 */
export interface ConflictCheck {
  conflict: boolean
  diskMtimeMs?: number
  diskSize?: number
  missing?: boolean
}

export function detectConflict(absPath: string, expectedMtimeMs: number | null | undefined): ConflictCheck {
  if (typeof expectedMtimeMs !== 'number' || expectedMtimeMs <= 0) return { conflict: false }
  try {
    const st = statSync(absPath)
    // 容差 2ms：部分文件系统 mtime 精度有限，避免同一时刻的误判
    if (Math.abs(st.mtimeMs - expectedMtimeMs) > 2) {
      return { conflict: true, diskMtimeMs: st.mtimeMs, diskSize: st.size }
    }
    return { conflict: false, diskMtimeMs: st.mtimeMs, diskSize: st.size }
  } catch {
    return { conflict: true, missing: true }
  }
}

/** 原子写：临时文件 + rename 覆盖（对标数据库写盘策略，防半写损坏） */
export function writeWorkspaceFile(absPath: string, content: string): void {
  const real = absPath
  const tmp = join(real, `..`, `.kb-tmp-${randomUUID()}`)
  try {
    writeFileSync(tmp, content, 'utf-8')
    try {
      renameSync(tmp, real)
    } catch {
      // Windows 目标被占用/已存在时：先移除目标再改名
      if (existsSync(real)) unlinkSync(real)
      renameSync(tmp, real)
    }
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

// ===== 仓库登记与持久化 =====

function loadVaults(): void {
  try {
    const db = getDatabase()
    const res = db.exec('SELECT id, name, path FROM vaults')
    for (const row of res[0]?.values ?? []) {
      const id = String(row[0])
      const name = String(row[1])
      const p = String(row[2])
      if (existsSync(p)) roots.set(id, { id, name, rootPath: p })
    }
    // 恢复当前仓库上下文（settings.json 记忆的 currentVaultId）
    const curId = readCurrentVaultId()
    const cur = curId ? roots.get(curId) : undefined
    if (cur) {
      setCurrentVault({ rootId: cur.id, name: cur.name, rootPath: cur.rootPath })
      ensureKbRoot()
    }
  } catch {
    /* db 未就绪等：忽略，openDir 时重新登记 */
  }
}

function findVaultIdByPath(path: string): string | null {
  try {
    const db = getDatabase()
    const res = db.exec('SELECT id FROM vaults WHERE path = ?', [path])
    return res[0]?.values?.[0]?.[0] ? String(res[0].values[0][0]) : null
  } catch {
    return null
  }
}

function upsertVault(id: string, name: string, path: string): void {
  try {
    const db = getDatabase()
    db.run(
      `INSERT INTO vaults (id, name, path, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
       ON CONFLICT(path) DO UPDATE SET name = excluded.name, updated_at = datetime('now','localtime')`,
      [id, name, path]
    )
    saveToDisk()
  } catch {
    /* vaults 表不存在（极端旧库）时静默 */
  }
}

function removeVault(id: string): void {
  try {
    const db = getDatabase()
    db.run('DELETE FROM vaults WHERE id = ?', [id])
    saveToDisk()
  } catch {
    /* ignore */
  }
}

function listRecentVaults(): Array<{ rootId: string; name: string; path: string; updatedAt: string }> {
  try {
    const db = getDatabase()
    const res = db.exec('SELECT id, name, path, updated_at FROM vaults ORDER BY updated_at DESC')
    return (res[0]?.values ?? []).map((r: Array<string | number | null>) => ({
      rootId: String(r[0]),
      name: String(r[1]),
      path: String(r[2]),
      updatedAt: String(r[3]),
    }))
  } catch {
    return []
  }
}

// ===== IPC =====

function requireRoot(rootId: string): RootInfo {
  const r = roots.get(rootId)
  if (!r) throw new Error('未授权的工作区')
  return r
}

function requireInside(rootId: string, relPath: unknown): string {
  const r = requireRoot(rootId)
  const abs = resolveSafe(r.rootPath, relPath)
  if (!abs) throw new Error('路径越界或非法')
  return abs
}

export function registerWorkspaceHandlers(): void {
  loadVaults()

  // 知识索引失效：仅当被改动的根就是当前仓库时才有缓存可失效（P0 懒重建，只删缓存 JSON）
  function invalidateIndexIfCurrentVault(rootId: string): void {
    if (getCurrentVault()?.rootId !== rootId) return
    invalidateKnowledgeIndex()
    invalidateGraphIndex()
  }

  // 打开/登记仓库：系统对话框授权（用户意图的唯一来源）
  ipcMain.handle('ws:openDir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择工作区文件夹（仓库）',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const rootPath = result.filePaths[0]
    // .knowbase 等隐藏目录是仓库内部数据目录，不是仓库根——选中时拒绝并引导选父目录
    if (basename(rootPath).startsWith('.')) {
      return { error: '「. 开头」的隐藏目录是仓库内部数据目录，不能作为仓库根，请选择它的父目录' }
    }
    const id = findVaultIdByPath(rootPath) ?? randomUUID()
    const name = basename(rootPath)
    roots.set(id, { id, name, rootPath })
    upsertVault(id, name, rootPath)
    // 打开仓库 = 设为当前仓库上下文 + 初始化 .knowbase
    setCurrentVault({ rootId: id, name, rootPath })
    ensureKbRoot()
    return { rootId: id, name, path: rootPath }
  })

  // 枚举目录
  ipcMain.handle('ws:listDir', (_e, rootId: string, relPath: string) => {
    try {
      const abs = requireInside(rootId, relPath ?? '')
      return { entries: listDirEntries(abs) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  // 读文件
  ipcMain.handle('ws:readFile', (_e, rootId: string, relPath: string) => {
    try {
      const abs = requireInside(rootId, relPath)
      return readWorkspaceFile(abs)
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  // 二进制范围读取（PDF 阅读器懒加载）：白名单扩展名 + 精确读段，复用 resolveSafe 防穿越
  ipcMain.handle('ws:readRange', (_e, rootId: string, relPath: string, offset: unknown, length: unknown) => {
    try {
      const abs = requireInside(rootId, relPath)
      return readWorkspaceRange(abs, offset, length)
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  // 写文件（原子写 + 保存冲突检测）
  // expectedMtimeMs 为打开文件时记录的磁盘 mtime；不一致说明被外部改过 → 拒绝写入，交渲染层决策
  ipcMain.handle('ws:writeFile', (_e, rootId: string, relPath: string, content: string, expectedMtimeMs?: number) => {
    try {
      if (typeof content !== 'string') throw new Error('内容必须是文本')
      const abs = requireInside(rootId, relPath)
      const chk = detectConflict(abs, expectedMtimeMs)
      if (chk.conflict) {
        return { ok: false, conflict: true, diskMtimeMs: chk.diskMtimeMs, diskSize: chk.diskSize, missing: chk.missing === true }
      }
      writeWorkspaceFile(abs, content)
      if (relPath.toLowerCase().endsWith('.md')) invalidateIndexIfCurrentVault(rootId)
      const st = statSync(abs)
      return { ok: true, mtimeMs: st.mtimeMs, size: st.size }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 新建文件（content 可选：编辑器「新建知识页」一步写入 frontmatter 模板）
  ipcMain.handle('ws:createFile', (_e, rootId: string, relPath: string, content?: string) => {
    try {
      const abs = requireInside(rootId, relPath)
      if (existsSync(abs)) throw new Error('文件已存在')
      if (typeof content === 'string' && content.length > 0) {
        writeWorkspaceFile(abs, content)
      } else {
        writeFileSync(abs, '', 'utf-8')
      }
      if (relPath.toLowerCase().endsWith('.md')) invalidateIndexIfCurrentVault(rootId)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 新建目录
  ipcMain.handle('ws:mkdir', (_e, rootId: string, relPath: string) => {
    try {
      const abs = requireInside(rootId, relPath)
      if (existsSync(abs)) throw new Error('目录已存在')
      mkdirSync(abs, { recursive: false })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 重命名/移动（新旧路径都必须在根内）
  ipcMain.handle('ws:rename', (_e, rootId: string, oldRel: string, newRel: string) => {
    try {
      const from = requireInside(rootId, oldRel)
      const to = requireInside(rootId, newRel)
      if (!existsSync(from)) throw new Error('源文件不存在')
      if (existsSync(to)) throw new Error('目标已存在')
      renameSync(from, to)
      invalidateIndexIfCurrentVault(rootId) // 改名/移动可能是目录，目标含 .md 时也需失效
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 删除 → 系统回收站（绝不 rm）
  ipcMain.handle('ws:trash', async (_e, rootId: string, relPath: string) => {
    try {
      const abs = requireInside(rootId, relPath)
      if (!existsSync(abs)) throw new Error('文件不存在')
      const trash = (await import('trash')).default
      await trash([abs])
      invalidateIndexIfCurrentVault(rootId) // 删除可能是目录，含 .md 时也需失效
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 文件信息（打开前校验）
  ipcMain.handle('ws:stat', (_e, rootId: string, relPath: string) => {
    try {
      const abs = requireInside(rootId, relPath)
      const st = statSync(abs)
      return { size: st.size, mtime: st.mtimeMs, isDir: st.isDirectory() }
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  // 最近仓库
  ipcMain.handle('ws:getRecent', () => listRecentVaults())

  // 恢复最近仓库：按 rootId 从 vaults 表取回路径（该根已获授权，无需重新弹框）
  ipcMain.handle('ws:openById', (_e, rootId: string) => {
    try {
      if (typeof rootId !== 'string' || !rootId) throw new Error('非法工作区 id')
      if (!roots.has(rootId)) {
        const db = getDatabase()
        const res = db.exec('SELECT id, name, path FROM vaults WHERE id = ?', [rootId])
        const row = res[0]?.values?.[0]
        if (row) {
          const id = String(row[0])
          const name = String(row[1])
          const p = String(row[2])
          if (existsSync(p)) roots.set(id, { id, name, rootPath: p })
        }
      }
      const r = roots.get(rootId)
      if (!r) throw new Error('工作区不存在或已被移除')
      setCurrentVault({ rootId: r.id, name: r.name, rootPath: r.rootPath })
      ensureKbRoot()
      return { rootId: r.id, name: r.name, path: r.rootPath }
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  // 当前仓库（应用启动引导 / 模块数据定位）
  ipcMain.handle('ws:getCurrent', () => {
    const cur = getCurrentVault()
    return cur ? { rootId: cur.rootId, name: cur.name, path: cur.rootPath } : null
  })

  // 移除授权（从 roots 与 vaults 表）
  ipcMain.handle('ws:forget', (_e, rootId: string) => {
    roots.delete(rootId)
    removeVault(rootId)
    return { ok: true }
  })
}
