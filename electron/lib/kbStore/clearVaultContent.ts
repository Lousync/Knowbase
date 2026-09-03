/**
 * 清空当前仓库内容（db:clearAllData 的仓库侧逻辑，对齐去库化后数据布局）。
 *
 * 语义（用户 2026-09-03 拍板）：「清空全部数据」= 真删当前仓库全部内容文件
 * （根下非隐藏内容 + 整个 .knowbase），重建骨架 → 应用回首启引导重新选/建仓库。
 *
 * 安全护栏（本模块核心职责）：
 * - 只操作「当前仓库根」：路径来自 vault 注册表（非用户输入参数），此处仅做形状校验
 * - 拒绝盘符根 / 空路径 / 不存在路径 / 过浅路径（如 C:\Users）——防配置损坏时误删
 * - 隐藏项（.开头）在仓库根下不删：只删应用内容（知识/笔记目录），保留用户点隐藏文件
 *   （注：.knowbase 本身会整体重建，属应用私有目录）
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { resolve, join, sep } from 'path'

/** .knowbase 骨架重建（其余模块目录由首次写入自动建） */
export function ensureKbSkeleton(rootPath: string): void {
  const kb = join(rootPath, '.knowbase')
  mkdirSync(kb, { recursive: true })
  const meta = join(kb, 'meta.json')
  if (!existsSync(meta)) {
    writeFileSync(meta, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString() }, null, 2), 'utf-8')
  }
  for (const sub of ['_inbox', '_attachments']) {
    mkdirSync(join(kb, sub), { recursive: true })
  }
}

/** 护栏：路径形状是否适合作为「清空根」——绝对、存在、非盘符根/系统用户目录 */
export function isAllowedClearRoot(rootPath: string): boolean {
  if (typeof rootPath !== 'string' || !rootPath.trim()) return false
  const abs = resolve(rootPath)
  if (!existsSync(abs)) return false
  if (!statSync(abs).isDirectory()) return false
  // Windows 段拆分；POSIX 首段为空
  const parts = abs.split(sep).filter(Boolean)
  if (parts.length < 2) return false // 盘符根（C:\）或文件系统根（/）
  if (process.platform === 'win32' && parts.length === 2) {
    // C:\Users / C:\Windows / C:\Program Files 等系统用户目录——拒绝（防灾难性误删）
    const sysDirs = ['Users', 'Windows', 'Program Files', 'Program Files (x86)', 'PerfLogs']
    if (sysDirs.includes(parts[1])) return false
  }
  return true
}

export interface ClearResult {
  removed: number
  removedDirs: number
  rebuilt: boolean
}

/** 清空仓库内容：删根下全部非隐藏条目 + 删 .knowbase 重建骨架。调用方必须先过 isAllowedClearRoot */
export function clearVaultContent(rootPath: string): ClearResult {
  const result: ClearResult = { removed: 0, removedDirs: 0, rebuilt: false }
  // 根下非隐藏内容（知识目录/.md 等应用内容）
  for (const name of readdirSync(rootPath)) {
    if (name.startsWith('.')) continue // 隐藏项保留（仓库根用户私有文件不被应用清空误删）
    const full = join(rootPath, name)
    try {
      const isDir = statSync(full).isDirectory()
      rmSync(full, { recursive: true, force: true })
      if (isDir) result.removedDirs += 1
      result.removed += 1
    } catch { /* 占用/权限跳过单个条目，不中断整体 */ }
  }
  // .knowbase 整体重建（应用私有：模块数据/cache/plugins/附件全清）
  const kb = join(rootPath, '.knowbase')
  try {
    if (existsSync(kb)) rmSync(kb, { recursive: true, force: true })
  } catch { /* 部分文件占用时尽力删 */ }
  ensureKbSkeleton(rootPath)
  result.rebuilt = true
  return result
}
