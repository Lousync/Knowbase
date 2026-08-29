import { randomUUID } from 'crypto'
import { getDatabase } from '../database/connection'
import { query, schema, migrations, assertReadOnly } from './db'
import { logRing } from './capture'
import { BRIDGE_BOOT_AT } from './response'

/**
 * 自检套件 —— 给 AI 一个「我有没有搞坏东西」的明确信号。
 *
 * 设计要点：
 * - 每项返回 { name, ok, message }，整体再汇总 total/passed/failed
 * - 支持外部注册（registerCheck），AI 每实现一个功能可顺手补一条断言，
 *   对纯 vibecoding 项目这是唯一能持续积累回归网的机制
 * - 自检产生的临时数据一律用 SELFTEST_TAG 标记并在结束时清理，不留脏数据
 */

/**
 * 基线：判定用「不少于」而非「等于」——新增表/迁移属于正常演进，
 * 表或迁移丢失才是回归。基线偏低时无需改动，丢失时会立即报警。
 */
const EXPECTED_TABLES = 33
const EXPECTED_MIGRATIONS = 47

/**
 * 已知良性噪声：渲染层 CSP 对内联字体的告警与 favicon 404 不影响业务，
 * 计入会让 logs.noErrors 永远失败，反而掩盖真实错误。
 */
const LOG_NOISE = /Content Security Policy|Refused to load the font|favicon|DevTools/i

/** 自检临时数据标记 */
const SELFTEST_TAG = '[selftest]'

export interface CheckResult {
  name: string
  ok: boolean
  message?: string
  durationMs?: number
  req?: string
}

export type CheckFn = () => CheckResult | Promise<CheckResult>

/** 需求关联元信息：让回归网有覆盖率地图（见 GET /coverage） */
export interface CheckMeta {
  /** 关联的需求/功能标识（如 'habit-linkage'），AI 实现功能时同步登记 */
  req?: string
}

interface CheckEntry {
  fn: CheckFn
  meta?: CheckMeta
}

const checks = new Map<string, CheckEntry>()

export function registerCheck(name: string, fn: CheckFn, meta?: CheckMeta): void {
  checks.set(name, { fn, meta })
}

export interface CoverageFeature {
  req: string
  checks: string[]
  covered: boolean
}

/** 需求→断言覆盖地图：哪些功能有回归保护、哪些裸奔 */
export function coverage(): { features: CoverageFeature[]; totalChecks: number; uncoveredReqs: string[] } {
  const byReq = new Map<string, string[]>()
  for (const [name, { meta }] of checks) {
    const req = meta?.req
    if (!req) continue
    const list = byReq.get(req) ?? []
    list.push(name)
    byReq.set(req, list)
  }
  const features: CoverageFeature[] = [...byReq.entries()]
    .map(([req, cs]) => ({ req, checks: cs.sort(), covered: cs.length > 0 }))
    .sort((a, b) => a.req.localeCompare(b.req))
  return { features, totalChecks: checks.size, uncoveredReqs: [] }
}

// ---------- 内置检查项 ----------

function checkDbOpenable(): CheckResult {
  getDatabase().exec('SELECT 1')
  return { name: 'db.openable', ok: true }
}

function checkTableCount(): CheckResult {
  const { tableCount, tables } = schema()
  const ok = tableCount >= EXPECTED_TABLES
  return {
    name: 'db.tableCount',
    ok,
    message: ok
      ? undefined
      : `基线 ${EXPECTED_TABLES} 张，实际 ${tableCount} 张（可能有表被误删）`,
    ...(ok ? {} : ({ detail: tables.map((t) => t.name) } as never)),
  }
}

function checkMigrations(): CheckResult {
  const { count } = migrations()
  const ok = count >= EXPECTED_MIGRATIONS
  return {
    name: 'db.migrationCount',
    ok,
    message: ok ? undefined : `基线 ${EXPECTED_MIGRATIONS} 条，实际 ${count} 条（迁移丢失？）`,
  }
}

function checkReadOnly(): CheckResult {
  try {
    assertReadOnly('DELETE FROM entries')
    return { name: 'db.readOnlyEnforced', ok: false, message: '写操作未被拦截，只读约束失效' }
  } catch (e) {
    const code = (e as { code?: string })?.code
    return {
      name: 'db.readOnlyEnforced',
      ok: code === 'E_SQL_READONLY',
      message: code === 'E_SQL_READONLY' ? undefined : `抛出了非预期错误码: ${String(code)}`,
    }
  }
}

function checkNoRecentErrors(): CheckResult {
  const real = logRing
    .list()
    .filter((i) => i.level === 'error' && !LOG_NOISE.test(i.message))
  return {
    name: 'logs.noErrors',
    ok: real.length === 0,
    message: real.length === 0 ? undefined : `捕获到 ${real.length} 条 error 级日志（已排除 CSP 等良性噪声）`,
  }
}

