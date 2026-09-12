/**
 * 验证「稍后（打盹）」写入链路：schedule:updateTodo → vaultUpdateTodo 是否真的把
 * snoozeUntil 落到行上。
 *
 * 背景（2026-09-12 报障）：提醒条「稍后」点击无反应。渲染层链路完好
 * （snooze → updateScheduleTodo → notifyDataChanged('schedule') → useDataChanged → load），
 * 怀疑写入侧把 snoozeUntil 静默丢弃 —— 列白名单 TODO_COLUMNS 里有 snooze_until，
 * 但 switch 里没有对应 case，`isTodoColumn` 放行后直接落空。
 *
 * 做法与 verify-tool-result-cap.mjs 一致：从 scheduleVaultRepo.ts 抽出**真实实现**
 * （stripTypeScriptTypes 剥类型 + 沙箱 data: URL 执行），只 stub 掉磁盘读写
 * vaultTodosAll / vaultTodosSave，验的是真实代码而不是复刻品。
 *
 * 用法：node .AGENT/scripts/schedule-reminder/verify-snooze-persist.mjs [repo路径]
 */
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

const REPO = process.argv[2] ?? 'E:/Projects/KnowledgeRecorder'
const SRC = path.resolve(REPO, 'electron/lib/kbStore/scheduleVaultRepo.ts')
const src = fs.readFileSync(SRC, 'utf8')

/** 按大括号配平切出完整函数定义 */
function sliceBalanced(text, from) {
  const start = text.indexOf('{', from)
  if (start < 0) throw new Error('未找到函数体起始大括号')
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(from, i + 1)
    }
  }
  throw new Error('大括号未配平')
}

const colTypeAt = src.indexOf('type TodoColumn')
if (colTypeAt < 0) throw new Error('未找到 type TodoColumn（白名单类型）')
const fnAt = src.indexOf('function vaultUpdateTodo')
if (fnAt < 0) throw new Error('未找到 vaultUpdateTodo')

// 切片 = 白名单类型 + TODO_COLUMNS + camelToSnake + isTodoColumn + vaultUpdateTodo
const code = src.slice(colTypeAt, fnAt) + sliceBalanced(src, fnAt)

const stubs = `
let __rows = []
function vaultTodosAll() { return __rows }
function vaultTodosSave(rows) { __rows = rows }
export function __seed(rows) { __rows = rows }
export function __dump() { return __rows }
`
// vaultUpdateTodo 在源文件里已是 `export function`，这里只补 TODO_COLUMNS
const exportsList = 'export { TODO_COLUMNS }'
const js = stripTypeScriptTypes(stubs + code + '\n' + exportsList, {
  mode: 'strip',
  sourceMap: false,
})
const mod = await import(`data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`)

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass, detail })

const NOW = '2026-09-12T07:00:00.000Z'
const baseRow = () => ({
  id: 'todo-1', title: '上周的知识点整理归档', description: '', date: '2026-07-05',
  time: '2026-07-05 00:00', quadrant: 1, task_type: 'deadline', tag_id: null, status: 'pending',
  sort_order: 0, end_criteria: '', parent_id: null,
  scheduled_start: null, scheduled_end: null, snooze_until: null,
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
})
const seed = () => { mod.__seed([baseRow()]); return mod.__dump()[0] }

