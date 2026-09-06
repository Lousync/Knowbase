// AI教学 P7（题目视图：quiz 协议出题 + QuizMode 复用 + 测验报告联动产物）源码断言。
// 用法：node tmp/smoke/ai-teaching-p7-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const SVC = rd('electron/lib/agentService.ts')
const FLD = rd('electron/lib/aiTeachingFolders.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const QM = rd('src/components/shared/QuizMode.tsx')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
console.log('AI教学 P7 源码冒烟：')

ok('AgentRunner 注入出题格式规则（aiTeaching 源专属，quiz 围栏 JSON 协议=知识库 QuizParser 可解析）',
  SVC.includes('quizRuleHint') && SVC.includes('【出题格式规则（AI教学）】') && SVC.includes('titleRuleHint + quizRuleHint'))
ok('organizeDoc 产物前缀泛化（讲义/测验，默认讲义零回归）',
  FLD.includes("prefix = '讲义'") && /base = `\$\{prefix \|\| '讲义'\}·/.test(FLD) && FLD.includes("typeof prefix === 'string' && prefix ? prefix : '讲义'"))
ok('organizeDoc prefix 三层透传（preload/types/ipc）',
  PRE.includes('aiTeachOrganizeDoc: (id: string, title: string, content: string, prefix?: string)') && TY.includes('content: string, prefix?: string') && IPC.includes('a().aiTeachOrganizeDoc(id, title, content, prefix)'))
ok('QuizMode 新增可选 onFinish 成绩回调（每轮一次、再来一遍可再触发；向后兼容）',
  QM.includes('onFinish?: (summary') && QM.includes('reportedRef') && QM.includes('} else if (!finished) {'))

ok('模块题目收集：assistant 消息 flatMap extractQuizzes（对话回答实时收录）',
  MOD.includes('extractQuizzes(m.content)') && MOD.includes("m.role === 'assistant'"))
ok('中栏四态渲染优先级：文档 > 逐页阅读 > 题目 > 对话（§3.9 三视图链）',
  MOD.includes(") : !reader && midView === 'quiz' ? (") && MOD.includes(') : !reader ? ('))
ok('「对话 ⇄ 题目」分段切换器（3-9 拍板形态=顶部切换器）+ 题数徽标',
  MOD.includes('💬 对话') && MOD.includes('📝 题目') && MOD.includes('midChips'))
ok('题目视图：开始答题按钮 + 题目卡片列表 + 空态快捷出题（sendQuick 走对话链路）',
  MOD.includes('开始答题（{quizItems.length} 题）') && MOD.includes('sendQuick(t)') && MOD.includes('void sendText(text, cid)'))
ok('答题复用知识库 QuizMode（不造轮子），pageId 用 aiTeach: 命名空间防与知识页撞号',
  MOD.includes('<QuizMode') && MOD.includes("from '../../components/shared/QuizMode'") && MOD.includes('pageId={`aiTeach:${activeId}`}'))
ok('测验结果联动产物：成绩+逐题表+错题解析 → aiTeachOrganizeDoc(…, 「测验」前缀) 落会话文件夹',
  MOD.includes('随堂测验报告') && MOD.includes("'测验')") && MOD.includes('## 错题解析'))
ok('最近测验报告 chip（🧾 成绩 · 报告 →）跳中栏阅读（方案 B 复用）',
  MOD.includes('lastQuizReport') && MOD.includes('void openDocView(lastQuizReport.rel)'))
ok('切会话/新建/切工作区重置题目态（midView/quizOpen/report）',
  (MOD.match(/setMidView\('chat'\); setQuizOpen\(false\); setLastQuizReport\(null\)/g) ?? []).length >= 3)

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
