// AI教学 P5（工作区两层结构：选择页/页签/归属元数据/两层目录）源码断言。
// 用法：node tmp/smoke/ai-teaching-p5-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const WS = rd('electron/lib/aiTeachingWorkspaces.ts')
const FLD = rd('electron/lib/aiTeachingFolders.ts')
const MAIN = rd('electron/main/index.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const FT = rd('src/modules/ai-teaching/AiTeachFileTree.tsx')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
console.log('AI教学 P5 源码冒烟：')

ok('工作区元数据入仓库 .knowbase/modules/aiTeaching/workspaces.json（3-6 建议落地，jsonStore 原子写）',
  WS.includes("MODULE = 'modules/aiTeaching'") && WS.includes("KEY = 'workspaces.json'") && WS.includes('readJson') && WS.includes('writeJson'))
ok('工作区卡片统计齐（对话数/产物数/最近活跃/绑定文件夹）',
  ['sessionCount', 'docCount', 'folderRel', 'lastActive'].every(k => WS.includes(k)) && WS.includes('countDocs'))
ok('create/rename/delete/assign/unassign/setLast 全套 + 7 个 IPC 通道',
  ['createWorkspace', 'renameWorkspace', 'deleteWorkspace', 'assignSession', 'unassignSession', 'setLastWorkspace', 'listWorkspaces'].every(k => WS.includes(k)) &&
  ['aiTeach:listWorkspaces', 'aiTeach:createWorkspace', 'aiTeach:renameWorkspace', 'aiTeach:deleteWorkspace', 'aiTeach:assignSession', 'aiTeach:unassignSession', 'aiTeach:setLastWorkspace'].every(c => WS.includes(`'${c}'`)))
ok('工作区改名同步改产物文件夹（目标占用拒绝，无半改状态）',
  WS.includes('renameSync(oldAbs') && WS.includes('目标文件夹'))
ok('删除工作区=仅删归属元数据（文件夹/对话保留转未归一）',
  WS.includes('m.workspaces = m.workspaces.filter') && !WS.includes('trashWorkspacePath'))
ok('主进程注册 registerAiTeachingWorkspaceHandlers',
  MAIN.includes('registerAiTeachingWorkspaceHandlers'))

ok('ensureSessionFolder 两层：读归属 → AI教学/{工作区}/{MM-DD 标题}/ 落新夹',
  FLD.includes('getWorkspaceOfSession(sessionId)') && FLD.includes('workspaceFolderRel(wsId, getSetting)'))
ok('锚点双深度扫描（存量扁平不迁移；workspaceId 快照字段）',
  FLD.includes('anchorMatches') && FLD.includes('${rootDir}/${name}/${sub}') && FLD.includes('workspaceId?: string'))
ok('会话改名父目录泛化（任意深度）',
  FLD.includes('parentRel') && FLD.includes('rel.lastIndexOf(\'/\')'))
ok('CONSTRAINTS 模板工作区层优先、回退产物根层（P2 语义不变）',
  FLD.includes('seedConstraintsFromTemplate(folderAbs, wsId && join') && FLD.includes('CONSTRAINTS_TEMPLATE_REL_SEGMENTS'))

ok('三层接线：preload/types/ipc 各 7 个工作区 API',
  ['aiTeachListWorkspaces', 'aiTeachCreateWorkspace', 'aiTeachRenameWorkspace', 'aiTeachDeleteWorkspace', 'aiTeachAssignSession', 'aiTeachUnassignSession', 'aiTeachSetLastWorkspace'].every(k => PRE.includes(k) && TY.includes(k) && IPC.includes(k)))
ok('types：AiTeachWorkspaceInfo 接口',
  TY.includes('export interface AiTeachWorkspaceInfo') && TY.includes('sessionWs: Record<string, string>'))

ok('进模块先见工作区选择页（activeWs=null 初始态 + 「选择工作区」标题）',
  MOD.includes("useState<string | null>(null) // null = 工作区选择页") && MOD.includes('选择工作区'))
ok('记住上次工作区（setLastWorkspace + 选择页「继续上次工作区」入口）',
  MOD.includes('aiTeachSetLastWorkspace') && MOD.includes('继续上次工作区') && MOD.includes('lastWsId'))
ok('工作区卡片统计渲染 + 搜索 + 新建/改名/删除入口',
  MOD.includes('个对话 · ') && MOD.includes('wsFiltered') && MOD.includes('新建工作区') && MOD.includes('removeWs'))
ok('未归一会话伪工作区入口（存量会话不强行迁移）',
  MOD.includes("'__none__'") && MOD.includes('未归一会话') && MOD.includes('wsUnassigned > 0'))
ok('顶栏页签=本工作区对话（会话列表区退役 §3.7）',
  MOD.includes('wsSessions.map') && MOD.includes('页签即会话切换器') && !MOD.includes('会话（${sessions.length}）'))
ok('工作区 chip 返回选择页',
  MOD.includes('exitToPicker') && MOD.includes('返回工作区选择页'))
ok('新对话先归属再建夹（顺序 await）',
  /if \(activeWs && activeWs !== '__none__'\) await aiTeachAssignSession\(row\.id, activeWs\)[\s\S]*aiTeachEnsureSessionFolder\(row\.id\)/.test(MOD))
ok('refreshSessions 按工作区过滤且选择页不自动开会话',
  MOD.includes('activeWsRef.current ? (cur ?? pool[0]) : undefined') && MOD.includes("(wsMapRef.current[s.id] ?? '__none__')"))
ok('左栏树挂工作区文件夹层（subRel + treeBase 全路径）',
  FT.includes('subRel') && MOD.includes('subRel={wsTreeSeg}') && MOD.includes('openDocView(`${treeBase}/${rel}`)'))
ok('阅读/编辑器跳转用 treeBase 前缀（两层路径一致）',
  MOD.includes('kb-open-in-editor\', { detail: { relPath: `${treeBase}/${rel}`') || MOD.includes('relPath: `${treeBase}/${rel}` }'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
