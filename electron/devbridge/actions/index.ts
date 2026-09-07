import { throwErr } from '../response'
import {
  corruptMainDb,
  corruptBak,
  restoreMainDb,
  malformedBackupZip,
  halfMigratedDb,
} from '../chaos'
import { runMonkey } from '../monkey'
import { startRecording, stopRecording, replayableTrace } from '../recorder'
import { buildHistoricalDb, restoreCurrentDb } from '../compat'
import {
  clickUi,
  typeUi,
  pressKeyUi,
  waitForUi,
  scrollUi,
  dropFileUi,
  mockDialogUi,
  restoreDialogUi,
  dialogStateUi,
  windowUi,
  clipboardUi,
} from '../ui'

/**
 * 动作注册表 —— 只执行这里登记过的名字，不接受任意代码或任意 SQL。
 * 新增动作：在下方加一项即可，AI 可通过 GET / 自举发现。
 *
 * 处置（R6 去库化收尾）：删除 DB 直查动作 actions/auth.ts、actions/data.ts、
 * actions/flows.ts（auth.hasPassword/auth.unlock/auth.setPassword/auth.clearPassword、
 * data.reset/data.seed、blog/habit/schedule/pomodoro/knowledge 系列流程动作）。
 * sqlite 基础设施（connection.ts）删除后这些直查无法存活；测试数据构造与业务流程
 * 触发请改走渲染层 UI 动作（ui.*）或各模块 vaultRepo 语义。monkey 健康探针不再查库。
 *
 * runAction = execute + 录制埋点；record.replay 走 execute，
 * 保证重放不会被再次录入轨迹。
 */

export type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

/** 危险动作统一要求显式 confirm，漏传直接拒绝 */
function withConfirm(handler: ActionHandler): ActionHandler {
  return (params) => {
    if (params?.confirm !== true) {
      throwErr('E_NEED_CONFIRM', '破坏性动作需显式传 confirm: true', {
        example: { name: '?', params: { confirm: true } },
      })
    }
    return handler(params)
  }
}

const REGISTRY: Record<string, ActionHandler> = {
  // ---------- 混沌注入（全部 confirm；验证姿势见各返回值 warning） ----------
  'chaos.corruptMainDb': withConfirm(() => corruptMainDb()),
  'chaos.corruptBak': withConfirm(() => corruptBak()),
  'chaos.restoreMainDb': withConfirm(() => restoreMainDb()),
  'chaos.malformedBackupZip': withConfirm(() => malformedBackupZip()),
  'chaos.halfMigratedDb': withConfirm(() => halfMigratedDb()),

  // ---------- 回归录制 ----------
  'record.start': () => startRecording(),
  'record.stop': () => stopRecording(),
  'record.replay': async (p) => {
    const traceId = String(p.traceId ?? '')
    const trace = replayableTrace(traceId)
    const results: Array<{ seq: number; name: string; ok: boolean; durationMs: number; error?: string }> = []
    for (const entry of trace.entries) {
      const start = Date.now()
      try {
        await execute(entry.name, entry.params)
        results.push({ seq: entry.seq, name: entry.name, ok: true, durationMs: Date.now() - start })
      } catch (err) {
        results.push({
          seq: entry.seq,
          name: entry.name,
          ok: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return {
      traceId,
      replayed: results.length,
      failed: results.filter((r) => !r.ok).length,
      results,
    }
  },

  // ---------- Monkey ----------
  'monkey.run': async (p) => {
    const rounds = Math.min(1000, Math.max(1, Number(p.rounds ?? 200)))
    const exclude = Array.isArray(p.exclude) ? p.exclude.map(String) : []
    return runMonkey(
      rounds,
      exclude,
      execute,
      Object.keys(REGISTRY),
      // R6 去库化：健康探针不再直查 sqlite（connection.ts 删除后无库可查），
      // 固定返回 true，仅保留 runMonkey 的探针签名
      () => true
    )
  },

  // ---------- 兼容探针 ----------
  'compat.build': withConfirm((p) => buildHistoricalDb(String(p.until ?? ''))),
  'compat.restore': withConfirm(() => restoreCurrentDb()),

  // ---------- UI 操作（真实鼠标/键盘事件；target 支持 CSS 选择器 / text=文本 / #N 树索引） ----------
  'ui.click': (p) => clickUi(p),
  'ui.type': (p) => typeUi(p),
  'ui.key': (p) => pressKeyUi(p),
  'ui.wait': (p) => waitForUi(p),
  'ui.scroll': (p) => scrollUi(p),
  'ui.dropFile': (p) => dropFileUi(p),
  'ui.dialog.mock': (p) => mockDialogUi(p),
  'ui.dialog.restore': () => restoreDialogUi(),
  'ui.dialog.state': () => dialogStateUi(),
  'ui.window': (p) => windowUi(p),
  'ui.clipboard': (p) => clipboardUi(p),
}

export function listActions(): string[] {
  return Object.keys(REGISTRY).sort()
}

/** 核心执行（无录制埋点）—— record.replay / monkey 复用 */
async function execute(
  name: string,
  params: Record<string, unknown>
): Promise<{ name: string; result: unknown }> {
  if (typeof name !== 'string' || !name) {
    throwErr('E_BAD_REQUEST', '缺少动作名 name')
  }
  const handler = REGISTRY[name]
  if (!handler) {
    throwErr('E_ACTION_UNKNOWN', `未注册的动作: ${name}`, { available: listActions() })
  }
  const result = await handler(params ?? {})
  return { name, result }
}

/** 对外入口：执行 + 录制埋点（工具自身动作不录入；失败动作也录，重放时过滤） */
export async function runAction(
  name: string,
  params: Record<string, unknown>
): Promise<{ name: string; result: unknown }> {
  try {
    const outcome = await execute(name, params)
    try {
      const { recordAction } = await import('../recorder')
      recordAction(name, params, true, outcome.result)
    } catch {
      /* 录制失败不影响业务动作 */
    }
    return outcome
  } catch (err) {
    try {
      const { recordAction } = await import('../recorder')
      recordAction(name, params, false, { error: err instanceof Error ? err.message : String(err) })
    } catch {
      /* ignore */
    }
    throw err
  }
}
