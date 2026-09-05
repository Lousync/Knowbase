import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

/**
 * 当前仓库上下文（去库化地基）。
 *
 * 概念对标 Obsidian 的 Vault：应用启动打开一个「当前仓库」，所有模块的数据
 * 都从当前仓库根的隐藏目录 `.knowbase/` 读写；切换仓库 = 整套数据切换。
 *
 * - 当前仓库 id 持久化在 userData/settings.json 的 `currentVaultId` 字段（全局数据）
 * - workspaceManager 在 openDir/openById 成功时调用 setCurrentVault 同步
 * - 启动时由 workspaceManager 用 readCurrentVaultId + roots 恢复
 */

export interface VaultInfo {
  rootId: string
  name: string
  rootPath: string
}

let current: VaultInfo | null = null

const KB_DIR = '.knowbase'
export const KB_SCHEMA_VERSION = 1
/** 系统目录（相对仓库根，收在 .knowbase 内）：未分类页收件箱 */
export const KB_INBOX_DIR = '.knowbase/_inbox'
/** 旧附件目录（历史遗留，只读兼容；D1 定稿后不再新增内容） */
export const KB_ATTACHMENTS_DIR = '.knowbase/_attachments'
/** ★ 附件区（D1 定稿）：仓库根下顶层 `.attachments/`，408 图片/编辑器插图/博客图统一入此 */
export const ATTACHMENTS_DIR = '.attachments'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** 读 settings.json（不存在/损坏返回 {}） */
function readSettingsFile(): Record<string, unknown> {
  try {
    const p = settingsPath()
    if (!existsSync(p)) return {}
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 写 settings.json（原子写，防损坏） */
function writeSettingsFile(patch: (s: Record<string, unknown>) => void): void {
  try {
    const p = settingsPath()
    const s = readSettingsFile()
    patch(s)
    const dir = join(p, '..')
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8')
    try {
      renameSync(tmp, p)
    } catch {
      if (existsSync(p)) unlinkSync(p)
      renameSync(tmp, p)
    }
  } catch {
    /* settings 不可写时静默（当前仓库仅内存态） */
  }
}

export function readCurrentVaultId(): string | null {
  const v = readSettingsFile()['currentVaultId']
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** 设置当前仓库（内存态 + 持久化 currentVaultId） */
export function setCurrentVault(v: VaultInfo | null): void {
  current = v
  writeSettingsFile((s) => {
    if (v) s['currentVaultId'] = v.rootId
    else delete s['currentVaultId']
  })
}

export function getCurrentVault(): VaultInfo | null {
  return current
}

/** 当前仓库的 .knowbase 绝对路径；无当前仓库返回 null */
export function getVaultKbRoot(): string | null {
  return current ? join(current.rootPath, KB_DIR) : null
}

/** 当前仓库的附件区（根级 .attachments）绝对路径；无当前仓库返回 null */
export function getVaultAttachmentsRoot(): string | null {
  return current ? join(current.rootPath, ATTACHMENTS_DIR) : null
}

/** 确保附件区目录存在（懒建：首次插图/导入时调用） */
export function ensureAttachmentsDir(): boolean {
  const dir = getVaultAttachmentsRoot()
  if (!dir) return false
  try {
    mkdirSync(dir, { recursive: true })
    return true
  } catch {
    return false
  }
}

/**
 * 确保当前仓库的 .knowbase 存在并写入 meta.json。
 * 返回是否就绪。目录树天然隐藏「.」开头目录，无需额外处理。
 */
export function ensureKbRoot(): boolean {
  const root = getVaultKbRoot()
  if (!root) return false
  try {
    mkdirSync(root, { recursive: true })
    const metaPath = join(root, 'meta.json')
    if (!existsSync(metaPath)) {
      writeFileSync(
        metaPath,
        JSON.stringify({ schemaVersion: KB_SCHEMA_VERSION, createdAt: new Date().toISOString() }, null, 2),
        'utf-8'
      )
    }
    return true
  } catch {
    return false
  }
}
