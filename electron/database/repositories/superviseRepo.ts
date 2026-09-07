import { ipcMain } from 'electron'
import {
  getSuperviseConfig, saveSuperviseConfig, testPush, sendDailySummary,
  superviseHistory, superviseRetryOne, superviseRetryAllFailed, superviseClearHistory,
} from '../../lib/pushService'

/**
 * 远程监督 IPC —— 配置读写、测试推送、历史查询、失败补推。
 * R6 去库化：真相源 = .knowbase/modules/supervise/（config.json / log.json，sql.js 路径已移除，D9）
 * 实际逻辑在 pushService，这里做一层转发以保持 repo 目录结构一致。
 */

export function registerSuperviseHandlers(): void {

  ipcMain.handle('supervise:getConfig', () => getSuperviseConfig())

  ipcMain.handle('supervise:saveConfig', (_e, partial: Record<string, unknown>) => saveSuperviseConfig(partial))

  ipcMain.handle('supervise:test', async () => testPush(getSuperviseConfig()))

  ipcMain.handle('supervise:getHistory', (_e, limit?: number) => {
    return superviseHistory(Math.min(500, Math.max(1, limit ?? 100)))
  })

  ipcMain.handle('supervise:retry', async (_e, id: number) => superviseRetryOne(id))

  ipcMain.handle('supervise:retryAllFailed', async () => superviseRetryAllFailed())

  ipcMain.handle('supervise:sendDailyNow', async () => sendDailySummary(true))

  ipcMain.handle('supervise:clearHistory', () => superviseClearHistory())
}
