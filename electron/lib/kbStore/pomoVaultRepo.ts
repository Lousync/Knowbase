import { randomUUID } from 'crypto'
import { readJson, writeJson } from './jsonStore'

/**
 * 番茄钟专注场次（R6 去库化补迁，D9）：.knowbase/modules/pomodoro/sessions.json
 * 行结构与原 pomodoro_sessions 表一致（snake_case），消费方：summaryRepo 记录/统计、builtinTools AI 报表。
 */

export interface PomoSessionRow {
  id: string
  minutes: number
  date: string
  created_at?: string
}

export function pomoSessionsAll(): PomoSessionRow[] {
  return readJson<PomoSessionRow[]>('modules/pomodoro', 'sessions.json', [])
}

export function pomoSessionsSave(rows: PomoSessionRow[]): void {
  writeJson('modules/pomodoro', 'sessions.json', rows)
}

/** 记录一次完成的专注（fire-and-forget 场景，失败抛错由调用方兜底） */
export function pomoSessionCreate(minutes: number): PomoSessionRow {
  const now = new Date()
  const row: PomoSessionRow = {
    id: randomUUID(),
    minutes,
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    created_at: now.toISOString(),
  }
  pomoSessionsSave([...pomoSessionsAll(), row])
  return row
}
