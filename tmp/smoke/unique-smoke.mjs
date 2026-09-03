// uniqueFileName 冒烟：重名自动加 (1)(2)(3) 后缀；不存在时原样返回；无扩展名同样加 (1)；兜底
import esbuild from 'esbuild'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(os.tmpdir(), 'kb-unique-smoke.cjs')
await esbuild.build({
  entryPoints: [path.join(__dirname, 'workspace-entry.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  alias: { electron: path.join(__dirname, 'fake-electron.cjs') },
  outfile: OUT, logLevel: 'silent',
})
const { uniqueFileName } = await import(pathToFileURL(OUT).href + '?t=' + Date.now())

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-unq-'))

console.log('== 1. 不存在时原样返回 ==')
ok('全新名字直接返回', uniqueFileName(work, '新建.md') === '新建.md')

console.log('\n== 2. 已存在 + 扩展名 ==')
fs.writeFileSync(path.join(work, '新建.md'), '# a')
fs.writeFileSync(path.join(work, '新建(1).md'), '# b')
ok('跳过 (1) 返回 (2)', uniqueFileName(work, '新建.md') === '新建(2).md')
fs.writeFileSync(path.join(work, '新建(2).md'), '# c')
ok('跳到 (3)', uniqueFileName(work, '新建.md') === '新建(3).md')

console.log('\n== 3. 无扩展名同样加 (1) ==')
fs.writeFileSync(path.join(work, 'README'), 'r')
ok('无扩展名 加 (1)', uniqueFileName(work, 'README') === 'README(1)')
fs.writeFileSync(path.join(work, 'README(1)'), 'r1')
ok('无扩展名 加 (2)', uniqueFileName(work, 'README') === 'README(2)')

console.log('\n== 4. 多扩展名（a.tar.gz 视作 .gz）==')
fs.writeFileSync(path.join(work, '备份.tar.gz'), 'x')
ok('多扩展名按最后一段 加 (1)', uniqueFileName(work, '备份.tar.gz') === '备份.tar(1).gz')

console.log('\n== 5. 隐藏名 ==')
fs.writeFileSync(path.join(work, '.gitrc'), 'x')
ok('隐藏名同样加 (1)', uniqueFileName(work, '.gitrc') === '.gitrc(1)')

console.log('\n== 6. 边界 ==')
ok('空目录不存在 → 原样', uniqueFileName(path.join(work, 'nope'), 'x.md') === 'x.md')
ok('中文文件名', uniqueFileName(work, '页面.md') === '页面.md')

console.log(`\n结果: ${passed} passed, ${failed} failed`)
fs.rmSync(work, { recursive: true, force: true })
if (failed > 0) process.exit(1)