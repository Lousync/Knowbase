import { ipcMain } from 'electron'
import { getDatabase, saveToDisk } from '../connection'
import {
  getSuperviseConfig, saveSuperviseConfig, deliverLog, testPush, sendDailySummary,
} from '../../lib/pushService'

/**
 * 远程监督 IPC —— 配置读写、测试推送、历史查询、失败补推。
 * 实际逻辑在 pushService，这里做一层转发以保持 repo 目录结构一致。
 */

interface LogRow {
  id: number; push_type: string; habit_id: string | null
  title: string; content: string; status: string
  retry_count: number; error_message: string | null
  created_at: string; pushed_at: string | null
}

function rowToLog(r: LogRow) {
  return {
    id: r.id,
    pushType: r.push_type as 'instant' | 'daily',
    habitId: r.habit_id,
    title: r.title,
    content: r.content,
    status: r.status as 'success' | 'failed' | 'pending',
    retryCount: r.retry_count,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
  }
}

function queryLogs(sql: string, params: unknown[] = []): LogRow[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: LogRow[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as LogRow)
  stmt.free()
  return rows
}

export function registerSuperviseHandlers(): void {

  ipcMain.handle('supervise:getConfig', () => getSuperviseConfig())

  ipcMain.handle('supervise:saveConfig', (_e, partial: Record<string, unknown>) => saveSuperviseConfig(partial))

  ipcMain.handle('supervise:test', async () => testPush(getSuperviseConfig()))

  ipcMain.handle('supervise:getHistory', (_e, limit?: number) => {
    const n = Math.min(500, Math.max(1, limit ?? 100))
    return queryLogs('SELECT * FROM supervise_log ORDER BY id DESC LIMIT ?', [n]).map(rowToLog)
  })

  ipcMain.handle('supervise:retry', async (_e, id: number) => {
    getDatabase().run(
      "UPDATE supervise_log SET status = 'pending', error_message = NULL WHERE id = ? AND status = 'failed'",
      [id]
    )
    saveToDisk()
    await deliverLog(id)
    return rowToLog(queryLogs('SELECT * FROM supervise_log WHERE id = ?', [id])[0])
  })

  ipcMain.handle('supervise:retryAllFailed', async () => {
    const failed = queryLogs("SELECT id FROM supervise_log WHERE status = 'failed' ORDER BY id ASC")
    for (const row of failed) {
      getDatabase().run(
        "UPDATE supervise_log SET status = 'pending', error_message = NULL WHERE id = ?",
        [row.id]
      )
    }
    saveToDisk()
    let okCount = 0
    for (const row of failed) {
      const res = await deliverLog(row.id)
      if (res.ok) okCount++
    }
    return { total: failed.length, ok: okCount }
  })

  ipcMain.handle('supervise:sendDailyNow', async () => sendDailySummary(true))

  ipcMain.handle('supervise:clearHistory', () => {
    getDatabase().run('DELETE FROM supervise_log')
    saveToDisk()
  })
}
