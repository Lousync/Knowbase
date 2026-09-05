import { existsSync, statSync } from 'fs'
import { resolve, sep } from 'path'

/**
 * 删除仓库（P7 / D6 定稿）：整个仓库文件夹直接进 OS 回收站，不弹提醒窗；
 * 注册表移除由调用方（workspaceManager ws:deleteVault）负责。
 * 替代 clearVaultContent 的 rmSync 直删语义（该模块退役）。
 */

/** 护栏（自 clearVaultContent 留用）：路径形状是否适合作为「删除根」——绝对、存在、非盘符根/系统用户目录。
 *  防配置损坏时把整盘/用户目录送进回收站的灾难性误删。 */
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

/** 整仓文件夹 → OS 回收站（可还原兜底，R4）。失败抛错由调用方反馈。 */
export async function trashVaultFolder(rootPath: string): Promise<void> {
  if (!isAllowedClearRoot(rootPath)) {
    throw new Error('仓库路径校验失败，已中止（未删除任何内容）')
  }
  const trash = (await import('trash')).default
  await trash([rootPath])
}
