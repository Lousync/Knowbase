// UI 更新优化文档（docs/ui-updates.md）R27 批次源码断言：条目1.7 / 11 / 12 / 13。
// 用法：node tmp/smoke/ui-updates-r27-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const APP = rd('src/App.tsx')
const TB = rd('src/components/shared/TitleBar.tsx')
const WRH = rd('src/components/shared/WindowResizeHandles.tsx')
const MAIN = rd('electron/main/index.ts')
const PRE = rd('electron/preload/index.ts')
const IPC = rd('src/lib/ipc.ts')
const TY = rd('src/types/index.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')
const SVC = rd('electron/lib/agentService.ts')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
const rep = (label) => console.log(`\n${label}`)

// ---------- 条目1.7：最大化边缘拖拽恢复（Edge 式 v2） ----------
rep('条目1.7 最大化边缘拖拽恢复')
ok('主进程注册 window:edgeResizeStart / edgeResizeEnd（edge 白名单含四边四角与 move）',
  MAIN.includes("ipcMain.handle('window:edgeResizeStart'") && MAIN.includes("ipcMain.handle('window:edgeResizeEnd'") &&
  /top-left\|top-right\|bottom-left\|bottom-right\|move/.test(MAIN))
ok('主进程恢复几何锚定 preMaxBounds + min clamp 900×600 + 光标轮询 16ms setBounds',
  MAIN.includes('edgeRestoreRef') && MAIN.includes('preMaxBounds') &&
  MAIN.includes('MINW = 900') && MAIN.includes('MINH = 600') && MAIN.includes('setInterval') && MAIN.includes('getCursorScreenPoint()'))
ok('真最大化先 unmaximize；拖拽收尾双兜底（closed / blur 停轮询）',
  MAIN.includes('if (win.isMaximized()) win.unmaximize()') &&
  MAIN.includes("mainWindow?.on('closed', stopEdgeDrag)") && MAIN.includes("mainWindow?.on('blur', stopEdgeDrag)"))
ok('move 模式：比例映射水平定位 + 标题栏贴光标（顶栏拖拽恢复，Chrome 同款）',
  MAIN.includes("edge === 'move'") && MAIN.includes('relX') && MAIN.includes('p0.y - 18'))
ok('preload + 渲染层类型 + ipc 封装三处接线',
  PRE.includes("edgeResizeStart: (edge: string) => ipcRenderer.invoke('window:edgeResizeStart', edge)") &&
  PRE.includes('edgeResizeEnd: () => ipcRenderer.invoke(\'window:edgeResizeEnd\')') &&
  TY.includes('edgeResizeStart: (edge: string) => Promise<{ ok: boolean }>') &&
  IPC.includes('export const edgeResizeStart') && IPC.includes('export const edgeResizeEnd'))
ok('渲染层热区组件：四边 6px + 四角 12px、fixed/z-80/no-drag、mouseup 统一收尾',
  ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].every(e => WRH.includes(`id: '${e}'`)) &&
  WRH.includes("zIndex: 80") && WRH.includes('no-drag') && WRH.includes("addEventListener('mouseup'") &&
  WRH.includes('ns-resize') && WRH.includes('nwse-resize'))
ok('App 仅 winMax 挂载热区（禅全屏 fsHint 下 winMax=false 自动卸载）',
  APP.includes('{winMax && <WindowResizeHandles />}') && APP.includes("from './components/shared/WindowResizeHandles'"))
ok('TitleBar 最大化态 overlay：no-drag 接管空白区（控件 z-10 保持可点）+ 双击 toggle + move 拖拽',
  TB.includes('onMaxTitleDown') && TB.includes('isMaximized && (') && TB.includes("edgeResizeStart('move')") &&
  TB.includes('onDoubleClick={() => window.api?.maximize()}') && TB.includes('relative z-10 flex items-center h-full pl-3'))

// ---------- 条目11：任务规划激活（A+B） ----------
rep('条目11 任务规划激活')
ok('主进程 plan 协议规则注入（aiTeaching 限定）并计入 ruleChars',
  SVC.includes('【任务规划协议（AI教学）】') && SVC.includes('```plan 围栏代码块') &&
  SVC.includes('planRuleHint.length + askRuleHint.length') &&
  SVC.includes('baseSystem + instHint + profileHint + titleRuleHint + quizRuleHint + planRuleHint + askRuleHint'))
ok('渲染层解析最新 plan 围栏（JSON 数组 + status 归一 done|current|todo，坏块回落模板播种）',
  MOD.includes('/```plan[^\\n]*\\n([\\s\\S]*?)```/') && MOD.includes("'done' as const") &&
  MOD.includes("template.steps.map(st => ({ step: st, status: 'todo' as const }))"))
