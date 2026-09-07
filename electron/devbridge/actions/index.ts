import { throwErr } from '../response'
import { runMonkey } from '../monkey'
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
 * data.reset/data.seed、blog/habit/schedule/pomodoro/knowledge 系列流程动作），
 * 以及依赖 sqlite 基础设施的 chaos.*（混沌注入）与 compat.*（历史库探针）动作文件。
 * 测试数据构造与业务流程触发请改走渲染层 UI 动作（ui.*）或各模块 vaultRepo 语义。
 * monkey 健康探针不再查库。
 *
 * 原 record.*（回归录制）依赖 DB 行数采样（recorder.ts），一并移除；
 * runAction 现在只执行不埋点。
 */

export type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

const REGISTRY: Record<string, ActionHandler> = {
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

/** 核心执行 —— monkey 复用 */
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

/** 对外入口 */
export async function runAction(
  name: string,
  params: Record<string, unknown>
): Promise<{ name: string; result: unknown }> {
  return execute(name, params)
}
