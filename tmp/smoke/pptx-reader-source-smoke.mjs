// PPT 素材逐页阅读（docs:pptxPages + 沉浸 UI）源码断言。
// 用法：node tmp/smoke/pptx-reader-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DR = fs.readFileSync(path.join(ROOT, 'electron/lib/docsReader.ts'), 'utf-8')
const IPC = fs.readFileSync(path.join(ROOT, 'electron/lib/docsIpc.ts'), 'utf-8')
const MAIN = fs.readFileSync(path.join(ROOT, 'electron/main/index.ts'), 'utf-8')
const PR = fs.readFileSync(path.join(ROOT, 'electron/preload/index.ts'), 'utf-8')
const TY = fs.readFileSync(path.join(ROOT, 'src/types/index.ts'), 'utf-8')
const IM = fs.readFileSync(path.join(ROOT, 'src/modules/ai-teaching/index.tsx'), 'utf-8')

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('PPT 分页服务断言')
ok('docsReader 按页导出 extractPptxPages（页号 n + text）',
  DR.includes('export function extractPptxPages') && DR.includes('slideNumOf(name)'))
ok('docs:pptxPages IPC：当前仓库 + resolveSafe + 仅 .pptx 守卫',
  IPC.includes("ipcMain.handle('docs:pptxPages'") && IPC.includes("getCurrentVault()") && IPC.includes("extname(abs).toLowerCase() !== '.pptx'"))
ok('main/index 已注册 registerDocsReadHandlers',
  MAIN.includes('registerDocsReadHandlers()') && MAIN.includes("from '../lib/docsIpc'"))
ok('桥：preload docsPptxPages + ElectronAPI + ipc.ts 封装',
  PR.includes('docsPptxPages') && TY.includes('docsPptxPages: (relPath: string)') && IM.includes('docsPptxPages'))

console.log('沉浸 PPT 阅读 UI 断言')
ok('素材：右栏「PPT 素材」按钮 + 递归扫描仓库 .pptx（≤3 层）',
  IM.includes('PPT 素材') && IM.includes('workspaceListDir') && IM.includes("endsWith('.pptx')"))
ok('素材列表：加入/移除/阅读中高亮/讲解按钮',
  IM.includes('removeSource') && IM.includes('阅读中'))
ok('逐页阅读视图（P3a：reader 激活占用中栏——页卡+原文编号+文本/空页提示）',
  IM.includes('原文编号') && IM.includes('（本页无文字内容'))
ok('翻页与「讲解此页」（把当前页文本发给 agent 并退出阅读回对话流）',
  IM.includes('goPage(') && IM.includes('talkCurrentPage') && IM.includes('setReader(null)'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
