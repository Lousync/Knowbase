import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import { getCurrentVault } from './kbStore/vaultContext'
import { getAgentSession } from './agentSessionRepo'
import { renameWorkspacePath, trashWorkspacePath, uniqueFileName } from './workspaceManager'

/**
 * AI教学模块 · 会话 ⇄ 文件夹绑定（总纲 docs/ai-teaching-module-rework.md §二，P1）
 *
 * 约定（全部已拍板）：
 * - 会话产物根目录 = 当前激活仓库根 / `aiTeachRootDir` 设置（默认「AI教学」，2-1）；
 * - 一个会话一个文件夹：`{MM-DD} {会话标题}`（§2.2-1，非法字符清洗、重名加 (n) 后缀）；
 * - 文件夹内 `.session.json` 锚点：sessionId/title/createdAt（2-3，重命名只改文件夹名，锚点不丢）；
 * - 新建对话确认即建文件夹（2-2 空会话也不删）；存量会话懒创建（2-5，P3 产物落盘时补建）；
 * - 删除会话的文件夹处理走 `aiTeachDeleteSessionFolder` 设置（2-4：ask/keep/delete，delete=进系统回收站）；
 * - 对话消息流本体仍存 sqlite（agent_sessions），本服务只管文件系统侧。
 */

const ANCHOR_FILE = '.session.json'
const DEFAULT_ROOT_DIR = 'AI教学'

export interface SessionFolderAnchor {
  sessionId: string
  title: string
  createdAt: string
  /** 结构版本，字段演进时用于识别兼容 */
  v: 1
}

export interface FolderResult {
  ok: boolean
  relPath?: string | null
  error?: string
}

/** 设置注入（main/index.ts settingsCache）；aiTeachRootDir 空/非法时回退默认 */
function rootDirName(getSetting: (key: string) => unknown): string {
  const v = getSetting('aiTeachRootDir')
  const name = typeof v === 'string' ? v.trim() : ''
  return name && isSingleSegment(name) ? name : DEFAULT_ROOT_DIR
}

