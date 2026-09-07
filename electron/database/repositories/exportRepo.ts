import { ipcMain, dialog, BrowserWindow } from 'electron'
import { resolve } from 'path'
import { writeFileSync, statSync } from 'fs'
import * as iconv from 'iconv-lite'

/**
 * 导出基础层（R6 去库化收尾处置）：
 * - 保留：保存对话框（写路径授权源）+ 文本文件写出（渲染层 blog md / knowledge json
 *   等 vault 数据导出仍经由本通道落盘）。
 * - 删除：buildAllData 全库 JSON 导出（逐表读 sqlite）——数据已 vault 化，
 *   连同 backupRepo 的整包备份一起退役；全仓备份改走 vaultBackupRepo（.knowbase 目录 zip）。
 */

function encodeText(content: string, encoding: string): Buffer {
  if (encoding === 'utf-8' || encoding === 'utf8') return Buffer.from(content, 'utf-8')
  try { return iconv.encode(content, encoding) as Buffer }
  catch { return Buffer.from(content, 'utf-8') }
}

// ===== 写路径授权 =====
// 只有近期由"保存对话框"返回的路径才允许被写入 IPC 使用——
// 防止渲染层被注入后用任意路径覆写系统文件(启动目录/计划任务等)。
const authorizedWritePaths = new Set<string>()

export function isWritePathAuthorized(p: string): boolean {
  try {
    const resolved = resolve(p)
    for (const ap of authorizedWritePaths) {
      if (resolve(ap) === resolved) return true
    }
  } catch { /* ignore */ }
  return false
}

export function registerExportHandlers(): void {
  // ===== File dialogs =====
  ipcMain.handle('export:showSaveDialog', async (_e, opts: { defaultName: string; filters: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { filePath: null }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: opts.defaultName,
      filters: opts.filters
    })
    const filePath = result.canceled ? null : result.filePath ?? null
    if (filePath) authorizedWritePaths.add(filePath)
    return { filePath }
  })

  // ===== File I/O =====
  ipcMain.handle('export:writeTextFile', (_e, filePath: string, content: string, encoding: string = 'utf-8') => {
    if (!isWritePathAuthorized(filePath)) throw new Error('写入路径未经过保存对话框授权,已拒绝')
    const buf = encodeText(content, encoding)
    writeFileSync(filePath, buf)
    const size = statSync(filePath).size
    return { filePath, size }
  })
}
