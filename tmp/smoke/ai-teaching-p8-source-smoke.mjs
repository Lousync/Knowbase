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

ok('三层结构（第三轮「C 移入仓库」拍板）：全局/工作区/会话 = 三份仓库内 PROFILE.md（userData 仅作一次性迁移源）',
  PF.includes('migrateLegacyGlobalProfile') && PF.includes('rootDirName(getSetting)') &&
  PF.includes('ensureGlobalProfile') && PF.includes('ensureWorkspaceProfile') && PF.includes('ensureSessionProfile'))
ok('画像骨架含 3-36 建议字段（当前水平/薄弱点/学习进度/学习目标/偏好；全局=身份/基础/偏好）',
  ['当前水平', '薄弱点', '学习进度', '学习目标', '偏好'].every(k => PF.includes(k)) && ['身份与背景', '已知基础', '通用学习偏好'].every(k => PF.includes(k)))
ok('读返回 text+relPath+skeleton（未生成不落盘，弹层可载骨架）',
  PF.includes('skeleton: GLOBAL_PROFILE_SKELETON') && PF.includes('skeleton: SESSION_PROFILE_SKELETON'))
ok('注入规则（§3.14 + UI 优化条目8.2.2）：全局/工作区/会话三层合并一段、各 2000 截断、皆空零注入；写后广播树刷新',
  PF.includes('resolveProfilesForInjection') && PF.includes('readWorkspaceProfile') && PF.includes("cut(wt, 2000)") &&
  PF.includes("if (!gt && !wt && !st) return ''") && PF.includes("'aiTeach:tree-refresh'"))
ok('三层语义＝细颗粒覆盖粗颗粒（用户口径：全局→工作区→会话，会话 > 工作区 > 全局）',
  PF.includes('以更细颗粒层为准') && PF.includes('（会话 > 工作区 > 全局）') && PF.includes('■ 工作区画像（本课程目标/进度/薄弱点，覆盖全局）'))
ok('Plan B 协议（3-33）：AI 只出 ```profile 建议块、明示不得直接写文件（层级由用户选择）',
  PF.includes('```profile 围栏代码块') && PF.includes('用户选择写入层级后才会落文件') && PF.includes('不要直接修改画像文件'))
ok('9 通道注册（原 6 read/write + 第三轮 3 ensure）+ preload/types/ipc 全链路',
  PF.includes("ipcMain.handle('aiTeachProfile:ensureGlobal'") && MAIN.includes('registerAiTeachingProfileHandlers') &&
  ['aiTeachProfileReadGlobal', 'aiTeachProfileWriteGlobal', 'aiTeachProfileReadWorkspace', 'aiTeachProfileWriteWorkspace', 'aiTeachProfileReadSession', 'aiTeachProfileWriteSession',
   'aiTeachProfileEnsureGlobal', 'aiTeachProfileEnsureWorkspace', 'aiTeachProfileEnsureSession'].every(k => PRE.includes(k) && TY.includes(k) && IPC.includes(k)))
ok('AgentRunner 注入链：instHint(约束) 后接 profileHint（aiTeaching 源专属）',
  SVC.includes('resolveProfilesForInjection(sessionId, getSettingReader())') && SVC.includes('instHint + profileHint + titleRuleHint'))
ok('PROFILE.md 不计入工作区产物数（与 CONSTRAINTS/SOURCE 同列基础设施文件）',
  WS.includes("e.name !== 'PROFILE.md'"))

ok('诊断问答模板（3-34）：入 TEMPLATES，开场要求一次列 3~5 题、答完出 ```profile 初稿且先不写文件',
  MOD.includes("id: 'profile-diagnose'") && MOD.includes('```profile 围栏代码块') && MOD.includes('先不要直接写文件'))
ok('三层入口（R27 条目13.2 分层重构）：全局=选择页画像卡片、工作区=卡片 hover「画像」、顶栏 chip 只开本主题层（带建议红点、无截断）',
  MOD.includes('学习者画像 · 三层') && MOD.includes("openProfile('global')") && MOD.includes("openProfile('workspace', w.id)") &&
  MOD.includes("if (activeId) void openProfile('session'); else showToast") && !MOD.includes('max-w-[64px]') &&
  MOD.includes('profileSuggestion && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"'))
ok('建议解析：最新一条 assistant 回答的 ```profile 围栏；渲染层剥离协议围栏不直显（R27：ask/plan 一并剥离）',
  MOD.includes('/```profile[^\\n]*\\n([\\s\\S]*?)```/.exec(m.content)') &&
  MOD.includes("m.content.replace(/```(profile|plan|ask)[^\\n]*\\n[\\s\\S]*?```/g, '')"))
ok('建议卡片三层落点（条目8.2.2）：接受（本主题）/接受（工作区）/接受（全局）/忽略/预览，位置在输入框上方',
  ["acceptProfileSuggestion('session')", "acceptProfileSuggestion('workspace')", "acceptProfileSuggestion('global')"].every(k => MOD.includes(k)) &&
  MOD.includes('setProfDismissed(true)') && MOD.includes('选择写入层级'))
ok('接受写入后明示下轮生效 + 新回答到达自动重新展示卡片',
  MOD.includes('下轮生效') && MOD.includes('useEffect(() => { setProfDismissed(false) }, [messages])'))
ok('画像编辑 = 跳编辑区（第三轮拍板）：弹层/textarea/saveProfile/「诊断问答生成」按钮全部移除；openProfile 走 ensure → kb-open-in-editor from:aiTeaching（编辑器「← 返回」回跳）',
  !MOD.includes('profileModal') && !MOD.includes('saveProfile') && !MOD.includes('诊断问答生成') &&
  MOD.includes('aiTeachProfileEnsureGlobal') && MOD.includes('aiTeachProfileEnsureWorkspace') && MOD.includes('aiTeachProfileEnsureSession') &&
  MOD.includes("detail: { relPath: r.relPath, from: 'aiTeaching' }"))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
