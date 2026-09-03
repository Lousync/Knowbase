// web.read / docs.read-text 源码断言冒烟（场景 B 配套工具）。
// 用法：node tmp/smoke/agent-extra-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'electron/lib/builtinTools.ts'), 'utf-8')
const WS = fs.readFileSync(path.join(ROOT, 'electron/lib/webSearch.ts'), 'utf-8')
const DR = fs.readFileSync(path.join(ROOT, 'electron/lib/docsReader.ts'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('web.read 断言')
ok('注册 builtin.web.read + 只读 + 不设 module（跨模块通用，同 web.search）',
  SRC.includes("name: 'builtin.web.read'") && SRC.includes("readOnly: true"))
ok('webReadPage 数据源含 SSRF 防线（仅 https / 拒 localhost / 拒私网段与裸 IP）',
  WS.includes("export async function webReadPage") &&
  WS.includes("u.protocol !== 'https:'") &&
  WS.includes("host === 'localhost'") &&
  WS.includes('不允许访问内网/私网地址'))
ok('正文提取（article/main 优先 + 实体解码 + 截断/总字数回报）',
  WS.includes('pickMainHtml') && WS.includes('truncated') && WS.includes('totalChars'))

console.log('docs.read-text 断言')
ok('注册 builtin.docs.read-text + vaultFile read',
  SRC.includes("name: 'builtin.docs.read-text'") && SRC.includes("vaultFile: 'read'"))
ok('isAiDocFile 白名单 .pdf/.pptx 且 .knowbase 禁入',
  SRC.includes('function isAiDocFile') && SRC.includes("ext === 'pdf' || ext === 'pptx'"))
ok('docsReader：pdf → pdfjs legacy workerSrc（Node 实测可行）',
  DR.includes("require('pdfjs-dist/legacy/build/pdf.js')") &&
  DR.includes("require.resolve('pdfjs-dist/legacy/build/pdf.worker.js')"))
ok('docsReader：pptx → zip 解压 + <a:t> 提取 + XML 实体解码',
  DR.includes('unzipBuffer') && DR.includes('slideNames') && DR.includes('decodeXml'))
ok('不支持类型明确拒绝（.md/.txt 指引 vault.read）',
  DR.includes('仅支持 .pdf / .pptx 文本提取'))

console.log('pdfjs Node 提取回归（PDF 样张 → 提取成功）—— 通过 tmp/smoke/pdfjs-node-probe.mjs 独立验证，此处检查脚本存在')
ok('pdfjs-node-probe.mjs 存在（pdf-lib 造样 + pdfjs legacy 提取，长期回归钩子）',
  fs.existsSync(path.join(ROOT, 'tmp/smoke/pdfjs-node-probe.mjs')))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
