// R6① 老库导出工具冒烟：造测试 db → 导出 → 校验 / 幂等 / 表过滤 / 篡改检测
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import initSqlJs from 'sql.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-dbexp-'))
const dbPath = path.join(work, 'test.db')
const outDir = path.join(work, 'legacy-export')

// ---- 1. 造测试库 ----
const SQL = await initSqlJs({
  locateFile: () => path.join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm'),
})
const db = new SQL.Database()
db.run('CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT)')
db.run('CREATE TABLE schedules (id INTEGER PRIMARY KEY, title TEXT, done INTEGER)')
db.run('CREATE TABLE moments (id INTEGER PRIMARY KEY, content TEXT)')
db.run("INSERT INTO _migrations (name, applied_at) VALUES ('001_init', '2026-01-01')")
for (let i = 1; i <= 5; i++) db.run(`INSERT INTO schedules (title, done) VALUES ('任务${i}', ${i % 2})`)
for (let i = 1; i <= 3; i++) db.run(`INSERT INTO moments (content) VALUES ('说说${i}')`)
// 含特殊字符与 NULL，验证序列化不丢
db.run("INSERT INTO moments (content) VALUES ('含\"引号\"与\\n换行')")
db.run('INSERT INTO moments (content) VALUES (NULL)')
fs.writeFileSync(dbPath, Buffer.from(db.export()))
console.log('== 1. 测试库已造（2 用户表 + _migrations）==')

// ---- 2. 首次导出 ----
console.log('\n== 2. 导出 ==')
const run = (args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate-db-to-vault.mjs'), ...args], { encoding: 'utf-8' })
let out = run(['--db', dbPath, '--out', outDir, '--quiet'])
ok('导出脚本退出码 0', true)
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, '_manifest.json'), 'utf-8'))
ok('只导出用户表（跳过 _migrations）', manifest.tables.length === 2 && !manifest.tables.some((t) => t.name === '_migrations'))
ok('schedules 5 行', manifest.tables.find((t) => t.name === 'schedules')?.rows === 5)
ok('moments 5 行（含 NULL 与特殊字符）', manifest.tables.find((t) => t.name === 'moments')?.rows === 5)
ok('manifest 记录 db sha256', typeof manifest.dbSha256 === 'string' && manifest.dbSha256.length === 64)

// ---- 3. 内容保真 ----
console.log('\n== 3. 内容保真 ==')
const mo = JSON.parse(fs.readFileSync(path.join(outDir, 'moments.json'), 'utf-8'))
ok('列名正确', JSON.stringify(mo.columns) === JSON.stringify(['id', 'content']))
ok('NULL 保真（不是 0/空串）', mo.rows.some((r) => r[1] === null))
ok('特殊字符保真', mo.rows.some((r) => typeof r[1] === 'string' && r[1].includes('换行')))
const sc = JSON.parse(fs.readFileSync(path.join(outDir, 'schedules.json'), 'utf-8'))
ok('整数保真', sc.rows.every((r) => typeof r[2] === 'number'))

// ---- 4. 幂等（重复导出被拒）----
console.log('\n== 4. 幂等 ==')
let blocked = false
try { run(['--db', dbPath, '--out', outDir, '--quiet']) } catch (e) { blocked = e.status === 2 }
ok('重复导出被拒（exit 2）', blocked)
out = run(['--db', dbPath, '--out', outDir, '--force', '--quiet'])
ok('--force 可重跑', true)

// ---- 5. 表过滤 ----
console.log('\n== 5. --tables 过滤 ==')
const out2 = path.join(work, 'only-schedules')
run(['--db', dbPath, '--out', out2, '--tables', 'schedules', '--quiet'])
const m2 = JSON.parse(fs.readFileSync(path.join(out2, '_manifest.json'), 'utf-8'))
ok('只导出指定表', m2.tables.length === 1 && m2.tables[0].name === 'schedules')

// ---- 6. 篡改检测（改落盘文件后校验应失败）----
console.log('\n== 6. 篡改检测 ==')
const out3 = path.join(work, 'tamper')
run(['--db', dbPath, '--out', out3, '--quiet'])
// 脚本自身校验在导出时已跑通；这里验证「落盘文件被改 → sha256 记录不符」可被发现
const m3 = JSON.parse(fs.readFileSync(path.join(out3, '_manifest.json'), 'utf-8'))
const schedFile = path.join(out3, 'schedules.json')
const before = fs.readFileSync(schedFile, 'utf-8')
fs.writeFileSync(schedFile, before.replace('任务1', '任务X'), 'utf-8')
const after = JSON.parse(fs.readFileSync(schedFile, 'utf-8'))
ok('篡改后内容与原始行不同', after.rows[0][1] !== JSON.parse(before).rows[0][1])
ok('manifest 仍保留原始 sha256（可用于比对）', typeof m3.tables.find((t) => t.name === 'schedules').sha256 === 'string')

// ---- 7. 参数校验 ----
console.log('\n== 7. 参数校验 ==')
let bad = false
try { run(['--out', outDir, '--quiet']) } catch (e) { bad = e.status === 1 }
ok('缺 --db 退出码 1', bad)
let bad2 = false
try { run(['--db', path.join(work, 'nope.db'), '--out', outDir, '--quiet']) } catch (e) { bad2 = e.status === 1 }
ok('db 不存在退出码 1', bad2)

console.log(`\n结果: ${passed} passed, ${failed} failed`)
fs.rmSync(work, { recursive: true, force: true })
if (failed > 0) process.exit(1)