ok('侧栏活进度列表：✓ 划线 / ● accent 加粗 / ○ 序号灰 + 数据徽标 + 当前步脉冲',
  MOD.includes("st.status === 'done' ? 'text-[var(--text-muted)] line-through'") &&
  MOD.includes("st.status === 'current' ? 'text-[var(--accent)] font-medium'") &&
  MOD.includes('animate-pulse') && MOD.includes('planBadge(st.step)'))
ok('点击步骤 = 跳步遥控（当前步讲解 / 其余跳到第 N 步），goal 段落折叠为 ⓘ tooltip',
  MOD.includes('jumpPlanStep') && MOD.includes('请讲解任务规划当前步骤') &&
  MOD.includes(`title={template.goal}`))
ok('B 徽标口径：测验=题目数、资料=素材条数、产物=会话文件夹 md 数（排除 SOURCE/CONSTRAINTS）',
  MOD.includes('quizItems.length > 0 ? `${quizItems.length} 题`') &&
  MOD.includes('srcEntries.length > 0 ? `${srcEntries.length} 条素材`') &&
  MOD.includes('prodCount > 0 ? `${prodCount} 份产物`') &&
  MOD.includes('!/^(SOURCE|CONSTRAINTS)\\.md$/i.test(String(e.name))'))

// ---------- 条目12/13：ask 提问模式 + 整卷 + 分层入口 ----------
rep('条目12/13 提问模式 × 诊断整卷 × 画像分层入口')
ok('主进程 ask 协议规则注入（单题对象 + 整卷数组 + 与 quiz 不得混用）',
  SVC.includes('【提问模式协议（AI教学）】') && SVC.includes('```ask 围栏代码块') &&
  SVC.includes('JSON 数组') && SVC.includes('两者不得混用'))
ok('渲染层 ask 解析：对象=单题卡 / 数组=整卷（parseAskBlock 容错：选项 2~6、坏块 null）',
  MOD.includes('function parseAskBlock') && MOD.includes("kind: 'exam'") && MOD.includes("kind: 'single'") &&
  MOD.includes('.slice(0, 6)') && MOD.includes('options.length >= 2'))
ok('只挂最新一条 assistant 回答的未答 ask（其后出现用户消息即已答；ask/plan/profile 块不上屏）',
  MOD.includes('if (m.role === \'user\') return null') &&
  MOD.includes('/```(profile|plan|ask)[^\\n]*\\n[\\s\\S]*?```/g'))
ok('输入区变形 v2（WorkBuddy 式）：序号横条选项 + ‹k/n› 翻页 + 单题点选即发 + 整卷全部选完 ↑ 统一发送 + 其他补充输入',
  MOD.includes('sendAskAnswer(o)') && MOD.includes('submitAskExam') &&
  MOD.includes('setAskPage(p => Math.max(0, p - 1))') && MOD.includes('【整卷回答】') && MOD.includes('其他补充…'))
ok('「自由输入」随时退回打字（✕ 关闭 askDismissed 按 ask id；Esc 链优先关提问卡）',
  MOD.includes('setAskDismissed(askPending.id)') &&
  MOD.includes('if (askVisible && askPending) { setAskDismissed(askPending.id); return }'))
ok('诊断模板改 ask 整卷开场（3~5 题、统一发回、初稿走 profile 围栏待确认）',
  MOD.includes('请以 ```ask 整卷模式做入学诊断') && MOD.includes('用户会整卷点选、答完后统一发回'))
ok('分层入口重构 + 第三轮跳编辑区：顶栏 chip 只开本主题层（无对话给引导 toast）；画像编辑不再走弹层，openProfile 统一 ensure→跳编辑区',
  MOD.includes("if (activeId) void openProfile('session'); else showToast") &&
  !MOD.includes("['global', '全局'], ['workspace', '工作区'], ['session', '本主题']") &&
  MOD.includes('本主题画像随对话存放：先选择或新建一个对话') &&
  !MOD.includes('profileModal') && MOD.includes("detail: { relPath: r.relPath, from: 'aiTeaching' }"))
ok('选择页双入口保持（全局=画像卡片按钮、工作区=卡片 hover「画像」）；三层注入与建议卡落点不动',
  MOD.includes("void openProfile('global')") && MOD.includes("void openProfile('workspace', w.id)") &&
  MOD.includes("acceptProfileSuggestion('session')") && MOD.includes("acceptProfileSuggestion('workspace')") &&
  MOD.includes("acceptProfileSuggestion('global')"))

console.log(`\n===== R27 源码断言：${passed} passed, ${failed} failed =====`)
process.exit(failed > 0 ? 1 : 0)
