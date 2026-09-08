import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import ignore, { type Ignore } from 'ignore'
import { getCurrentVault } from './vaultContext'

/**
 * .ignore 过滤层（docs/ignore-filter-design.md，2026-09-07 定稿）：
 *
 * - 仓库根一个 `.ignore`（与 .knowbase 同级，Windows 下大小写不敏感识别）
 * - 完整 gitignore 语法（ignore npm 包：# 注释 / * ** ? / / 锚定 / dir/ / ! 取反）
 * - 消费方 = knowledgeIndex.scanMarkdownFiles：目录命中整棵剪枝 + 文件级过滤，
 *   在系统区跳过（. 开头目录 / _inbox / _attachments）之后叠加 → 系统区不受 ! 取反影响
 * - 只影响知识索引读层（列表/搜索/图谱/反链/AI 检索/quiz 共用同一索引），
 *   编辑器是唯一写入方，不受影响
 * - mtime+size 缓存：文件未变不重编译；坏行 try/catch 单行跳过进 warnings，不拖垮整份规则
 */

export const IGNORE_FILE_NAME = '.ignore'

export interface VaultIgnoreResult {
  /** null = 无 .ignore 或无当前仓库 → 不过滤 */
  ign: Ignore | null
  /** 解析警告（坏行等），随知识索引 warnings 透出 */
  warnings: string[]
}

/** .ignore 指纹：mtime + size。null = 未打开仓库或仓库根无 .ignore */
export interface VaultIgnoreState {
  mtimeMs: number
  size: number
}

interface IgnoreCacheEntry {
  absPath: string
  mtimeMs: number
  size: number
  result: VaultIgnoreResult
}

let cache: IgnoreCacheEntry | null = null

/** 定位仓库根的 .ignore（逐目录项精确比对，兼容 .IGNORE 等大小写变体；存在但不是文件则视为无） */
function findIgnoreFile(rootPath: string): string | null {
  try {
    const hit = readdirSync(rootPath).find((e) => e.toLowerCase() === IGNORE_FILE_NAME)
    if (!hit) return null
    const abs = join(rootPath, hit)
    return statSync(abs).isFile() ? abs : null
  } catch {
    return null
  }
}

/** 读取并编译当前仓库根的 .ignore 规则（带缓存）。每次调用都会核对 mtime/size，外部改动也能被感知 */
export function getVaultIgnore(): VaultIgnoreResult {
  const current = getCurrentVault()
  if (!current) {
    cache = null
    return { ign: null, warnings: [] }
  }
  const abs = findIgnoreFile(current.rootPath)
  if (!abs) {
    cache = null
    return { ign: null, warnings: [] }
  }
  try {
    const st = statSync(abs)
    if (cache && cache.absPath === abs && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
      return cache.result
    }
    const raw = readFileSync(abs, 'utf-8')
    const ign = ignore()
    const warnings: string[] = []
    const lines = raw.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      // 逐行 add：ignore 包自行消化空行/注释；坏行只丢一行并记警告，绝不影响其余规则
      try {
        ign.add(lines[i])
      } catch (e) {
        warnings.push(`.ignore 第 ${i + 1} 行无效，已跳过：${(e as Error).message}`)
      }
    }
    const result: VaultIgnoreResult = { ign, warnings }
    cache = { absPath: abs, mtimeMs: st.mtimeMs, size: st.size, result }
    return result
  } catch {
    return { ign: null, warnings: [] }
  }
}

/**
 * 目录级命中判定（供 scanMarkdownFiles 剪枝整棵子树）。
 * 兼容两种写法：裸目录名（`build`）与带斜杠目录规则（`build/`）——任一命中即剪枝；
 * rel 为仓库内 posix 相对路径（不带首尾斜杠）。
 */
export function isDirIgnored(ign: Ignore, rel: string): boolean {
  return ign.ignores(rel + '/') || ign.ignores(rel)
}

/**
 * 当前仓库 .ignore 的指纹（与 getVaultIgnore 同一套查找逻辑，Windows 大小写不敏感）。
 * 供 getKnowledgeIndex 缓存对账：外部编辑器增删改 .ignore（无 watcher、未触发失效链）
 * 时，下一次读索引也能感知并自动重建（2026-09-08 实测缺口：外部改 .ignore 后切模块
 * 读到的仍是旧缓存，用户误以为过滤失效）。
 */
export function getVaultIgnoreState(): VaultIgnoreState | null {
  const current = getCurrentVault()
  if (!current) return null
  const abs = findIgnoreFile(current.rootPath)
  if (!abs) return null
  try {
    const st = statSync(abs)
    return { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
}
