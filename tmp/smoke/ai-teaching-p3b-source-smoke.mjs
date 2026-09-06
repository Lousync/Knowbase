// AI教学 P3b（整理成文档 + 输入区停止键/模型/思考强度）源码断言。
// 用法：node tmp/smoke/ai-teaching-p3b-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const FLD = rd('electron/lib/aiTeachingFolders.ts')
const SVC = rd('electron/lib/agentService.ts')
const LLM = rd('electron/lib/llmService.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('P3b 断言：整理成文档（主进程）')
ok('organizeDoc 懒建文件夹 + 讲义·标题.md 落盘', FLD.includes('organizeDoc') && FLD.includes('ensureSessionFolder(sessionId, getSetting)') && FLD.includes('`讲义·${sanitizeTitle(title)}`'))
ok('幂等：同名同内容返回既有路径；不同内容 (n) 后缀不覆盖', FLD.includes('if (readFileSync(abs, \'utf-8\') === body) return') && FLD.includes(' (${n}).md'))
ok('organizeDoc 通道注册', FLD.includes("'aiTeach:organizeDoc'"))

console.log('P3b 断言：模型覆盖 + 思考强度（主进程）')
ok('AgentChatRequest 带 modelId/effort', SVC.includes("modelId?: string") && SVC.includes("'off' | 'low' | 'medium' | 'high'"))
ok('runAgentLoop 解析 pid:mid 并透传 invokeLlmInternal', SVC.includes("llmOpts.modelId.indexOf(':')") && SVC.includes('providerId, modelId: modelOverride, effort: llmOpts?.effort'))
ok('llmService effort 守卫：仅推理型模型发 reasoning_effort', LLM.includes('REASONING_MODEL_RE') && LLM.includes('body.reasoning_effort = req.effort') && LLM.includes("req.effort !== 'off'"))
ok('能力探测通道 llm:reasoningCapable', LLM.includes("'llm:reasoningCapable'"))

console.log('P3b 断言：三层接线')
ok('preload organizeDoc + reasoningCapable + agentChat 加宽', PRE.includes('aiTeachOrganizeDoc') && PRE.includes('llmReasoningCapable') && PRE.includes('modelId?: string; effort?: string'))
ok('ElectronAPI 类型', TY.includes('aiTeachOrganizeDoc') && TY.includes('llmReasoningCapable') && TY.includes("effort?: 'off' | 'low' | 'medium' | 'high'"))
ok('ipc.ts 包装', IPC.includes('aiTeachOrganizeDoc') && IPC.includes('llmReasoningCapable'))

console.log('P3b 断言：模块 UI')
ok('逐条整理成文档按钮 + 幂等「已生成文档 →」跳转', MOD.includes('整理成文档') && MOD.includes('✓ 已生成文档 →') && MOD.includes('aiTeachOrganizeDoc(sid, title, content)'))
ok('复制按钮（clipboard）', MOD.includes('navigator.clipboard.writeText(m.content)'))
ok('顶栏文档地图退役（§3.8 连锁：顶栏收敛）', !MOD.includes('<span>文档地图</span>') && !MOD.includes('mapOpen'))
ok('发送键 ⇄ 停止键（R12：深色底 + 白方块）', MOD.includes('{pending ? (') && MOD.includes('w-2 h-2 rounded-[2px] bg-current') && MOD.includes('agentAbort(chatIdRef.current)'))
ok('模型+思考强度合一菜单（R14）：模型分区 + 强度分区 + 不支持置灰', MOD.includes('模型 · 仅本对话生效') && MOD.includes('思考强度') && MOD.includes('opacity-40 pointer-events-none') && MOD.includes('当前模型不支持'))
ok('chip 显示 模型·🧠档位（R14）', MOD.includes("· 🧠{EFFORT_LABEL[convoEffort]}"))
ok('仅本对话生效：convoLlm Map 按会话存覆盖 + 切会话同步', MOD.includes('convoLlm.current.set(sid') && MOD.includes('convoLlm.current.get(activeId)'))
ok('发送透传覆盖 modelId/effort', MOD.includes('agentChat(sid, raw, undefined, cid, \'aiTeaching\', ov?.modelId, ov?.effort)'))
ok('换不支持模型强度自动回落 off', MOD.includes('if (!modelCapable && convoEffort !== \'off\')'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
