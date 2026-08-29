import { randomUUID } from 'crypto'
import { getDatabase } from '../database/connection'
import { throwErr } from './response'

/**
 * 回归录制器 —— 把「人工正常使用」变成回归资产。
 *
 * 分工：工具负责录制与重放，断言生成交给 AI。
 *   录制（用户正常使用）→ 轨迹 JSON → AI 阅读并生成 selftest → 常驻回归网
 *
 * 轨迹内容是「动作 → 数据变化」的因果对：每个动作后附核心表行数，
 * AI 据此生成断言（如「打卡后 habit_records 应多一行且 source='auto'」）。
 *
 * 隐私：轨迹含用户输入的日志正文等，仅存内存不出本机；导出给 AI 时应提示。
 */

const MAX_TRACES = 3
/** 工具自身动作不录入轨迹 */
const EXCLUDED_PREFIXES = ['record.', 'chaos.', 'monkey.', 'compat.']

/** 每步附带的核心表行数（可按需增减） */
const CORE_TABLES = ['entries', 'habits', 'habit_records', 'schedule_todos', 'knowledge_pages', 'attachments']

export interface TraceEntry {
  seq: number
  ts: string
  name: string
  params: Record<string, unknown>
  ok: boolean
  resultSummary: string
  tableCounts: Record<string, number>
}

export interface Trace {
  id: string
  startedAt: string
  endedAt?: string
  entries: TraceEntry[]
}

const traces = new Map<string, Trace>()
let current: Trace | null = null
let seqCounter = 0

function coreTableCounts(): Record<string, number> {
  const db = getDatabase()
  const out: Record<string, number> = {}
  for (const t of CORE_TABLES) {
    try {
      const r = db.exec(`SELECT count(*) FROM "${t}"`)
      out[t] = r.length > 0 && r[0].values ? Number(r[0].values[0][0]) : -1
    } catch {
      out[t] = -1
    }
  }
  return out
}

export function isRecording(): boolean {
  return current !== null
}

export function startRecording(): { traceId: string; note: string } {
  if (current) throwErr('E_ACTION_FAILED', '已在录制中', { traceId: current.id })
  current = { id: randomUUID().slice(0, 8), startedAt: new Date().toISOString(), entries: [] }
  return {
    traceId: current.id,
    note: '录制中。现在正常使用应用或调用 /action，结束后 POST /action { name: "record.stop" }。',
  }
}

export function stopRecording(): Trace {
  if (!current) throwErr('E_ACTION_FAILED', '当前没有进行中的录制')
  current.endedAt = new Date().toISOString()
  const done = current
  current = null
  if (traces.size >= MAX_TRACES) {
    const oldest = traces.keys().next().value
    if (oldest !== undefined) traces.delete(oldest)
  }
  traces.set(done.id, done)
  return done
}

export function getTrace(id: string): Trace {
  const t = traces.get(id)
  if (!t) throwErr('E_BAD_REQUEST', '轨迹不存在', { available: [...traces.keys()] })
  return t
}

export function listTraces(): Array<Omit<Trace, 'entries'> & { entryCount: number }> {
  return [...traces.values()].map(({ entries, ...meta }) => ({ ...meta, entryCount: entries.length }))
}

/** 由 actions/index.ts 的 runAction 埋点调用；任何失败静默，不影响业务动作 */
export function recordAction(
  name: string,
  params: Record<string, unknown>,
  ok: boolean,
  result: unknown
): void {
  if (!current) return
  if (EXCLUDED_PREFIXES.some((p) => name.startsWith(p))) return
  try {
    current.entries.push({
      seq: ++seqCounter,
      ts: new Date().toISOString(),
      name,
      params,
      ok,
      resultSummary: JSON.stringify(result)?.slice(0, 300) ?? '',
      tableCounts: coreTableCounts(),
    })
  } catch {
    /* 录制失败绝不影响业务动作 */
  }
}

export function replayableTrace(id: string): Trace {
  const t = getTrace(id)
  const actionable = t.entries.filter((e) => e.ok)
  if (actionable.length === 0) throwErr('E_BAD_REQUEST', '轨迹中没有可重放的成功动作')
  return { ...t, entries: actionable }
}
