// AI教学 P2（CONSTRAINTS.md 约束文件化）源码断言。
// 用法：node tmp/smoke/ai-teaching-p2-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

const FLD = rd('electron/lib/aiTeachingFolders.ts')
const SVC = rd('electron/lib/agentService.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('P2 断言：主进程约束服务')
ok('CONSTRAINTS.md 常量 + 模板路径段', FLD.includes("CONSTRAINTS_FILE = 'CONSTRAINTS.md'") && FLD.includes("'_templates'"))
ok('建夹即模板播种（目标已存在不覆盖；P5 起多候选：工作区层优先回退根层）',
  FLD.includes('seedConstraintsFromTemplate') && FLD.includes('if (existsSync(dest)) return') && FLD.includes('templateAbsCandidates'))
ok('writeConstraints 懒建文件夹后落盘、仅存文件', FLD.includes('writeConstraints') && FLD.includes('ensureSessionFolder(sessionId, getSetting)') && FLD.includes('writeFileSync(join(vault.rootPath, ensured.relPath, CONSTRAINTS_FILE)'))
ok('readConstraints 无文件夹 → 空 text（不报错）', FLD.includes('readConstraints') && FLD.includes("if (!rel) return { ok: true, text: '', relPath: null }"))
ok('resolveConstraintsForInjection：文件唯一真相源 + 旧会话 DB 读兼容',
  FLD.includes('resolveConstraintsForInjection')
  && FLD.includes('return existsSync(p) ? readFileSync(p, \'utf-8\').trim() : \'\'')
  && FLD.includes('getAgentSession(sessionId)?.instructions?.trim() || \'\''))

console.log('P2 断言：AgentRunner 注入改造')
ok('runAgentLoop 改读 resolveConstraintsForInjection', SVC.includes('resolveConstraintsForInjection(sessionId, getSettingReader())'))
ok('注入截断防 token 失控（4000）', SVC.includes('rawConstraints.length > 4000') && SVC.includes("slice(0, 4000)"))
ok('注入头标注来源 CONSTRAINTS.md', SVC.includes('CONSTRAINTS.md'))
ok('import 接线', SVC.includes("import { resolveConstraintsForInjection } from './aiTeachingFolders'"))

console.log('P2 断言：IPC 三层')
ok('readConstraints/writeConstraints 通道注册', FLD.includes("'aiTeach:readConstraints'") && FLD.includes("'aiTeach:writeConstraints'"))
ok('preload 两方法', PRE.includes('aiTeachReadConstraints') && PRE.includes('aiTeachWriteConstraints'))
ok('ElectronAPI 类型', TY.includes('aiTeachReadConstraints') && TY.includes('aiTeachWriteConstraints'))
ok('渲染层 ipc 包装', IPC.includes('aiTeachReadConstraints') && IPC.includes('aiTeachWriteConstraints'))

console.log('P2 断言：模块 UI 走文件')
ok('loadConstraints：有文件夹认文件，无文件夹读兼容 DB',
  MOD.includes('aiTeachReadConstraints(sid)') && MOD.includes('r.relPath ? (r.text ?? \'\').trim() : dbFallback'))
ok('saveInstr 写文件而非 DB', MOD.includes('aiTeachWriteConstraints(sid, text)') && !/agentSetSessionInstructions\(sid, text\)/.test(MOD))
ok('保存后清旧 DB 残留（防双真相源）', MOD.includes("agentSetSessionInstructions(sid, '')"))
ok('弹层标注 CONSTRAINTS.md + maxLength 提到 2000', MOD.includes('CONSTRAINTS.md') && MOD.includes('maxLength={2000}'))
ok('落盘路径展示 instrRel（条目8.1 方案 A：弹层内次级入口=在方案 B 阅读视图打开本文件）',
  MOD.includes('instrRel') && MOD.includes('在方案 B 阅读视图中打开本文件') && MOD.includes('void openDocView(instrRel)'))
ok('条目8.1：中型编辑弹层规格（560px/86vh 对齐画像弹层）+ 模板说明折叠 + Ctrl+Enter 保存',
  MOD.includes('w-[560px] max-w-[94vw] max-h-[86vh]') && MOD.includes('怎么写？（模板与示例）') && MOD.includes("e.key === 'Enter' && (e.ctrlKey || e.metaKey)"))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
