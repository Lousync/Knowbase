import { ipcMain, BrowserWindow } from 'electron'
import { legacySummary, runLegacyImport, type ImportOptions, type ImportProgress, type MigrationReport } from '../../lib/vaultMigration'

/**
 * 迁移器产品化 IPC 层（.AGENT/docs/去库化迁移方案.md §5.4）：
 * - vault:legacySummary    → 旧数据摘要（页数/博客/附件/总字节，供引导页与设置页展示）
 * - vault:importLegacy     → 异步执行导入（长任务不阻塞主进程），立即返回 started
 * - vault:importProgress   → 进度/完成/错误事件推送（沿用 knowledgePack:progress 模式）
 * 渲染层只收摘要数字与进度，报告里的绝对路径已被 vaultMigration 替换为仓库名。
 */

let importing = false

function broadcast(payload: ImportProgress): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('vault:importProgress', payload)
  }
}

export function registerVaultMigrationHandlers(): void {
  ipcMain.handle('vault:legacySummary', () => {
    try {
      return legacySummary()
    } catch (e) {
      return { hasLegacy: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('vault:importLegacy', (_e, opts?: ImportOptions) => {
    if (importing) return { started: false, error: '已有导入任务进行中' }
    importing = true
    setImmediate(() => {
      try {
        const report: MigrationReport = runLegacyImport(opts ?? {}, (p) => broadcast(p))
        broadcast({ phase: 'done', current: 1, total: 1, message: `完成：写入 ${report.result.written} · 复制 ${report.result.copied} · 跳过 ${report.result.skipped}` })
      } catch (e) {
        broadcast({ phase: 'error', current: 0, total: 0, message: (e as Error).message })
      } finally {
        importing = false
      }
    })
    return { started: true }
  })
}
