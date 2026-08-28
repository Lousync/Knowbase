import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { recordActivity } from '../../lib/habitLinkService'

/**
 * 周期总结支持服务 ——
 * 1. 番茄钟专注场次落库（pomodoro:createSession）
 * 2. 每日博客"周/月总结"面板的区间统计（blog:periodStats）
 */

function queryOne<T>(sql: string, params: unknown[] = []): T {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  let row: T | undefined
  while (stmt.step()) row = stmt.getAsObject() as T
  stmt.free()
  return row as T
}

export function registerSummaryHandlers(): void {

  // 番茄钟：记录一次完成的专注（fire-and-forget，失败不影响计时）
  ipcMain.handle('pomodoro:createSession', (e, minutes: number) => {
    try {
      const mins = Math.max(1, Math.round(minutes || 0))
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      getDatabase().run(
        'INSERT INTO pomodoro_sessions (id, minutes, date) VALUES (?, ?, ?)',
        [randomUUID(), mins, date]
      )
      saveToDisk()
      // 联动:当天场次累计达标则自动打卡(现值由 habitLinkService 反查)
      void recordActivity({ source: 'pomodoro', date }, e.sender)
      return true
    } catch (err) {
      console.error('[summary] 记录番茄钟失败:', err)
      return false
    }
  })

  // 区间统计：start/end 均为本地 YYYY-MM-DD（含端点）
  ipcMain.handle('blog:periodStats', (_e, start: string, end: string) => {
    const db = getDatabase()
    const count = (sql: string, params: unknown[] = []): number => {
      const r = queryOne<{ n: number }>(sql, params)
      return Number(r?.n ?? 0)
    }
    return {
      // 打卡次数（habit_records.date 即纯日期）
      checkins: count('SELECT COUNT(*) AS n FROM habit_records WHERE date BETWEEN ? AND ?', [start, end]),
      // 博客篇数（entries.date 为 YYYY-MM-DD）
      blogEntries: count('SELECT COUNT(*) AS n FROM entries WHERE date BETWEEN ? AND ?', [start, end]),
      // 知识库页面数（created_at 为 UTC ISO 串,转本地日期再比较,避免东八区 0-8 点算错天）
      knowledgePages: count(
        "SELECT COUNT(*) AS n FROM knowledge_pages WHERE date(created_at, 'localtime') BETWEEN ? AND ?",
        [start, end]
      ),
      // 番茄钟专注分钟数
      pomodoroMinutes: count('SELECT COALESCE(SUM(minutes), 0) AS n FROM pomodoro_sessions WHERE date BETWEEN ? AND ?', [start, end]),
      // 完成的日程任务数（按完成时间 updated_at 归日,转本地日期）
      scheduleDone: count(
        "SELECT COUNT(*) AS n FROM schedule_todos WHERE status = 'done' AND date(updated_at, 'localtime') BETWEEN ? AND ?",
        [start, end]
      ),
    }
  })
}
