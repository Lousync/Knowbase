// AI 面板体验增强（过程实时展示 + 改动清单）源码断言。
// 用法：node tmp/smoke/agent-progress-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const AG = fs.readFileSync(path.join(ROOT, 'electron/lib/agentService.ts'), 'utf-8')
const PR = fs.readFileSync(path.join(ROOT, 'electron/preload/index.ts'), 'utf-8')
const TY = fs.readFileSync(path.join(ROOT, 'src/types/index.ts'), 'utf-8')
const IC = fs.readFileSync(path.join(ROOT, 'src/lib/ipc.ts'), 'utf-8')
const PN = fs.readFileSync(path.join(ROOT, 'src/components/shared/AssistantPanel/index.tsx'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('主进程：步骤实时推送 + 改动收集')
ok('stepEmitters WeakMap（signal→emit，随 withAbort 生命周期）',
  AG.includes('const stepEmitters = new WeakMap') && AG.includes('stepEmitters.delete(ctrl.signal)'))
ok('agent:step 事件仅发发起窗口（withAbort 注入 sender）',
  AG.includes("sender.send('agent:step'") && AG.includes('sender: Electron.WebContents'))
ok('llm/tool 步骤均实时 emit',
  AG.includes('stepEmitters.get(signal)?.(llmStep)') && AG.includes('stepEmitters.get(signal)?.(toolStep)'))
ok('写改动收集（CHANGE_LABELS 覆盖 vault/knowledge/blog/schedule/checkin 写工具）',
  AG.includes("'builtin.vault.edit': '修改文件'") && AG.includes("'builtin.checkin.check-habit': '习惯打卡'"))
ok('完成时 reply 自动附「本次改动」清单（落库持久化）+ 结构化 changes 返回',
  AG.includes("reply = r.content + changesText") && AG.includes("return { ok: true, sessionId, reply, changes, trace }"))

console.log('桥接层：preload/types/ipc')
ok('preload onAgentStep 桥（agent:step 订阅 + 退订）',
  PR.includes('onAgentStep:') && PR.includes("ipcRenderer.on('agent:step'"))
ok('ElectronAPI.onAgentStep 类型 + AgentChange/AgentChatResult.changes',
  TY.includes('onAgentStep:') && TY.includes('interface AgentChange') && TY.includes('changes?: AgentChange[]'))
ok('ipc.ts onAgentStep 封装',
  IC.includes('export const onAgentStep'))

console.log('前端面板：实时状态行 + 改动卡片')
ok('订阅 onAgentStep（chatIdRef 过滤）',
  PN.includes('return onAgentStep(') && PN.includes("chatId !== chatIdRef.current"))
ok('AgentLiveSteps 实时组件（思考中/正在调用 N 次/失败调整）',
  PN.includes('function AgentLiveSteps') && PN.includes('正在调用') && PN.includes('失败，正在调整策略'))
ok('改动卡片 lastChanges（header 计数 + 列表 + 关闭）',
  PN.includes('本次已改动') && PN.includes('setLastChanges(null)'))
ok('send/regenerate/edit 发送前清状态、成功后注入 changes',
  PN.includes('setLiveSteps([])') && PN.includes('setLastChanges(r.changes'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
