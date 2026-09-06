// AI教学 P8（用户画像：两层 PROFILE.md/注入/Plan B 建议/诊断问答）源码断言。
// 用法：node tmp/smoke/ai-teaching-p8-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const PF = rd('electron/lib/aiTeachingProfile.ts')
const SVC = rd('electron/lib/agentService.ts')
const WS = rd('electron/lib/aiTeachingWorkspaces.ts')
const MAIN = rd('electron/main/index.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
console.log('AI教学 P8 用户画像源码冒烟：')

ok('两层结构（3-32）：全局=userData/AI教学/PROFILE.md（3-37 按建议）+ 会话夹 PROFILE.md',
  PF.includes("app.getPath('userData')") && PF.includes("PROFILE_FILE = 'PROFILE.md'") && PF.includes('join(vault.rootPath, ensured.relPath, PROFILE_FILE)'))
ok('画像骨架含 3-36 建议字段（当前水平/薄弱点/学习进度/学习目标/偏好；全局=身份/基础/偏好）',
  ['当前水平', '薄弱点', '学习进度', '学习目标', '偏好'].every(k => PF.includes(k)) && ['身份与背景', '已知基础', '通用学习偏好'].every(k => PF.includes(k)))
ok('读返回 text+relPath+skeleton（未生成不落盘，弹层可载骨架）',
  PF.includes('skeleton: GLOBAL_PROFILE_SKELETON') && PF.includes('skeleton: SESSION_PROFILE_SKELETON'))
ok('注入规则（§3.14）：全局+会话两层合并一段、各 2000 截断、皆空零注入；写后广播树刷新',
  PF.includes('resolveProfilesForInjection') && PF.includes("cut(gt, 2000)") && PF.includes('if (!gt && !st) return \'\'') && PF.includes("'aiTeach:tree-refresh'"))
ok('Plan B 协议（3-33）：AI 只出 ```profile 建议块、明示不得直接写文件',
  PF.includes('```profile 围栏代码块') && PF.includes('用户接受后才会写入') && PF.includes('不要直接修改画像文件'))
ok('4 通道注册 + 三层接线',
  MAIN.includes('registerAiTeachingProfileHandlers') &&
  ['aiTeachProfileReadGlobal', 'aiTeachProfileWriteGlobal', 'aiTeachProfileReadSession', 'aiTeachProfileWriteSession'].every(k => PRE.includes(k) && TY.includes(k) && IPC.includes(k)))
ok('AgentRunner 注入链：instHint(约束) 后接 profileHint（aiTeaching 源专属）',
  SVC.includes('resolveProfilesForInjection(sessionId, getSettingReader())') && SVC.includes('instHint + profileHint + titleRuleHint'))
ok('PROFILE.md 不计入工作区产物数（与 CONSTRAINTS/SOURCE 同列基础设施文件）',
  WS.includes("e.name !== 'PROFILE.md'"))

ok('诊断问答模板（3-34）：入 TEMPLATES，开场要求一次列 3~5 题、答完出 ```profile 初稿且先不写文件',
  MOD.includes("id: 'profile-diagnose'") && MOD.includes('```profile 围栏代码块') && MOD.includes('先不要直接写文件'))
ok('双入口（3-35）：选择页「全局画像」chip + 顶栏「画像」chip（带建议红点）',
  MOD.includes('openProfile(\'global\')') && MOD.includes('openProfile(\'session\')') && MOD.includes('profileSuggestion && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />'))
ok('建议解析：最新一条 assistant 回答的 ```profile 围栏；渲染层剥离该围栏不直显',
  MOD.includes('/```profile[^\\n]*\\n([\\s\\S]*?)```/.exec(m.content)') && MOD.includes("m.content.replace(/```profile[^\\n]*\\n[\\s\\S]*?```/g, '')"))
ok('建议卡片：接受（本主题）/接受（全局）/忽略/预览 四动作，位置在输入框上方',
  MOD.includes("acceptProfileSuggestion('session')") && MOD.includes("acceptProfileSuggestion('global')") && MOD.includes('setProfDismissed(true)') && MOD.includes('AI 提议更新学习者画像'))
ok('接受写入后明示下轮生效 + 新回答到达自动重新展示卡片',
  MOD.includes('下轮生效') && MOD.includes('useEffect(() => { setProfDismissed(false) }, [messages])'))
ok('画像弹层：层标题/路径展示/textarea 直编/载入骨架/诊断问答按钮/保存',
  MOD.includes('全局学习者画像') && MOD.includes('本主题画像（对话级）') && MOD.includes('载入骨架') && MOD.includes('🩺 诊断问答生成') && MOD.includes('void saveProfile()'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
