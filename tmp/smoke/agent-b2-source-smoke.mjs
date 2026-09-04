// B2 vault 写工具源码冒烟：write/edit/resolve-ref + 会话写上限 + 写白名单断言。
// 用法：node tmp/smoke/agent-b2-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'electron/lib/builtinTools.ts'), 'utf-8')
const AG = fs.readFileSync(path.join(ROOT, 'electron/lib/agentService.ts'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('B2 断言：vault 写工具与守卫')
ok('注册 builtin.vault.write / edit / resolve-ref',
  SRC.includes("name: 'builtin.vault.write'") && SRC.includes("name: 'builtin.vault.edit'") && SRC.includes("name: 'builtin.vault.resolve-ref'"))
ok('write/edit 标 vaultFile write + requires write（读/写域分离）',
  (SRC.match(/vaultFile: 'write'/g) || []).length >= 2)
ok('resolve-ref 只读 + vaultFile read',
  SRC.includes("name: 'builtin.vault.resolve-ref'") && SRC.includes("vaultFile: 'read'"))
ok('写白名单：仅普通区 .md/.txt（.knowbase 全面禁写）',
  SRC.includes('function isAiWritableFile') && SRC.includes('parts[0].startsWith(\'.\')') && SRC.includes("ext === 'md' || ext === 'txt'"))
ok('冲突检测复用 detectConflict（expectedMtimeMs 基线）',
  SRC.includes('detectConflict(abs, expected)') && SRC.includes('请先 vault.read 重取最新内容再写入'))
ok('write 原子写 writeWorkspaceFile + 外部变更广播 ws:external-change',
  SRC.includes('writeWorkspaceFile(abs, content)') && SRC.includes("w.webContents.send('ws:external-change'"))
ok('edit 单处替换语义（oldText 唯一命中 + 多处拒绝）',
  SRC.includes('出现多处，请提供更长更精确的 oldText'))
ok('resolve-ref 剥 [[ ]] 精确/模糊匹配 + 草稿排除',
  SRC.includes("raw.replace(/^\\[\\[|\\]\\]$/g, '')") && SRC.includes("p.status !== 'draft'"))

console.log('B2 断言：AgentRunner 会话写上限')
ok('上限常量 5 + vault 写工具集合',
  AG.includes('MAX_SESSION_WRITES = 5') && AG.includes("'builtin.vault.write'"))
ok('执行前计数拦截（超限 push tool 错误并 continue）',
  AG.includes('sessionWrites >= MAX_SESSION_WRITES') && AG.includes('已达本次会话文件写入上限'))
ok('计数在每次请求的 runAgentLoop 内重置（let sessionWrites = 0）',
  AG.includes('let sessionWrites = 0'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
