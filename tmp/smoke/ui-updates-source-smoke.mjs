// UI 更新优化文档（docs/ui-updates.md）条目 1~9 源码断言（条目10 见 ai-teaching-p6-source-smoke.mjs）。
// 用法：node tmp/smoke/ui-updates-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const APP = rd('src/App.tsx')
const ACT = rd('src/components/shared/ActivityBar.tsx')
const MOD = rd('src/modules/ai-teaching/index.tsx')
const TREE = rd('src/modules/ai-teaching/AiTeachFileTree.tsx')
const ED = rd('src/modules/editor/index.tsx')
const KM = rd('src/modules/knowledge/index.tsx')
const GV = rd('src/modules/knowledge/components/graph/GraphView.tsx')
const STG = rd('src/lib/settings.ts')
const SVIEW = rd('src/modules/settings/views/AiTeachingView.tsx')
const IPC = rd('src/lib/ipc.ts')
const TY = rd('src/types/index.ts')
const SVC = rd('electron/lib/agentService.ts')
const PF = rd('electron/lib/aiTeachingProfile.ts')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
const rep = (label) => console.log(`\n${label}`)

// ---------- 条目1：窗口最大化四角填不满 ----------
rep('条目1 最大化贴边（复用 Z2 全屏化分支）')
const flushExpr = "zenLevel >= 2 || winMax"
ok('主内容卡片壳与日程面板壳均按 `zenLevel >= 2 || winMax` 去留白/圆角（≥2 处）',
  (APP.match(new RegExp(flushExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2)
ok('winMax 状态来自 onMaximizeChange 且进 winRounded 判定（根容器直角链路不变）',
  APP.includes('const [winMax, setWinMax] = useState(false)') && APP.includes('onMaximizeChange') && APP.includes('const winRounded = !winMax'))
ok('活动栏卡接收 flush 并在置真时去外边距/圆角/边框（与主内容壳同步贴边）',
  ACT.includes('flush?: boolean') && ACT.includes('flush ?') &&
  ACT.includes("flush ? 'rounded-none'") && ACT.includes('mx-1.5 my-1.5 rounded-xl') && APP.includes('flush={winMax}'))
ok('禅模式 Z2 原行为回归（表达式含 zenLevel >= 2 前项）', APP.includes(flushExpr))

// ---------- 条目2：左右侧栏换用 ResizablePanel ----------
rep('条目2 侧栏对齐全局 ResizablePanel')
ok('模块引入 ResizablePanel 并双侧使用（左 248/200/400、右 280/240/420）',
  MOD.includes("import { ResizablePanel } from '../../components/shared/ResizablePanel'") &&
  MOD.includes('side="left" storageKey="aiTeach.leftWidth" defaultWidth={248} minWidth={200} maxWidth={400}') &&
  MOD.includes('side="right" storageKey="aiTeach.rightWidth" defaultWidth={280} minWidth={240} maxWidth={420}'))
ok('旧手写折叠残留清零（无 26px 图标小栏 / 无 w-[248px] 三元）',
  !MOD.includes('w-[26px]') && !MOD.includes("leftOpen ? 'w-[248px]'"))
ok('开合仍由 leftOpen/rightOpen 驱动并接 snap 双回调（toggleSide 记忆不动）',
  MOD.includes('visible={leftOpen}') && MOD.includes('visible={rightOpen}') &&
  MOD.includes('onSnapClose={() => toggleSide(\'left\')}') && MOD.includes('onSnapOpen={() => toggleSide(\'right\')}'))

// ---------- 条目3：分区收放补过渡动画 ----------
rep('条目3 分区收放动画')
ok('grid 行高 0fr⇄1fr 过渡（展开体常挂载，两分区同机制）',
  MOD.includes('transition-[grid-template-rows] duration-200 ease-out') &&
  MOD.includes("gridTemplateRows: collapsedSec.explorer ? '0fr' : '1fr'") &&
  MOD.includes("gridTemplateRows: collapsedSec.plan ? '0fr' : '1fr'"))
ok('单一 chevron + rotate 过渡（替代瞬时双图标切换）',
  MOD.includes('transition-transform duration-200') && MOD.includes("open ? 'rotate-90' : ''"))
ok('折叠内容 visibility 兜底（不可点不可聚焦）', MOD.includes('invisible'))

// ---------- 条目4：回答操作条 + 时间 Invalid ----------
rep('条目4 操作条 chip 化与时间显示')
ok('整理成文档/复制为带图标 chip（FileOutput/Copy 12px，已生成态回显 ✓）',
  MOD.includes('<FileOutput size={12} />') && MOD.includes('<Copy size={12} />') && MOD.includes('已生成文档 →'))
ok('fmtTime 正则版：ISO 带时区先转本地分量；解析失败返回空串（不上屏 Invalid）',
  MOD.includes('function fmtTime(raw?: string | null): string') && MOD.includes('if (Number.isNaN(t)) return') && !/return\s*['"]Invalid/.test(MOD))
ok('用户消息源头改存完整 ISO（弃 nowLocal 纯时刻串）',
  MOD.includes('createdAt: new Date().toISOString()') && !MOD.includes('function nowLocal'))

// ---------- 条目5：P6 素材库遗留（旧双区块 / A1 表单） ----------
rep('条目5 素材库区块与表单挂载')
ok('旧「PPT 素材（逐页讲解）」区块与 picker 残留状态退役（sources/pickOpen/docsPickFiles 不再引用）',
  !MOD.includes('PPT 素材（逐页讲解）') && !MOD.includes('pickOpen') && !MOD.includes('docsPickFiles') && !MOD.includes('const [sources, setSources]'))
ok('静态「产物」占位区块移除（真数据在左栏资源管理器）',
  !MOD.includes('暂无产物'))
ok('素材表单上提根层（工作区视图可达）＋未选对话点击给引导 toast',
  MOD.indexOf('{srcForm && (') > MOD.indexOf('工作区选择页') &&
  MOD.includes('先选择或新建一个对话（素材随对话登记）'))
ok('条目5.3 四路同步：应用内保存广播 kb:file-saved / 程序写 aiTeach:tree-refresh / 激活 / 窗口聚焦',
  IPC.includes("new CustomEvent('kb:file-saved'") && MOD.includes("addEventListener('kb:file-saved'") &&
  MOD.includes('onAiTeachTreeRefresh(onTree)') && MOD.includes("addEventListener('focus', onFocus)") &&
  MOD.includes("if (isActive) syncSessionFiles("))
ok('条目5.3 约束侧：弹层打开且草稿未落盘时不被回读覆盖',
  MOD.includes('instrStateRef') && MOD.includes('if (!(st.open && st.draft.trim() !== text)) setInstrDraft(text)'))

// ---------- 条目6：跳转返回按钮 + 状态保留 ----------
rep('条目6 返回来源与状态保留')
ok('协议通用化：kb-open-in-editor detail 带 from，App 记 editorJumpFrom 且手动切 Tab 清除',
  APP.includes("detail?.from") && APP.includes('const [editorJumpFrom, setEditorJumpFrom]') &&
  APP.includes("setEditorJumpFrom(null) // 手动切 Tab 即清除「返回来源」上下文（条目6）"))
ok('编辑器出「← 返回 X」chip（openFrom/onBackFrom props 接线）',
  ED.includes('openFrom?: string | null') && ED.includes('←') && ED.includes('onBackFrom') &&
  APP.includes('openFrom={editorJumpFrom') && APP.includes('handleTabChange(f)'))
ok('AI教学与知识库调用点都带 from（三处以上）',
  (MOD.match(/from: 'aiTeaching'/g) || []).length >= 3 && KM.includes("from: 'knowledge'") && GV.includes("from: 'knowledge'"))
ok('根因修：保活层同一 keyed 数组渲染（可见↔隐藏换序不换槽位，不再卸载重建）',
  APP.includes('[activeTab, ...Array.from(mountedTabs.current)') && !APP.includes('{renderMounted(activeTab, true)}'))
ok('兜底：中栏导航状态按会话持久化（aiTeach.nav.{sid} 读写 + 删除会话回收）',
  MOD.includes('aiTeach.nav.${sid}') && MOD.includes('function readNav') && MOD.includes('function writeNav') &&
  MOD.includes('clearNav(sid)') && MOD.includes('const nav = readNav(sid)'))

// ---------- 条目7：树右键菜单宽度失控 ----------
rep('条目7 右键菜单宽度')
ok('菜单容器 w-max + max-w-[280px]（不再 shrink-to-fit 歧义撑满）',
  TREE.includes('w-max max-w-[280px]'))
ok('贴边钳制按菜单实际宽（max-w 290 常量兜底，长文案不再溢出屏幕）',
  TREE.includes('window.innerWidth - 290') && TREE.includes('window.innerHeight - 300'))

// ---------- 条目8：会话要求弹层 + 画像三层 ----------
rep('条目8 约束弹层与三层画像')
ok('8.1 方案 A：中型编辑弹层 560px/86vh + 模板说明折叠 + Ctrl+Enter 保存 + 阅读视图次级入口',
  MOD.includes('w-[560px] max-w-[94vw] max-h-[86vh]') && MOD.includes('怎么写？（模板与示例）') &&
  MOD.includes("e.key === 'Enter' && (e.ctrlKey || e.metaKey)") && MOD.includes('在方案 B 阅读视图中打开本文件'))
ok('8.2.1 选择页画像入口升格为显眼卡片（三层说明 + 全局/工作区两按钮）+ 顶栏 chip 去 64px 截断',
  MOD.includes('学习者画像 · 三层') && MOD.includes("openProfile('global')") && MOD.includes('全局画像') && !MOD.includes('max-w-[64px]'))
ok('8.2.2 第三层落盘 {工作区文件夹}/PROFILE.md：read/write 双通道 + 注入按 sessionId 解析工作区',
  PF.includes('export function readWorkspaceProfile') && PF.includes('export function writeWorkspaceProfile') &&
  PF.includes('workspaceFolderRel(wsId, getSetting)') && PF.includes('getWorkspaceOfSession(sessionId)') &&
  PF.includes('if (!gt && !wt && !st)') && TY.includes('aiTeachProfileReadWorkspace') && IPC.includes('aiTeachProfileWriteWorkspace'))
ok('8.2.2 画像编辑改跳编辑区 + 建议卡片三层落点（第三轮拍板：弹层/textarea 移除，openProfile=ensure→编辑器）',
  !MOD.includes("['global', '全局'], ['workspace', '工作区'], ['session', '本主题']") &&
  !MOD.includes('profileModal') && MOD.includes('aiTeachProfileEnsureGlobal') &&
  MOD.includes("acceptProfileSuggestion('workspace')") && MOD.includes('{wsActive && ('))

// ---------- 条目9：用量指示迁输入区 + 上下文圆环 ----------
rep('条目9 输入区用量指示与上下文圆环')
ok('顶栏 Token chip 退役（Gauge 图标不再引用，明细面板迁输入区）',
  !MOD.includes('Gauge') && !MOD.includes('top-full mt-1.5 w-[300px]'))
ok('UsageRing 纯 SVG 环形 + 三档着色（>85% danger / >=70% warning / 其余 accent）',
  MOD.includes('function UsageRing') && MOD.includes('var(--danger)') && MOD.includes('var(--warning)') && MOD.includes('strokeDasharray'))
ok('未设上下文窗口 → 优雅退化为紧凑数字（pct=null）',
  MOD.includes('if (pct == null)') && MOD.includes('ctxWindow > 0 ? ctxPct : null'))
ok('占用口径=最近一次调用 promptTokens（真实上下文，含注入与工具定义）',
  MOD.includes('s.promptTokens') && MOD.includes('const ctxUsed = useMemo'))
ok('hover 构成摘要 + 点击上翻详情面板（输入栏上方展开，含月度预算条迁移）',
  MOD.includes('本轮 system 注入构成') && MOD.includes('absolute bottom-full right-0 mb-1.5 w-[300px]') && MOD.includes('本月 LLM tokens'))
ok('注入分段用量由主进程随结果回传（AgentChatResult.injection，仅 aiTeaching 源）',
  SVC.includes('const injection: AiTeachInjectionStats | undefined = source === ') && SVC.includes('reply, changes, trace, injection') &&
  TY.includes('injection?: AiTeachInjectionStats') && MOD.includes('if (r?.injection) setInjectionMap'))
ok('三档设置生效：aiTeachUsageDetail(off/compact/detailed) + aiTeachCtxWindow 入设置表并渲染/读取',
  STG.includes("aiTeachUsageDetail: { default: 'compact'") && STG.includes("aiTeachCtxWindow: { default: 0") &&
  SVIEW.includes("update('aiTeachUsageDetail'") && SVIEW.includes("update('aiTeachCtxWindow'") &&
  MOD.includes("getSettingRaw('aiTeachUsageDetail')") && MOD.includes("{usageDetail !== 'off' && (") && MOD.includes("usageDetail === 'detailed'"))

// ---------- 条目10.3：源码素材使用说明 ----------
rep('条目10.3 用户帮助文档')
ok('帮助文档收录「AI 教学 · 素材与代码」（三种登记方式 / 行号区间 / 大文件建议 / 代码闭环）',
  fs.existsSync(path.join(ROOT, 'src/modules/help/docs/AI 教学素材与代码.md')) &&
  rd('src/modules/help/docs/AI 教学素材与代码.md').includes('大文件请标行号区间'))

// ---------- R26 真机验证补口 ----------
rep('真机验证补口')
ok('条目1 补口：透明无边框窗口 maximize() 后 OS 不置 isMaximized / 不发 maximize 事件 → 主进程按几何判定覆盖工作区并广播 window:maximizeChange',
  (() => { const M = rd('electron/main/index.ts'); return M.includes('function coversWorkArea') && M.includes('function isWinMaximized') && M.includes("webContents.send('window:maximizeChange'") && M.includes("mainWindow?.on('resize', () => syncMaxState())") })())
ok('条目8 补口：Esc 在非禅模式下也优先关闭本模块浮层（提问卡/素材表单/工作区弹层/会话要求/明细/菜单），不再只在 zenActive 时生效',
  MOD.includes('if (!isActive) return') && MOD.includes('if (askVisible && askPending) { setAskDismissed(askPending.id); return }') &&
  MOD.includes('if (srcForm) { setSrcForm(null); return }') && MOD.includes('if (!zenActive) return'))
ok('条目10 补口：手编 SOURCE.md 的「行号区间 / 区间」＝「页码区间」别名（写盘仍统一页码区间）',
  (() => { const S = rd('electron/lib/aiTeachingSources.ts'); return S.includes('页码区间|行号区间|区间') && S.includes("m[1] === '行号区间' || m[1] === '区间'") })())

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
