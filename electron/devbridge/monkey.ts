import type { BridgeErrorCode } from './response'
import { throwErr } from './response'

/**
 * Monkey 测试 —— 基于动作白名单随机执行 + 模糊参数，兜住边界处理。
 *
 * AI 写代码最容易漏的就是边界：空串、负数、超长输入、特殊字符、路径片段、
 * SQL 注入片段。本模块不关心「正确行为是什么」，只关心两件事：
 *   1. 进程没崩、数据库没坏
 *   2. 所有失败都是「结构化拒绝」（BridgeErrorWithCode），没有裸异常
 *
 * 裸异常（无 code 的 Error）即 bug 线索，全部收集返回。
 * 默认排除 data.reset 与 chaos.* —— 随机测试不能自己变成灾难。
 */

export interface MonkeyReport {
  rounds: number
  ok: number
  structuredRejections: number
  unexpectedErrors: Array<{ name: string; params: Record<string, unknown>; error: string }>
  slowest: Array<{ name: string; durationMs: number }>
  dbStillOpenable: boolean
}

const STRING_POOL = [
  '',
  ' ',
  'x'.repeat(5000),
  '💥🎉中文',
  "'; DROP TABLE entries;--",
  '../../etc/passwd',
  'C:\\Windows\\system32\\config',
  '\u0000\u0001\u0002',
  'null',
  'undefined',
  '-1',
  '1970-01-01',
  '9999-99-99',
  'attachment://../../secret',
]

const NUMBER_POOL = [-1, 0, 1, 42, 999999999, Number.MAX_SAFE_INTEGER]

const PARAM_NAMES = [
  'id',
  'habitId',
  'date',
  'title',
  'contentMd',
  'name',
  'minutes',
  'quadrant',
  'tables',
  'scenario',
  'days',
  'password',
  'categoryId',
  'ruleType',
  'ruleDays',
  'weeklyTarget',
]

function randomOf<T>(pool: T[], rand: () => number): T {
  return pool[Math.floor(rand() * pool.length)]
}

function randomParams(rand: () => number): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const count = 1 + Math.floor(rand() * 3)
  for (let i = 0; i < count; i++) {
    const key = randomOf(PARAM_NAMES, rand)
    const kind = rand()
    if (kind < 0.55) {
      params[key] = randomOf(STRING_POOL, rand)
    } else if (kind < 0.9) {
      params[key] = randomOf(NUMBER_POOL, rand)
    } else if (kind < 0.95) {
      params[key] = rand() < 0.5 ? null : true
    } else {
      params[key] = [randomOf(NUMBER_POOL, rand), randomOf(STRING_POOL, rand)]
    }
  }
  return params
}

export async function runMonkey(
  rounds: number,
  exclude: string[],
  execute: (name: string, params: Record<string, unknown>) => Promise<{ name: string; result: unknown }>,
  availableActions: string[],
  checkDbOpenable: () => boolean
): Promise<MonkeyReport> {
  const EXCLUDE = new Set([
    'data.reset',
    ...availableActions.filter((a) => a.startsWith('chaos.')),
    ...availableActions.filter((a) => a.startsWith('monkey.')),
    ...availableActions.filter((a) => a.startsWith('record.')),
    ...availableActions.filter((a) => a.startsWith('compat.')),
    ...exclude,
  ])
  const pool = availableActions.filter((a) => !EXCLUDE.has(a))
  if (pool.length === 0) {
    throwErr('E_BAD_REQUEST', '动作池为空（全部被排除）')
  }

  // 可复现：种子随机（mulberry32），失败后可用同一种子重放
  const seed = Math.floor(Math.random() * 0xffffffff)
  let state = seed
  const rand = () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const report: MonkeyReport = {
    rounds: 0,
    ok: 0,
    structuredRejections: 0,
    unexpectedErrors: [],
    slowest: [],
    dbStillOpenable: false,
  }
  const timings: Array<{ name: string; durationMs: number }> = []

  for (let i = 0; i < rounds; i++) {
    const name = randomOf(pool, rand)
    const params = randomParams(rand)
    const start = Date.now()
    try {
      await execute(name, params)
      report.ok++
    } catch (err) {
      const code = (err as { code?: BridgeErrorCode })?.code
      if (code) {
        // 结构化拒绝 = 应用按预期防御住了模糊输入
        report.structuredRejections++
      } else {
        report.unexpectedErrors.push({
          name,
          params,
          error: err instanceof Error ? `${err.message}\n${err.stack?.split('\n')[1] ?? ''}` : String(err),
        })
      }
    } finally {
      timings.push({ name, durationMs: Date.now() - start })
      report.rounds++
    }
    if (report.unexpectedErrors.length >= 20) break // 足够定位，避免刷屏
  }

  timings.sort((a, b) => b.durationMs - a.durationMs)
  report.slowest = timings.slice(0, 5)
  report.dbStillOpenable = checkDbOpenable()
  return report
}
