// B1 vault.* 只读工具源码冒烟：断言 builtinTools.ts 已注册三工具与禁区逻辑，防回归。
// 用法：node tmp/smoke/agent-b1-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'electron/lib/builtinTools.ts'), 'utf-8')
const AITS = fs.readFileSync(path.join(ROOT, 'electron/lib/aiTools.ts'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('B1 断言：vault.* 只读工具与 vaultFile 权限域')
ok('注册三只读工具名（builtin.vault.list/read/search）',
  SRC.includes("name: 'builtin.vault.list'") && SRC.includes("name: 'builtin.vault.read'") && SRC.includes("name: 'builtin.vault.search'"))
ok('三工具 readOnly + requires read + vaultFile read',
  (SRC.match(/vaultFile: 'read'/g) || []).length >= 3)
ok('AI 可见性规则存在（childAiAllowed / .knowbase 仅 modules 放行）',
  SRC.includes('function childAiAllowed') && SRC.includes("parts[1] === VAULT_MODULES_DIR"))
ok('读白名单：.md/.txt + modules/*.json（isAiReadableFile）',
  SRC.includes("ext === 'md' || ext === 'txt'") && SRC.includes('function isModulesJson'))
ok('大小门槛与预算（>10MB 拒 / search ≤1MB·400 文件）',
  SRC.includes('MAX_VAULT_FILE = 10 * 1024 * 1024') && SRC.includes('MAX_VAULT_SEARCH_FILES = 400'))
ok('守卫复用 workspaceManager.resolveSafe',
  SRC.includes("resolveSafe(root, rel)") || SRC.includes('resolveSafe(rootPath, rel)') || SRC.includes("resolveSafe(root, relPath"))
ok('工具描述含 .knowbase/modules/*.json 只读说明',
  SRC.includes('.knowbase/modules/*.json'))
ok('vaultRootPath 使用 vaultContext.getCurrentVault',
  SRC.includes('getCurrentVault()'))

console.log('B1 断言：vaultFile 权限域（aiTools / agentService / settings / UI）')
ok('AgentTool 含 vaultFile 字段声明',
  AITS.includes("vaultFile?: 'read' | 'write'"))
ok('错误码含 VAULTFILE_FORBIDDEN/READONLY + MODULE_*（顺手消基线）',
  AITS.includes("'VAULTFILE_FORBIDDEN'") && AITS.includes("'VAULTFILE_READONLY'") && AITS.includes("'MODULE_FORBIDDEN'") && AITS.includes("'MODULE_READONLY'"))
ok('checkVaultFilePermission 硬校验 + invoke 链接入',
  AITS.includes('export function checkVaultFilePermission') && AITS.includes("if (tool.vaultFile)"))
ok('agentService 预过滤（deniedVaultFile + 提示注入）',
  (() => { try {
    const AG = fs.readFileSync(path.join(ROOT, 'electron/lib/agentService.ts'), 'utf-8')
    return AG.includes('checkVaultFilePermission') && AG.includes('deniedVaultFile') && AG.includes('vaultFileHint')
  } catch { return false } })())
ok('settings 默认 aiVaultFilePerm=read',
  (() => { try {
    const ST = fs.readFileSync(path.join(ROOT, 'src/lib/settings.ts'), 'utf-8')
    return ST.includes("aiVaultFilePerm: { default: 'read'")
  } catch { return false } })())
ok('AiPermissionsTab 仓库文件三档 UI',
  (() => { try {
    const UI = fs.readFileSync(path.join(ROOT, 'src/modules/settings/views/AiPermissionsTab.tsx'), 'utf-8')
    return UI.includes('仓库文件') && UI.includes('setVaultPerm') && UI.includes('aiVaultFilePerm')
  } catch { return false } })())

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
