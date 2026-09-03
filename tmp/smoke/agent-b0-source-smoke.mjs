// B0 旧账修复源码冒烟：断言 builtinTools.ts 已按「模块真相源」分流，防未来回归。
// 用法：node tmp/smoke/agent-b0-source-smoke.mjs
// 说明：handler 闭包依赖 electron 链难以脱离进程单测，此处以源码级断言作快速回归钩子；
//       行为级验收（vault 模式 search 命中 .md / create-page 拒绝且 knowledge_pages 行数不变）走真机清单（docs/agent-file-tools-design.md §9.4）。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'electron/lib/builtinTools.ts'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('B0 内置工具读源分流断言（builtinTools.ts）')
console.log('  1) storage 开关 helper 与 import')
ok('storageIs helper 存在（storageKnowledge/storageBlog/storageData 三键）',
  /function storageIs\(kind: 'knowledge' \| 'blog' \| 'data'\)/.test(SRC))
ok('import knowledgeVaultRepo 读函数（vaultSearchPages / vaultGetPageById）',
  SRC.includes("vaultSearchPages as vaultSearchKnowledgePages") && SRC.includes('vaultGetPageById'))
ok('import blogVaultRepo.vaultCreateEntry 与 bookmarkVaultRepo.vaultBookmarksAll',
  SRC.includes('vaultCreateEntry') && SRC.includes('vaultBookmarksAll'))

console.log('  2) knowledge 读工具 vault 分流')
ok('search 含 vault 分支（vaultSearchKnowledgePages 调用 + excerpt 回退 title）',
  /vaultSearchKnowledgePages\(q\)/.test(SRC) && SRC.includes('excerpt: r.excerpt || r.title'))
ok('read 含 vault 分支（vaultGetPageById + maxChars 截断保留）',
  /vaultGetPageById\(id\)/.test(SRC) && SRC.includes('truncated ? content.slice(0, maxChars) : content'))
ok('search/read 的 sqlite fallback 仍保留（knowledge_pages 查询未删）',
  (SRC.match(/FROM knowledge_pages/g) || []).length >= 2)

console.log('  3) knowledge 写工具 vault 停用')
ok('create-page 拒绝文案（vault 写工具上线前不静默写旧库）',
  SRC.includes('AI 建页将在「vault 写工具」上线后开放'))
ok('append-page 拒绝文案',
  SRC.includes('AI 追加内容将在「vault 写工具」上线后开放'))
ok('两个写工具均保留 sqlite 实现（INSERT / UPDATE knowledge_pages 仍在）',
  SRC.includes('INSERT INTO knowledge_pages') && SRC.includes('UPDATE knowledge_pages'))

console.log('  4) blog / bookmark 同款加固')
ok('blog.create-entry 含 vault 分支（vaultCreateEntry + 每天一篇防重 throw）',
  /vaultCreateEntry\(\{ title: str\(args.title\)/.test(SRC) && SRC.includes('e.contentMd !== contentMd'))
ok('bookmarks.search 含 vault 分支（vaultBookmarksAll 内存过滤）',
  SRC.includes('const all = vaultBookmarksAll()') && SRC.includes('terms.every(t => hay.includes'))

console.log('  5) 数据归属注释约定')
ok('文件头含「数据归属约定」注释',
  SRC.includes('数据归属约定') && SRC.includes('严禁绕过模块分流直连 sql.js 旧表'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
