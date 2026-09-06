import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import { getCurrentVault } from './kbStore/vaultContext'
import { getAgentSession } from './agentSessionRepo'
import { renameWorkspacePath, trashWorkspacePath, uniqueFileName } from './workspaceManager'
import { getWorkspaceOfSession, workspaceFolderRel } from './aiTeachingWorkspaces'

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
/** 会话约束文件（P2 §2.3）：AI 注入的唯一真相源，用户可在编辑器直接改 */
const CONSTRAINTS_FILE = 'CONSTRAINTS.md'
/** 约束模板（P2 先行落产物根层；P5 工作区两层落地后改读工作区目录，层级语义不变） */
const CONSTRAINTS_TEMPLATE_REL_SEGMENTS = ['_templates', CONSTRAINTS_FILE]

export interface SessionFolderAnchor {
  sessionId: string
  title: string
  createdAt: string
  /** 结构版本，字段演进时用于识别兼容 */
  v: 1
  /** P5：归属工作区快照（真相源在 .knowbase 元数据，此处仅供人读/溯源） */
  workspaceId?: string
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

function anchorMatches(abs: string, sessionId: string): boolean {
  const p = join(abs, ANCHOR_FILE)
  if (!existsSync(p)) return false
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as Partial<SessionFolderAnchor>
    return !!(data && data.sessionId === sessionId)
  } catch { return false } // 锚点损坏跳过（视为无主文件夹，不删）
}

/** 扫描根目录定位会话文件夹；P5 起兼容两种布局：`{root}/{会话}` 与 `{root}/{工作区}/{会话}`（深度≤2） */
function findSessionFolderRel(rootPath: string, rootDir: string, sessionId: string): string | null {
  const rootAbs = join(rootPath, rootDir)
  if (!existsSync(rootAbs)) return null
  let names: string[] = []
  try { names = readdirSync(rootAbs) } catch { return null }
  for (const name of names) {
    const abs = join(rootAbs, name)
    if (anchorMatches(abs, sessionId)) return `${rootDir}/${name}`
    if (name.startsWith('.') || name === '_templates') continue
    try {
      for (const sub of readdirSync(abs)) {
        if (anchorMatches(join(abs, sub), sessionId)) return `${rootDir}/${name}/${sub}`
      }
    } catch { /* 非目录（如普通产物文件）忽略 */ }
  }
  return null
}

