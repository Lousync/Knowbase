// 「AI教学」模块（原沉浸式 Agent）M0 源码断言：Tab 接入 + 核心闭环 + 占位标注。
// P0 更新：id immersive → aiTeaching，目录 src/modules/ai-teaching/，label「AI教学」。
// 用法：node tmp/smoke/ai-teaching-m0-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IM = fs.readFileSync(path.join(ROOT, 'src/modules/ai-teaching/index.tsx'), 'utf-8')
const APP = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8')
const BAR = fs.readFileSync(path.join(ROOT, 'src/components/shared/ActivityBar.tsx'), 'utf-8')
const TY = fs.readFileSync(path.join(ROOT, 'src/types/index.ts'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('AI教学 断言：Tab 注册（P0 命名迁移）')
ok('TabName 含 aiTeaching（旧 immersive 已移除）',
  TY.includes("| 'editor' | 'aiTeaching'") && !TY.includes("'immersive'"))
ok('ActivityBar 注册 AI教学 入口（Sparkles 图标）',
  BAR.includes("id: 'aiTeaching'") && BAR.includes('label: \'AI教学\''))
ok('ActivityBar 旧 id 一次性迁移（order + hidden：immersive → aiTeaching）',
  BAR.includes("x === 'immersive' ? 'aiTeaching' : x") && BAR.includes("update('activityBarHidden'"))
ok('App.tsx import + case 渲染 AiTeachingModule',
  APP.includes("import { AiTeachingModule } from './modules/ai-teaching'") && APP.includes("case 'aiTeaching': return <AiTeachingModule isActive={on}"))
ok('命令面板含「打开 AI教学」',
  APP.includes("label: '打开 AI教学'"))

console.log('AI教学 断言：模块核心闭环')
ok('三场景模板（教学/研读/复盘）各带目标/步骤/开场指令',
  IM.includes("id: 'teach'") && IM.includes("id: 'research'") && IM.includes("id: 'review'") &&
  IM.includes('opening:') && IM.includes('steps:'))
ok('会话：列表/新建任务/删除/切换（复用 AgentRunner 会话库）',
  IM.includes('agentSessions()') && IM.includes('agentNewSession') && IM.includes('agentDeleteSession'))
ok('真实对话闭环：发送→agentChat(带 aiTeaching 来源)→refreshMessages',
  IM.includes("agentChat(sid, raw, undefined, cid, 'aiTeaching',") && IM.includes('await refreshMessages(sid)'))
ok('实时步骤（onAgentStep 按 chatId 过滤）+ 停止',
  IM.includes('return onAgentStep(') && IM.includes('chatId !== chatIdRef.current') && IM.includes('agentAbort'))
ok('改动清单 → 点击跳编辑器（kb-open-in-editor + c.file）',
  IM.includes("new CustomEvent('kb-open-in-editor'") && IM.includes('c.file'))
ok('工具名中文映射 + 调用轨迹折叠（details）',
  IM.includes("'builtin.vault.read': '读笔记文件'") && IM.includes('<details') && IM.includes('调用轨迹'))
ok('P3a/P3b 视图改版：文档视图/切换退役 → 恒对话流 + 快速定位条（文档地图后续退役由逐条整理承接）',
  !IM.includes("['timeline', 'doc']") && IM.includes('anchors') && IM.includes('msgAnchorTitle') && IM.includes('jumpToAnchor') && IM.includes('scrollRef'))
ok('占位区清零（P0→P8 全部落地，头注释含 P8 画像说明）',
  !IM.includes('占位（') && IM.includes('P8 用户画像（§3.14）'))

console.log('AI教学 Token 面板断言')
ok('Token 面板：收起 chip（Gauge ≈ tokens）+ 展开明细',
  IM.includes('<Gauge size={12} />') && IM.includes('tokenOpen') && IM.includes('fmtTok(tokenStats.llmTokens)'))
ok('统计：从轨迹聚合 tokens/轮次/工具/耗时（llm steps tokens + tool 步）',
  IM.includes('s.kind === \'llm\'') && IM.includes('llmTokens += s.tokens') && IM.includes('tokenStats = useMemo'))
ok('月度：llmGetUsage(monthTokens/budget) + 预算进度条（超 85% 转红）',
  IM.includes('llmGetUsage()') && IM.includes('monthTokens / budget > 0.85'))
ok('模型名（defaultChatModel 设置）',
  IM.includes("getSettingRaw('defaultChatModel')"))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
