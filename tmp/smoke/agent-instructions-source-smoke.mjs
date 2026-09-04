// 会话级全局要求（session instructions）源码断言。
// 用法：node tmp/smoke/agent-instructions-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MIG = fs.readFileSync(path.join(ROOT, 'electron/database/migrations/056_agent_session_instructions.ts'), 'utf-8')
const MIDX = fs.readFileSync(path.join(ROOT, 'electron/database/migrations/index.ts'), 'utf-8')
const REPO = fs.readFileSync(path.join(ROOT, 'electron/lib/agentSessionRepo.ts'), 'utf-8')
const AG = fs.readFileSync(path.join(ROOT, 'electron/lib/agentService.ts'), 'utf-8')
const PR = fs.readFileSync(path.join(ROOT, 'electron/preload/index.ts'), 'utf-8')
const TY = fs.readFileSync(path.join(ROOT, 'src/types/index.ts'), 'utf-8')
const IM = fs.readFileSync(path.join(ROOT, 'src/modules/immersive/index.tsx'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('会话要求：存储')
ok('迁移 056 幂等加列 instructions（pragma 探测）且已注册',
  MIG.includes("ADD COLUMN instructions TEXT NOT NULL DEFAULT ''") && MIG.includes('PRAGMA table_info') && MIDX.includes('m056AgentSessionInstructionsMigration'))
ok('repo：Row.instructions + updateAgentSessionInstructions（≤800 截断）+ getAgentSession',
  REPO.includes('instructions?: string') && REPO.includes('.slice(0, 800)') && REPO.includes('export function getAgentSession'))

console.log('会话要求：主进程注入与 IPC')
ok('runAgentLoop system 注入「本会话全局要求」（最前顺位）',
  AG.includes('【本会话全局要求】') && AG.includes('getAgentSession(sessionId)?.instructions'))
ok('agent:setSessionInstructions handler（校验 id/类型）',
  AG.includes("ipcMain.handle('agent:setSessionInstructions'"))

console.log('会话要求：桥接')
ok('preload agentSetSessionInstructions + ElectronAPI + ipc.ts 封装',
  PR.includes('agentSetSessionInstructions') && TY.includes('agentSetSessionInstructions: (id: string, instructions: string)') && TY.includes('instructions?: string'))

console.log('会话要求：沉浸 UI')
ok('顶栏「会话要求」按钮 + 编辑 popover（textarea ≤800 / 保存 / 清除）',
  IM.includes('本会话要求') && IM.includes('maxLength={800}') && IM.includes('void saveInstr()'))
ok('saveInstr 保存并同步列表/提示（toast 反馈，空=清除）',
  IM.includes('已设置本会话要求') && IM.includes('已清除本会话要求'))
ok('提示条常驻顶部 + 会话切换同步（openSession/refreshSessions/newTask 带 instructions）',
  IM.includes('本会话要求：') && IM.includes('setActiveInstr(first.instructions ?? \'\')') && IM.includes('setActiveInstr(row?.instructions'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
