// B3 vault rename/trash 源码冒烟 + 公共函数抽取断言。
// 用法：node tmp/smoke/agent-b3-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'electron/lib/builtinTools.ts'), 'utf-8')
const WM = fs.readFileSync(path.join(ROOT, 'electron/lib/workspaceManager.ts'), 'utf-8')
const AG = fs.readFileSync(path.join(ROOT, 'electron/lib/agentService.ts'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('B3 断言：vault.rename / vault.trash 工具')
ok('注册 builtin.vault.rename / trash',
  SRC.includes("name: 'builtin.vault.rename'") && SRC.includes("name: 'builtin.vault.trash'"))
ok('两工具 vaultFile write + requires write',
  (SRC.match(/vaultFile: 'write'/g) || []).length >= 4) // write/edit + rename/trash
ok('仅普通区 .md/.txt（.knowbase 禁动：isAiWritableFile 复用）',
  (SRC.match(/isAiWritableFile\(root, (oldAbs|abs)\)/g) || []).length >= 2)
ok('trash 走系统回收站（trashWorkspacePath，非删除）',
  SRC.includes('await trashWorkspacePath(rootId, rel)'))
ok('rename 移入目录语义（newPath 为目录则保留文件名）',
  SRC.includes('finalNewRel = join(relative(root, newAbs), baseNameOf(rel))'))

console.log('B3 断言：workspaceManager 公共函数抽取（IPC 与 AI 工具共用同语义）')
ok('导出 renameWorkspacePath（含索引失效）',
  WM.includes('export function renameWorkspacePath') && WM.includes('invalidateIndexIfCurrentVault(rootId)'))
ok('导出 trashWorkspacePath（trash 包 + 索引失效）',
  WM.includes('export async function trashWorkspacePath'))
ok('ws:rename / ws:trash handler 已改为调用公共函数',
  WM.includes('renameWorkspacePath(rootId, oldRel, newRel)') && WM.includes('await trashWorkspacePath(rootId, relPath)'))
ok('索引失效函数上移为模块级（闭包内不再重复声明）',
  WM.indexOf('function invalidateIndexIfCurrentVault(rootId: string): void {') > -1 &&
  !/function invalidateIndexIfCurrentVault[\s\S]{0,80}loadVaults\(\)/.test(WM.slice(WM.indexOf('registerWorkspaceHandlers'), WM.indexOf('registerWorkspaceHandlers') + 200)))

console.log('B3 断言：会话写上限集合含 rename/trash（同一护栏）')
ok('VAULT_WRITE_TOOLS 含 rename 与 trash',
  AG.includes("'builtin.vault.rename'") && AG.includes("'builtin.vault.trash'"))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
