import { ipcMain, dialog, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { getDbPath } from '../connection'
import { getCurrentVault } from '../../lib/kbStore/vaultContext'
import { isWritePathAuthorized } from './exportRepo'
import { zipBuffer, unzipBuffer } from '../../lib/zip'

/**
 * 全仓导出/导入（用户拍板：sqlite 全量放进 .knowbase，整仓打成 zip）。
 * - 导出：userData 的 knowledge.db 副本 → 当前仓库 .knowbase/backup/knowledge.db，
 *   再把整个仓库目录压成一个 zip（内容含 md/附件/.knowbase）。
 * - 导入/恢复：解压备份 zip 到目标目录重建仓库；可选把 backup 内 db 还原回 userData（重启生效）。
 * 大仓库（数百 MB 附件）会一次性读入内存压缩，属已知限制（后续可换流式）。
 */

function requireVault(): string {
  const cur = getCurrentVault()
  if (!cur) throw new Error('当前没有打开的仓库')
  return cur.rootPath
}

function walkFiles(dir: string, out: string[]): void {
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    const p = join(dir, n)
    let isDir = false
    try { isDir = statSync(p).isDirectory() } catch { continue }
    if (isDir) { walkFiles(p, out); continue }
    out.push(p)
  }
}

function safeUnder(targetRoot: string, relName: string): string | null {
  // 防 zip-slip：解出的相对路径必须落在目标目录内
  const abs = resolve(targetRoot, relName)
  if (!abs.startsWith(resolve(targetRoot) + sep)) return null
  return abs
}

export function registerVaultBackupHandlers(): void {
  // 导出状态（供 UI 提示仓库是否已有 sqlite 快照）
  ipcMain.handle('vaultBackup:getState', () => {
    try {
      const root = requireVault()
      const bak = join(root, '.knowbase', 'backup', 'knowledge.db')
      let dbBytes = 0
      try { dbBytes = existsSync(bak) ? statSync(bak).size : 0 } catch { /* ignore */ }
      return { ok: true, root, hasBackupDb: dbBytes > 0, dbBytes }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  // 全仓导出：db 快照入 .knowbase/backup + 整仓 zip（zipPath 须经保存对话框授权）
  ipcMain.handle('vaultBackup:exportToZip', (_e, zipPath: string) => {
    if (!isWritePathAuthorized(zipPath)) throw new Error('写入路径未经过保存对话框授权,已拒绝')
    const root = requireVault()
    const kbDir = join(root, '.knowbase')
    const backupDir = join(kbDir, 'backup')
    mkdirSync(backupDir, { recursive: true })
    const dbSrc = getDbPath()
    const dbDst = join(backupDir, 'knowledge.db')
    if (!existsSync(dbSrc)) throw new Error('未找到 sqlite 数据库文件')
    copyFileSync(dbSrc, dbDst)

    const files: string[] = []
    walkFiles(root, files)
    const entries = files.map((f) => ({
      path: relative(root, f).replace(/\\/g, '/'),
      data: readFileSync(f),
    }))
    writeFileSync(zipPath, zipBuffer(entries))
    return { ok: true, fileCount: files.length, dbBytes: statSync(dbDst).size, zipPath }
  })

  // 选择备份 zip（渲染层无授权需求，仅读）
  ipcMain.handle('vaultBackup:pickArchive', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '仓库备份包', extensions: ['zip'] }],
      title: '选择要导入的整仓备份 zip',
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  // 解包恢复：把 zip 展开到目标目录（打开对话框选目标，为空目标最安全）
  ipcMain.handle('vaultBackup:restoreArchive', async (_e, archivePath: string) => {
    if (!existsSync(archivePath)) throw new Error('备份包不存在')
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return { ok: false, message: '没有可用窗口' }
    const targetResult = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择解压目标目录（建议空目录/新目录）',
    })
    if (targetResult.canceled || targetResult.filePaths.length === 0) return { ok: false, message: '未选择目标目录' }
    const target = targetResult.filePaths[0]
    const entries = unzipBuffer(readFileSync(archivePath))
    let written = 0
    let dbFound = false
    for (const [relName, data] of entries) {
      if (relName.endsWith('/')) continue
      const abs = safeUnder(target, relName)
      if (!abs) continue
      if (relName === '.knowbase/backup/knowledge.db') dbFound = true
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, data)
      written++
    }
    return { ok: true, target, written, dbFound }
  })

  // 把当前仓库 .knowbase/backup/knowledge.db 还原到 userData（重启应用生效）
  ipcMain.handle('vaultBackup:restoreDb', () => {
    const root = requireVault()
    const src = join(root, '.knowbase', 'backup', 'knowledge.db')
    if (!existsSync(src)) throw new Error('仓库内没有 backup/knowledge.db，请先导出')
    const dst = getDbPath()
    const tmp = join(dirname(dst), `.${randomUUID()}.tmp`)
    copyFileSync(src, tmp)
    try { renameSync(tmp, dst) } catch { if (existsSync(dst)) unlinkSync(dst); renameSync(tmp, dst) }
    return { ok: true, needRestart: true }
  })
}
