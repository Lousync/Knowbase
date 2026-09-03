// 沉浸式 Agent 模式 M0 源码断言：Tab 接入 + 核心闭环 + 占位标注。
// 用法：node tmp/smoke/immersive-m0-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IM = fs.readFileSync(path.join(ROOT, 'src/modules/immersive/index.tsx'), 'utf-8')
const APP = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8')
const BAR = fs.readFileSync(path.join(ROOT, 'src/components/shared/ActivityBar.tsx'), 'utf-8')
const TY = fs.readFileSync(path.join(ROOT, 'src/types/index.ts'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('沉浸 M0 断言：Tab 注册')
ok('TabName 含 immersive',
  TY.includes("| 'editor' | 'immersive'"))
ok('ActivityBar 注册 Agent 入口（Sparkles 图标）',
  BAR.includes("id: 'immersive'") && BAR.includes('label: \'Agent\''))
ok('App.tsx import + case 渲染 ImModule',
  APP.includes("import { ImModule }") && APP.includes("case 'immersive': return <ImModule isActive={on} />"))

console.log('沉浸 M0 断言：模块核心闭环')
ok('三场景模板（教学/研读/复盘）各带目标/步骤/开场指令',
  IM.includes("id: 'teach'") && IM.includes("id: 'research'") && IM.includes("id: 'review'") &&
  IM.includes('opening:') && IM.includes('steps:'))
ok('会话：列表/新建任务/删除/切换（复用 AgentRunner 会话库）',
  IM.includes('agentSessions()') && IM.includes('agentNewSession') && IM.includes('agentDeleteSession'))
ok('真实对话闭环：发送→agentChat→refreshMessages',
  IM.includes('await agentChat(sid, raw, undefined, cid)') && IM.includes('await refreshMessages(sid)'))
ok('实时步骤（onAgentStep 按 chatId 过滤）+ 停止',
  IM.includes('return onAgentStep(') && IM.includes('chatId !== chatIdRef.current') && IM.includes('agentAbort'))
ok('改动清单 → 点击跳编辑器（kb-open-in-editor + c.file）',
  IM.includes("new CustomEvent('kb-open-in-editor'") && IM.includes('c.file'))
ok('工具名中文映射 + 调用轨迹折叠（details）',
  IM.includes("'builtin.vault.read': '读笔记文件'") && IM.includes('<details') && IM.includes('调用轨迹'))
ok('文档视图（最近一条助手回复整篇 MarkdownPreview + setView 切换）',
  IM.includes("(['timeline', 'doc'] as const)") && IM.includes('content={docMsg.content}') && IM.includes('view === \'timeline\''))
ok('素材/产物区 M1 占位说明（真实写入链路标注已就绪）',
  IM.includes('素材管理 M1 开放') && IM.includes('产物提取 M1 开放'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
