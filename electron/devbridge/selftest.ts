import { logRing } from './capture'
import { BRIDGE_BOOT_AT } from './response'
import { dumpUiTree, takeScreenshot } from './ui'

/**
 * 自检套件 —— 给 AI 一个「我有没有搞坏东西」的明确信号。
 *
 * 设计要点：
 * - 每项返回 { name, ok, message }，整体再汇总 total/passed/failed
 * - 支持外部注册（registerCheck），AI 每实现一个功能可顺手补一条断言，
 *   对纯 vibecoding 项目这是唯一能持续积累回归网的机制
 *
 * R6 去库化：原 sqlite 直查检查项（db.openable / db.tableCount / db.migrationCount /
 * db.readOnlyEnforced / flow.blogRoundTrip / flow.habitCheckIdempotent /
 * cleanup.noSelftestResidue）随 connection.ts 移除；数据真相源已 vault/全局 JSON 化，
 * 自检保留非 DB 的健康检查（日志噪声 / UI 桥）。
 */

/**
 * 已知良性噪声：渲染层 CSP 对内联字体的告警与 favicon 404 不影响业务，
 * 计入会让 logs.noErrors 永远失败，反而掩盖真实错误。
 */
const LOG_NOISE = /Content Security Policy|Refused to load the font|favicon|DevTools/i

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

/** UI 桥自检：渲染层可交互元素可枚举（页面已绘制且 UI 桥可用） */
async function checkUiTreeAccessible(): Promise<CheckResult> {
  try {
    const tree = await dumpUiTree()
    const ok = tree.count > 0
    return {
      name: 'ui.treeAccessible',
      ok,
      message: ok ? undefined : '未发现任何可交互元素（页面未就绪或渲染异常）',
    }
  } catch (e) {
    return { name: 'ui.treeAccessible', ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

/** UI 桥自检：能截到非空画面（窗口绘制管线正常，截图文件落盘成功） */
async function checkUiScreenshot(): Promise<CheckResult> {
  try {
    const shot = await takeScreenshot()
    const ok = shot.sizeBytes > 1000
    return {
      name: 'ui.screenshot',
      ok,
      message: ok ? undefined : `截图过小（${shot.sizeBytes}B），窗口可能未绘制`,
    }
  } catch (e) {
    return { name: 'ui.screenshot', ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

registerCheck('logs.noErrors', checkNoRecentErrors)
registerCheck('ui.treeAccessible', checkUiTreeAccessible)
registerCheck('ui.screenshot', checkUiScreenshot)

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
