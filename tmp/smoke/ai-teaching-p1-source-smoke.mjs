// AI教学 P1（会话 ⇄ 文件夹绑定）源码断言。
// 用法：node tmp/smoke/ai-teaching-p1-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

const FLD = rd('electron/lib/aiTeachingFolders.ts')
const MAIN = rd('electron/main/index.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const SET = rd('src/lib/settings.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')
const ED = rd('src/modules/editor/index.tsx')
const MV = rd('src/modules/settings/views/ModulesView.tsx')
const AV = rd('src/modules/settings/views/AiTeachingView.tsx')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('P1 断言：主进程文件夹服务')
ok('服务存在且锚点为 .session.json', FLD.includes("ANCHOR_FILE = '.session.json'") && FLD.includes('interface SessionFolderAnchor'))
ok('文件夹命名 = MM-DD + 清洗标题（40 上限）',
  FLD.includes('folderBaseName') && FLD.includes('.slice(0, 40)') && FLD.includes('uniqueFileName'))
ok('ensure 幂等：先按锚点扫描定位，存在即返回', FLD.includes('findSessionFolderRel') && FLD.includes('if (existing) return { ok: true, relPath: existing }'))
ok('重命名保留日期前缀 + 锚点标题同步', FLD.includes('/^(\\d{2}-\\d{2})\\s/.exec(oldName)') && FLD.includes('data.title'))
ok('无文件夹的旧会话改名不主动建（懒创建 2-5）', FLD.includes('return { ok: true, relPath: null }'))
ok('删除走系统回收站（复用 trashWorkspacePath）', FLD.includes('await trashWorkspacePath(vault.rootId, rel)'))
ok('aiTeach:* 四通道注册', ['ensure', 'sessionFolder', 'renameSessionFolder', 'deleteSessionFolder'].every(x => FLD.includes(`'aiTeach:${x === 'ensure' ? 'ensureSessionFolder' : x === 'sessionFolder' ? 'sessionFolder' : x === 'renameSessionFolder' ? 'renameSessionFolder' : 'deleteSessionFolder'}'`)))
ok('根目录改名迁移（3-15：失败保留原目录并提示）', FLD.includes('migrateRootDir') && FLD.includes('renameSync(oldAbs, newAbs)') && FLD.includes('aiTeach:notice'))
ok('main 启动注册 handlers', MAIN.includes('registerAiTeachingFolderHandlers'))
ok('settings:set 挂 aiTeachRootDir 迁移钩子（非法名回滚）', MAIN.includes("key === 'aiTeachRootDir'") && MAIN.includes("settingsCache[key] = prev; return false"))

console.log('P1 断言：三层接线')
ok('preload 四方法 + 两事件', PRE.includes('aiTeachEnsureSessionFolder') && PRE.includes('aiTeachDeleteSessionFolder') && PRE.includes("ipcRenderer.on('aiTeach:tree-refresh'") && PRE.includes("ipcRenderer.on('aiTeach:notice'"))
ok('ElectronAPI 类型声明', TY.includes('aiTeachEnsureSessionFolder') && TY.includes('onAiTeachTreeRefresh') && TY.includes('onAiTeachNotice'))
ok('渲染层 ipc 包装', IPC.includes('aiTeachEnsureSessionFolder') && IPC.includes('aiTeachRenameSessionFolder') && IPC.includes('aiTeachDeleteSessionFolder'))

console.log('P1 断言：设置项')
ok('aiTeachRootDir（默认 AI教学，modules 区，ui）', SET.includes("aiTeachRootDir: { default: 'AI教学'") && SET.includes("section: 'modules', ui: true"))
ok('aiTeachDeleteSessionFolder（默认 ask）', SET.includes("aiTeachDeleteSessionFolder: { default: 'ask'"))
ok('设置页 AI教学区块已挂进模块设置', MV.includes('AiTeachingView') && AV.includes("update('aiTeachRootDir'") && AV.includes("update('aiTeachDeleteSessionFolder'"))

console.log('P1 断言：模块 UI 联动')
ok('新建任务确认即建文件夹（2-2）', MOD.includes('aiTeachEnsureSessionFolder(row.id)'))
ok('删除策略 ask/keep/delete + 询问文案', MOD.includes("getSettingRaw('aiTeachDeleteSessionFolder')") && MOD.includes('showGlobalConfirm') && MOD.includes('aiTeachDeleteSessionFolder(sid)'))
ok('双击重命名 → DB + 文件夹同步', MOD.includes('onDoubleClick') && MOD.includes('agentRenameSession(sid, t)') && MOD.includes('aiTeachRenameSessionFolder(sid, t)'))
ok('主进程提示接 toast', MOD.includes('onAiTeachNotice'))
ok('编辑区文件树联动刷新', ED.includes('onAiTeachTreeRefresh') && ED.includes("void refreshDir('')"))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
