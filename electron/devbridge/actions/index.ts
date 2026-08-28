import { throwErr } from '../response'
import { resetData, seedData, type Scenario } from './data'
import { hasPassword, unlock, setPassword, clearPassword } from './auth'
import {
  blogCreate,
  blogUpdate,
  habitCreate,
  habitCheck,
  habitUncheck,
  scheduleCreateTodo,
  scheduleCompleteTodo,
  pomodoroComplete,
  knowledgeCreatePage,
} from './flows'

/**
 * 动作注册表 —— 只执行这里登记过的名字，不接受任意代码或任意 SQL。
 * 新增动作：在下方加一项即可，AI 可通过 GET / 自举发现。
 */

export type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

const REGISTRY: Record<string, ActionHandler> = {
  // 数据
  'data.reset': (p) => {
    if (p.confirm !== true) {
      throwErr('E_NEED_CONFIRM', '清空数据需显式传 confirm: true', {
        example: { name: 'data.reset', params: { confirm: true } },
      })
    }
    return resetData(Array.isArray(p.tables) ? (p.tables as string[]) : undefined)
  },
  'data.seed': (p) => seedData(String(p.scenario ?? 'full') as Scenario, Number(p.days ?? 30)),

  // 权限
  'auth.hasPassword': () => hasPassword(),
  'auth.unlock': (p) => unlock(String(p.password ?? '')),
  'auth.setPassword': (p) => setPassword(String(p.password ?? '')),
  'auth.clearPassword': (p) => clearPassword(String(p.password ?? '')),

  // 核心流程
  'blog.create': (p) => blogCreate(p),
  'blog.update': (p) => blogUpdate(p),
  'habit.create': (p) => habitCreate(p),
  'habit.check': (p) => habitCheck(p),
  'habit.uncheck': (p) => habitUncheck(p),
  'schedule.createTodo': (p) => scheduleCreateTodo(p),
  'schedule.completeTodo': (p) => scheduleCompleteTodo(p),
  'pomodoro.complete': (p) => pomodoroComplete(p),
  'knowledge.createPage': (p) => knowledgeCreatePage(p),
}

export function listActions(): string[] {
  return Object.keys(REGISTRY).sort()
}

export async function runAction(
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
