import { ipcMain, BrowserWindow, dialog } from 'electron'
import { readFileSync } from 'fs'
import { basename } from 'path'

function fileNameBase(filePath: string): string {
  return basename(filePath).replace(/\.(md|txt)$/i, '')
}

export function registerImportHandlers(): void {
  // 打开文件选择对话框
  ipcMain.handle('import:showOpenDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件 (.md, .txt)', extensions: ['md', 'txt'] }
      ],
      title: '导入文件到知识库'
    })

    return result.canceled ? [] : result.filePaths
  })

  // 批量读取文件内容
  ipcMain.handle('import:readFiles', async (_e, paths: string[]) => {
    return paths.map(p => {
      try {
        const content = readFileSync(p, 'utf-8')
        return { path: p, baseName: fileNameBase(p), content }
      } catch (e) {
        return { path: p, baseName: fileNameBase(p), content: '', error: String(e) }
      }
    })
  })
}