/** 目录名合法性：单段路径名，无分隔符/相对跳转/Windows 非法字符 */
export function isSingleSegment(name: string): boolean {
  if (!name || name === '.' || name === '..') return false
  return !/[\\/:*?"<>|]/.test(name)
}

/** 文件夹标题段清洗：去非法字符与换行、空白折叠、截 40、去尾点尾空格（§2.2-1） */
export function sanitizeTitle(title: string): string {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .replace(/[. ]+$/, '')
  return cleaned || '会话'
}

/** created_at（'YYYY-MM-DD HH:MM:SS' 本地串）→ 'MM-DD'；解析失败退回今天 */
export function datePrefix(createdAt: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(createdAt ?? ''))
  if (m) return `${m[1]}-${m[2]}`
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function folderBaseName(createdAt: string, title: string): string {
  return `${datePrefix(createdAt)} ${sanitizeTitle(title)}`
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** 编辑区文件树联动：广播刷新（模块自绘树 P4 接管） */
function broadcastTreeRefresh(dirRel: string): void {
  broadcast('aiTeach:tree-refresh', { dirRel })
}

/** 扫描根目录，按锚点定位会话文件夹；返回相对仓库根的路径或 null */
function findSessionFolderRel(rootPath: string, rootDir: string, sessionId: string): string | null {
  const rootAbs = join(rootPath, rootDir)
  if (!existsSync(rootAbs)) return null
  let names: string[] = []
  try { names = readdirSync(rootAbs) } catch { return null }
  for (const name of names) {
    const anchorAbs = join(rootAbs, name, ANCHOR_FILE)
    if (!existsSync(anchorAbs)) continue
    try {
      const data = JSON.parse(readFileSync(anchorAbs, 'utf-8')) as Partial<SessionFolderAnchor>
      if (data && data.sessionId === sessionId) return `${rootDir}/${name}`
    } catch { /* 锚点损坏跳过（视为无主文件夹，不删） */ }
  }
  return null
}

/** 幂等确保会话文件夹存在：新建对话确认后调用（2-2），P3 产物落盘/旧会话懒创建（2-5）共用 */
export function ensureSessionFolder(sessionId: string, getSetting: (key: string) => unknown): FolderResult {
  try {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: '会话 id 非法' }
    const vault = getCurrentVault()
    if (!vault) return { ok: false, error: '尚未打开仓库' }
    const session = getAgentSession(sessionId)
    if (!session) return { ok: false, error: '会话不存在' }
    const rootDir = rootDirName(getSetting)
    const existing = findSessionFolderRel(vault.rootPath, rootDir, sessionId)
    if (existing) return { ok: true, relPath: existing }
    const rootAbs = join(vault.rootPath, rootDir)
    mkdirSync(rootAbs, { recursive: true })
    const name = uniqueFileName(rootAbs, folderBaseName(session.created_at, session.title))
    const folderAbs = join(rootAbs, name)
    mkdirSync(folderAbs)
    const anchor: SessionFolderAnchor = { sessionId, title: session.title, createdAt: session.created_at, v: 1 }
    writeFileSync(join(folderAbs, ANCHOR_FILE), JSON.stringify(anchor, null, 2), 'utf-8')
    broadcastTreeRefresh(rootDir)
    return { ok: true, relPath: `${rootDir}/${name}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 重命名会话 → 同步重命名文件夹（日期前缀保留，只换标题段；无文件夹则懒补建） */
export function renameSessionFolder(sessionId: string, newTitle: string, getSetting: (key: string) => unknown): FolderResult {
  try {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: '会话 id 非法' }
    const vault = getCurrentVault()
    if (!vault) return { ok: false, error: '尚未打开仓库' }
    const rootDir = rootDirName(getSetting)
    const rel = findSessionFolderRel(vault.rootPath, rootDir, sessionId)
    if (!rel) {
      // 从未产生过文件夹的会话：不主动建（懒创建 2-5），标题在真正建夹时生效
      return { ok: true, relPath: null }
    }
    const oldName = rel.slice(rootDir.length + 1)
    const session = getAgentSession(sessionId)
    const created = session?.created_at ?? ''
    const m = /^(\d{2}-\d{2})\s/.exec(oldName)
    const prefix = m ? m[1] : datePrefix(created)
    const nextBase = `${prefix} ${sanitizeTitle(newTitle)}`
    if (nextBase === oldName) return { ok: true, relPath: rel }
    const parentAbs = join(vault.rootPath, rootDir)
    const finalName = uniqueFileName(parentAbs, nextBase)
    renameWorkspacePath(vault.rootId, rel, `${rootDir}/${finalName}`)
    // 锚点标题同步（尽力而为，失败不阻断——锚点以 sessionId 为准）
    try {
      const p = join(vault.rootPath, rootDir, finalName, ANCHOR_FILE)
      if (existsSync(p)) {
        const data = JSON.parse(readFileSync(p, 'utf-8')) as SessionFolderAnchor
        data.title = String(newTitle ?? '')
        writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
      }
    } catch { /* ignore */ }
    broadcastTreeRefresh(rootDir)
    return { ok: true, relPath: `${rootDir}/${finalName}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 查询会话文件夹（渲染层删除确认前探测用） */
export function sessionFolder(sessionId: string, getSetting: (key: string) => unknown): FolderResult {
  const vault = getCurrentVault()
  if (!vault) return { ok: false, relPath: null, error: '尚未打开仓库' }
  const rel = findSessionFolderRel(vault.rootPath, rootDirName(getSetting), String(sessionId ?? ''))
  return { ok: true, relPath: rel }
}

/** 删除会话文件夹 → 系统回收站（复用 ws:trash 同一语义，绝不 rm） */
export async function deleteSessionFolder(sessionId: string, getSetting: (key: string) => unknown): Promise<FolderResult> {
  try {
    const vault = getCurrentVault()
    if (!vault) return { ok: false, error: '尚未打开仓库' }
    const rootDir = rootDirName(getSetting)
    const rel = findSessionFolderRel(vault.rootPath, rootDir, String(sessionId ?? ''))
    if (!rel) return { ok: true, relPath: null }
    await trashWorkspacePath(vault.rootId, rel)
    broadcastTreeRefresh(rootDir)
    return { ok: true, relPath: rel }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * aiTeachRootDir 改名迁移（3-15 拍板：重命名迁移一次到位）：
 * 当前仓库存在旧名根目录且新名未占用 → renameSync；失败/占用 → 保留原目录并广播提示，不阻塞设置保存。
 * 非法新名 → 拒绝迁移（由调用方回滚设置值）。
 */
export function migrateRootDir(oldName: string, newName: string): { ok: boolean; skipped?: boolean; error?: string } {
  try {
    if (!isSingleSegment(oldName) || !isSingleSegment(newName) || oldName === newName) {
      return oldName === newName ? { ok: true, skipped: true } : { ok: false, error: '目录名不合法' }
    }
    const vault = getCurrentVault()
    if (!vault) return { ok: true, skipped: true } // 无仓库：无需迁移，下次有仓库时按新名生效
    const oldAbs = join(vault.rootPath, oldName)
    const newAbs = join(vault.rootPath, newName)
    if (!existsSync(oldAbs)) return { ok: true, skipped: true }
    if (existsSync(newAbs)) {
      broadcast('aiTeach:notice', `根目录改名未完成：目标「${newName}」已存在，原「${oldName}」文件夹保留`)
      return { ok: false, error: '目标目录已存在' }
    }
    renameSync(oldAbs, newAbs)
    broadcastTreeRefresh(newName)
    return { ok: true }
  } catch (e) {
    const err = (e as Error).message
    broadcast('aiTeach:notice', `根目录改名迁移失败（${err}），已保留原文件夹`)
    return { ok: false, error: err }
  }
}

export function registerAiTeachingFolderHandlers(getSetting: (key: string) => unknown): void {
  ipcMain.handle('aiTeach:ensureSessionFolder', (_e, sessionId: string) => ensureSessionFolder(String(sessionId ?? ''), getSetting))
  ipcMain.handle('aiTeach:sessionFolder', (_e, sessionId: string) => sessionFolder(String(sessionId ?? ''), getSetting))
  ipcMain.handle('aiTeach:renameSessionFolder', (_e, sessionId: string, title: string) => renameSessionFolder(String(sessionId ?? ''), String(title ?? ''), getSetting))
  ipcMain.handle('aiTeach:deleteSessionFolder', (_e, sessionId: string) => deleteSessionFolder(String(sessionId ?? ''), getSetting))
}
