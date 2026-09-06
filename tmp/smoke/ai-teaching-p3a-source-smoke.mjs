// AI教学 P3a（去气泡 + 右缘快速定位条 + 标题规则注入）源码断言。
// 用法：node tmp/smoke/ai-teaching-p3a-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const SVC = rd('electron/lib/agentService.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')
const IPC = rd('src/lib/ipc.ts')
const TY = rd('src/types/index.ts')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('P3a 断言：标题规则注入（主进程）')
ok('AgentChatRequest 增 source 字段', SVC.includes('source?: string'))
ok('source=aiTeaching 注入回答标题规则（### 标题）', SVC.includes("source === 'aiTeaching'") && SVC.includes('### 这里写标题'))
ok('titleRuleHint 拼入 system', SVC.includes('buildSystemPrompt(context) + instHint + profileHint + titleRuleHint'))
ok('runAgentLoop 签名带 source 且三处调用透传 req.source（P3b 后追加 llmOpts 实参）',
  /runAgentLoop\([\s\S]*?trace: AgentTraceStep\[\],\s*source\?: string/.test(SVC) && (SVC.match(/req\.source/g) || []).length === 3)

console.log('P3a 断言：source 三层透传')
ok('ipc.ts agentChat 透传 source', IPC.includes('source?: string') && IPC.includes('source, modelId, effort }'))
ok('ElectronAPI 类型带 source', TY.includes('chatId?: string; source?: string'))
ok('模块 send 传 aiTeaching', MOD.includes("agentChat(sid, raw, undefined, cid, 'aiTeaching',"))

console.log('P3a 断言：中栏去气泡 + 快速定位条 + 文档地图')
ok('视图切换退役（timeline/doc state 删除）', !MOD.includes("useState<'timeline'") && !MOD.includes("'文档视图'"))
ok('中栏三态优先级链 reader/docView 接管（P4 语义：docView > reader > 对话流恒定）', MOD.includes(') : !reader ? (') && !MOD.includes(') : reader ? ('))
ok('用户消息保留气泡 + assistant 平铺', MOD.includes('bg-[var(--accent)] text-white rounded-xl') && /<MarkdownPreview content=\{m\.content\.replace\(/.test(MOD))
ok('定位条刻度 + 标题提取回退链（标题→首行→回答N）',
  MOD.includes('msgAnchorTitle') && MOD.includes('#{1,6}') && MOD.includes('`回答 ${n + 1}`'))
ok('定位条 hover 预览 title + 点击 jumpToAnchor + 当前高亮 activeAnchor',
  MOD.includes('jumpToAnchor') && MOD.includes('title={a.title}') && MOD.includes('i === activeAnchor'))
ok('scroll 容器 scrollRef + onScroll 追踪 + data-msg-idx',
  MOD.includes('scrollRef') && MOD.includes('onScroll={onConvScroll}') && MOD.includes('data-msg-idx={idx}'))
ok('产物导航（P3b 起）：文档地图按钮退役 → 逐条整理成文档 + kb-open-in-editor 跳转',
  !MOD.includes('toggleDocMap') && MOD.includes("new CustomEvent('kb-open-in-editor'") && MOD.includes('organizeDocFor'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