/** 幂等确保会话文件夹存在：新建对话确认后调用（2-2），P3 产物落盘/旧会话懒创建（2-5）共用。
 *  P5 两层：归属工作区的会话落 `AI教学/{工作区}/`（新夹；存量扁平文件夹不迁移，find 双深度兼容） */
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
    const wsId = getWorkspaceOfSession(sessionId)
    const baseRel = (wsId && workspaceFolderRel(wsId, getSetting)) || rootDir
    const baseAbs = join(vault.rootPath, baseRel)
    mkdirSync(baseAbs, { recursive: true })
    const name = uniqueFileName(baseAbs, folderBaseName(session.created_at, session.title))
    const folderAbs = join(baseAbs, name)
    mkdirSync(folderAbs)
    const anchor: SessionFolderAnchor = { sessionId, title: session.title, createdAt: session.created_at, v: 1, ...(wsId ? { workspaceId: wsId } : {}) }
    writeFileSync(join(folderAbs, ANCHOR_FILE), JSON.stringify(anchor, null, 2), 'utf-8')
    // P2（§2.3）建夹即播种会话专属 CONSTRAINTS.md；P5 起优先工作区层模板，回退产物根层
    seedConstraintsFromTemplate(folderAbs, wsId && join(vault.rootPath, baseRel, ...CONSTRAINTS_TEMPLATE_REL_SEGMENTS), join(vault.rootPath, rootDir, ...CONSTRAINTS_TEMPLATE_REL_SEGMENTS))
    broadcastTreeRefresh(baseRel)
    return { ok: true, relPath: `${baseRel}/${name}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 模板播种：按优先级取第一个存在的模板复制进会话文件夹（目标已存在不覆盖；全无模板则跳过） */
function seedConstraintsFromTemplate(folderAbs: string, ...templateAbsCandidates: Array<string | false | null | undefined>): void {
  try {
    const dest = join(folderAbs, CONSTRAINTS_FILE)
    if (existsSync(dest)) return
    for (const t of templateAbsCandidates) {
      if (t && existsSync(t)) {
        writeFileSync(dest, readFileSync(t, 'utf-8'), 'utf-8')
        return
      }
    }
  } catch { /* 播种失败不阻断建夹 */ }
}

/**
 * P2 约束读写（§2.3 文件为唯一真相源）：
 * - 写路径懒建文件夹（2-5）后落 CONSTRAINTS.md，不再写 DB 字段（2-6 写只写文件）；
 * - 读路径只认文件。旧 DB sessionInstructions 的兼容回退只发生在注入解析处（见下）。
 */
export interface ConstraintsResult { ok: boolean; text?: string; relPath?: string | null; error?: string }

export function readConstraints(sessionId: string, getSetting: (key: string) => unknown): ConstraintsResult {
  try {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: '会话 id 非法' }
    const vault = getCurrentVault()
    if (!vault) return { ok: false, error: '尚未打开仓库' }
    const rootDir = rootDirName(getSetting)
    const rel = findSessionFolderRel(vault.rootPath, rootDir, sessionId)
    if (!rel) return { ok: true, text: '', relPath: null } // 无文件夹：无约束文件
    const p = join(vault.rootPath, rel, CONSTRAINTS_FILE)
    const text = existsSync(p) ? readFileSync(p, 'utf-8') : ''
    return { ok: true, text, relPath: `${rel}/${CONSTRAINTS_FILE}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 写会话 CONSTRAINTS.md（懒建文件夹后落盘；空文本=写空文件保留编辑入口） */
export function writeConstraints(sessionId: string, text: string, getSetting: (key: string) => unknown): ConstraintsResult {
  try {
    const ensured = ensureSessionFolder(sessionId, getSetting)
    if (!ensured.ok || !ensured.relPath) return { ok: false, error: ensured.error ?? '会话文件夹不可用' }
    const vault = getCurrentVault()
    if (!vault) return { ok: false, error: '尚未打开仓库' }
    const body = String(text ?? '').replace(/\r\n/g, '\n')
    writeFileSync(join(vault.rootPath, ensured.relPath, CONSTRAINTS_FILE), body, 'utf-8')
    broadcastTreeRefresh(rootDirName(getSetting))
    return { ok: true, text: body, relPath: `${ensured.relPath}/${CONSTRAINTS_FILE}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * AgentRunner 注入解析（§2.3 / 2-6）：CONSTRAINTS.md 文件是唯一真相源；
 * 旧会话从未落过文件夹 → 读兼容回退 DB sessionInstructions 一次；
 * 已有文件夹但无/空约束文件 → 视为用户已清空，不再回退。
 */
export function resolveConstraintsForInjection(sessionId: string, getSetting: (key: string) => unknown): string {
  try {
    const vault = getCurrentVault()
    if (!vault) return getAgentSession(sessionId)?.instructions?.trim() || ''
    const rootDir = rootDirName(getSetting)
    const rel = findSessionFolderRel(vault.rootPath, rootDir, sessionId)
    if (rel) {
      const p = join(vault.rootPath, rel, CONSTRAINTS_FILE)
      return existsSync(p) ? readFileSync(p, 'utf-8').trim() : ''
    }
    return getAgentSession(sessionId)?.instructions?.trim() || ''
  } catch {
    return ''
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
    const lastSlash = rel.lastIndexOf('/')
    const parentRel = lastSlash > 0 ? rel.slice(0, lastSlash) : rootDir
    const oldName = lastSlash > 0 ? rel.slice(lastSlash + 1) : rel
    const session = getAgentSession(sessionId)
    const created = session?.created_at ?? ''
    const m = /^(\d{2}-\d{2})\s/.exec(oldName)
    const prefix = m ? m[1] : datePrefix(created)
    const nextBase = `${prefix} ${sanitizeTitle(newTitle)}`
    if (nextBase === oldName) return { ok: true, relPath: rel }
    const parentAbs = join(vault.rootPath, parentRel)
    const finalName = uniqueFileName(parentAbs, nextBase)
    renameWorkspacePath(vault.rootId, rel, `${parentRel}/${finalName}`)
    // 锚点标题同步（尽力而为，失败不阻断——锚点以 sessionId 为准）
    try {
      const p = join(vault.rootPath, parentRel, finalName, ANCHOR_FILE)
      if (existsSync(p)) {
        const data = JSON.parse(readFileSync(p, 'utf-8')) as SessionFolderAnchor
        data.title = String(newTitle ?? '')
        writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
      }
    } catch { /* ignore */ }
    broadcastTreeRefresh(parentRel)
    return { ok: true, relPath: `${parentRel}/${finalName}` }
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

/**
 * P3b「整理成文档」（§3.8-2，3-14 默认纯 markdown 直出）：把一条 AI 回答落盘为会话文件夹内
 * `讲义·{标题}.md`。写路径经 ensure 懒建文件夹（2-5 旧会话首次整理即补建）；
 * 幂等：同名同内容直接返回既有路径（前端「已生成文档 →」跳转），同名不同内容加 (n) 后缀不覆盖。
 */
export function organizeDoc(sessionId: string, title: string, content: string, getSetting: (key: string) => unknown): FolderResult {
  try {
    const ensured = ensureSessionFolder(sessionId, getSetting)
    if (!ensured.ok || !ensured.relPath) return { ok: false, error: ensured.error ?? '会话文件夹不可用' }
    const vault = getCurrentVault()
    if (!vault) return { ok: false, error: '尚未打开仓库' }
    const body = String(content ?? '').replace(/\r\n/g, '\n')
    const base = `讲义·${sanitizeTitle(title)}`
    const dirAbs = join(vault.rootPath, ensured.relPath)
    let name = `${base}.md`
    for (let n = 1; n < 50; n++) {
      const abs = join(dirAbs, name)
      if (!existsSync(abs)) break
      try {
        if (readFileSync(abs, 'utf-8') === body) return { ok: true, relPath: `${ensured.relPath}/${name}` } // 内容未变 = 幂等
      } catch { /* 读取失败按占用处理，换后缀 */ }
      name = `${base} (${n}).md`
    }
    writeFileSync(join(dirAbs, name), body, 'utf-8')
    broadcastTreeRefresh(rootDirName(getSetting))
    return { ok: true, relPath: `${ensured.relPath}/${name}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function registerAiTeachingFolderHandlers(getSetting: (key: string) => unknown): void {
  ipcMain.handle('aiTeach:ensureSessionFolder', (_e, sessionId: string) => ensureSessionFolder(String(sessionId ?? ''), getSetting))
  ipcMain.handle('aiTeach:sessionFolder', (_e, sessionId: string) => sessionFolder(String(sessionId ?? ''), getSetting))
  ipcMain.handle('aiTeach:renameSessionFolder', (_e, sessionId: string, title: string) => renameSessionFolder(String(sessionId ?? ''), String(title ?? ''), getSetting))
  ipcMain.handle('aiTeach:deleteSessionFolder', (_e, sessionId: string) => deleteSessionFolder(String(sessionId ?? ''), getSetting))
  // P2：会话约束文件（CONSTRAINTS.md）读写
  ipcMain.handle('aiTeach:readConstraints', (_e, sessionId: string) => readConstraints(String(sessionId ?? ''), getSetting))
  ipcMain.handle('aiTeach:writeConstraints', (_e, sessionId: string, text: string) => writeConstraints(String(sessionId ?? ''), String(text ?? ''), getSetting))
  // P3b：整理成文档（回答 md 落盘会话文件夹，幂等）
  ipcMain.handle('aiTeach:organizeDoc', (_e, sessionId: string, title: string, content: string) => organizeDoc(String(sessionId ?? ''), String(title ?? '讲义'), String(content ?? ''), getSetting))
}