// ---------- 1. 核心：snoozeUntil 必须真正落到行上 ----------
{
  seed()
  const out = mod.vaultUpdateTodo('todo-1', { snoozeUntil: '2026-09-12 15:00' }, NOW)
  const persisted = mod.__dump()[0]
  check('snoozeUntil 写入：返回值带 snooze_until',
    out?.snooze_until === '2026-09-12 15:00', JSON.stringify(out?.snooze_until))
  check('snoozeUntil 写入：已持久化（不是只改内存副本）',
    persisted.snooze_until === '2026-09-12 15:00', JSON.stringify(persisted.snooze_until))
}
// 打盹可被清空（null 照写，与 sqlite 同口径）
{
  seed()
  mod.vaultUpdateTodo('todo-1', { snoozeUntil: '2026-09-12 15:00' }, NOW)
  mod.vaultUpdateTodo('todo-1', { snoozeUntil: null }, NOW)
  check('snoozeUntil 清空：null 照写', mod.__dump()[0].snooze_until === null)
}
// undefined 跳过（不能把既有值冲掉）
{
  seed()
  mod.vaultUpdateTodo('todo-1', { snoozeUntil: '2026-09-12 15:00' }, NOW)
  mod.vaultUpdateTodo('todo-1', { snoozeUntil: undefined }, NOW)
  check('snoozeUntil undefined：跳过不覆盖',
    mod.__dump()[0].snooze_until === '2026-09-12 15:00', JSON.stringify(mod.__dump()[0].snooze_until))
}

// ---------- 2. 回归：白名单里其余 12 列必须全部生效 ----------
const COLUMN_CASES = [
  ['title', 'title', '改后的标题'],
  ['description', 'description', '改后的描述'],
  ['date', 'date', '2026-12-31'],
  ['time', 'time', '2026-12-31 23:30'],
  ['quadrant', 'quadrant', 3],
  ['taskType', 'task_type', 'plan'],
  ['tagId', 'tag_id', 'tag-9'],
  ['status', 'status', 'done'],
  ['endCriteria', 'end_criteria', '验收标准'],
  ['parentId', 'parent_id', 'parent-9'],
  ['scheduledStart', 'scheduled_start', 1780000000000],
  ['scheduledEnd', 'scheduled_end', 1780003600000],
  ['snoozeUntil', 'snooze_until', '2026-09-12 15:00'],
]
for (const [patchKey, rowKey, value] of COLUMN_CASES) {
  seed()
  mod.vaultUpdateTodo('todo-1', { [patchKey]: value }, NOW)
  check(`列回归 ${patchKey} → ${rowKey}`, mod.__dump()[0][rowKey] === value,
    JSON.stringify(mod.__dump()[0][rowKey]))
}
check('白名单共 13 列（12 + snooze_until）', mod.TODO_COLUMNS.length === 13,
  `实际 ${mod.TODO_COLUMNS.length}: ${mod.TODO_COLUMNS.join(',')}`)

// ---------- 3. 白名单外键必须被丢弃 ----------
{
  seed()
  mod.vaultUpdateTodo('todo-1', { nope: 'x', id: 'hacked', createdAt: 'x' }, NOW)
  const r = mod.__dump()[0]
  check('白名单外键被丢弃（不改 id）', r.id === 'todo-1' && r.nope === undefined && r.createdAt === undefined)
}

// ---------- 4. id 不存在：返回 null 且不改文件 ----------
{
  seed()
  const before = JSON.stringify(mod.__dump())
  const out = mod.vaultUpdateTodo('not-exist', { snoozeUntil: '2026-09-12 15:00' }, NOW)
  check('id 不存在返回 null', out === null)
  check('id 不存在不改数据', JSON.stringify(mod.__dump()) === before)
}

// ---------- 5. updated_at 恒定刷新 ----------
{
  seed()
  const out = mod.vaultUpdateTodo('todo-1', { snoozeUntil: '2026-09-12 15:00' }, NOW)
  check('updated_at 被刷新', out?.updated_at === NOW, String(out?.updated_at))
}

// ---------- 汇总 ----------
const failed = checks.filter((c) => !c.pass)
console.log(`\n=== verify-snooze-persist ===`)
console.log(`源文件: ${SRC}`)
console.log(`断言: ${checks.length - failed.length} PASS / ${failed.length} FAIL（共 ${checks.length}）\n`)
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  → ' + c.detail : ''}`)
}
if (failed.length) {
  console.log(`\nFAILED: ${failed.map((c) => c.name).join(' | ')}`)
  process.exit(1)
}
console.log('\n全部通过')