function checkBlogRoundTrip(): CheckResult {
  const db = getDatabase()
  const id = randomUUID()
  const title = `${SELFTEST_TAG} roundtrip ${id}`
  const now = new Date().toISOString()
  try {
    db.run(
      `INSERT INTO entries (id, title, content_md, content_html, date, created_at, updated_at, word_count, states)
       VALUES (?, ?, '自检内容', '', '1970-01-01', ?, ?, 4, '')`,
      [id, title, now, now]
    )
    const { rows } = query('SELECT id, title, content_md FROM entries WHERE id = ?', [id])
    const ok = rows.length === 1 && String(rows[0].title) === title
    return {
      name: 'flow.blogRoundTrip',
      ok,
      message: ok ? undefined : '写入后未能按 id 读回',
    }
  } catch (e) {
    return { name: 'flow.blogRoundTrip', ok: false, message: String(e) }
  } finally {
    try {
      db.run('DELETE FROM entries WHERE id = ?', [id])
    } catch {
      /* 清理失败不影响结果 */
    }
  }
}

function checkHabitIdempotent(): CheckResult {
  const db = getDatabase()
  const habitId = randomUUID()
  const now = new Date().toISOString()
  try {
    db.run(
      `INSERT INTO habits (id, name, color, icon, rule_type, rule_days, weekly_target, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, '#3B82F6', 'check', 'daily', '[1,2,3,4,5,6,0]', 3, 0, 0, ?, ?)`,
      [habitId, `${SELFTEST_TAG} habit`, now, now]
    )
    const date = '1970-01-01'
    db.run('INSERT OR IGNORE INTO habit_records (id, habit_id, date, created_at) VALUES (?,?,?,?)', [
      randomUUID(),
      habitId,
      date,
      now,
    ])
    const first = db.getRowsModified()
    db.run('INSERT OR IGNORE INTO habit_records (id, habit_id, date, created_at) VALUES (?,?,?,?)', [
      randomUUID(),
      habitId,
      date,
      now,
    ])
    const second = db.getRowsModified()

    const ok = first > 0 && second === 0
    return {
      name: 'flow.habitCheckIdempotent',
      ok,
      message: ok ? undefined : `首次插入=${first}，重复插入=${second}（期望 >0 与 0）`,
    }
  } catch (e) {
    return { name: 'flow.habitCheckIdempotent', ok: false, message: String(e) }
  } finally {
    try {
      db.run('DELETE FROM habit_records WHERE habit_id = ?', [habitId])
      db.run('DELETE FROM habits WHERE id = ?', [habitId])
    } catch {
      /* ignore */
    }
  }
}

function checkNoSelftestResidue(): CheckResult {
  const { rows } = query(
    `SELECT count(*) AS c FROM entries WHERE title LIKE '${SELFTEST_TAG}%'`
  )
  const c = Number(rows[0]?.c ?? 0)
  return {
    name: 'cleanup.noSelftestResidue',
    ok: c === 0,
    message: c === 0 ? undefined : `残留 ${c} 条自检数据`,
  }
}

registerCheck('db.openable', checkDbOpenable)
registerCheck('db.tableCount', checkTableCount)
registerCheck('db.migrationCount', checkMigrations)
registerCheck('db.readOnlyEnforced', checkReadOnly)
registerCheck('logs.noErrors', checkNoRecentErrors)
registerCheck('flow.blogRoundTrip', checkBlogRoundTrip)
registerCheck('flow.habitCheckIdempotent', checkHabitIdempotent)
registerCheck('cleanup.noSelftestResidue', checkNoSelftestResidue)

export interface SelfTestReport {
  total: number
  passed: number
  failed: number
  items: CheckResult[]
  uptimeMs: number
}

export async function runSelfTest(only?: string): Promise<SelfTestReport> {
  const names = only ? [only] : [...checks.keys()].sort()
  const items: CheckResult[] = []

  for (const name of names) {
    const entry = checks.get(name)
    if (!entry) {
      items.push({ name, ok: false, message: '未注册的检查项' })
      continue
    }
    const start = Date.now()
    try {
      const r = await entry.fn()
      items.push({ ...r, req: entry.meta?.req, durationMs: Date.now() - start })
    } catch (e) {
      items.push({ name, ok: false, message: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start })
    }
  }

  const passed = items.filter((i) => i.ok).length
  return {
    total: items.length,
    passed,
    failed: items.length - passed,
    items,
    uptimeMs: Date.now() - BRIDGE_BOOT_AT,
  }
}

export function listChecks(): string[] {
  return [...checks.keys()].sort()
}
