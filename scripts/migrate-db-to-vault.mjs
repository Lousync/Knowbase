#!/usr/bin/env node
/**
 * R6① 老库导出工具（删库前的安全网）：knowledge.db → 仓库 .knowbase/legacy-export/
 *
 * 设计要点：
 *  - **全表通用**：不写死表结构（历史迁移 ALTER 过，写死必漏）——枚举 db 内所有用户表，
 *    每张表导出为独立 JSON（列定义 + 全量行），自动适配任何结构、任何新增表。
 *  - **可校验**：导出后重读落盘文件，比对行数与内容 sha256，不符即报错退出。
 *  - **幂等**：已导出过（存在 _manifest.json）时拒绝覆盖，需显式 --force。
 *  - **可逆**：只读取 db、只新增文件，不修改/删除任何既有数据。
 *
 * 用法：
 *   node scripts/migrate-db-to-vault.mjs --db <knowledge.db> --out <仓库根/.knowbase/legacy-export>
 *                                        [--force] [--tables a,b,c] [--quiet]
 *
 * 产出：
 *   <out>/<table>.json          { table, columns, rows: [...] }
 *   <out>/_manifest.json        { exportedAt, dbPath, dbSha256, tables: [{ name, rows, sha256 }] }
 */
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import initSqlJs from 'sql.js'

// Windows 下 URL.pathname 会给出 /E:/… 形式，必须走 fileURLToPath 才能拿到合法盘符路径
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name) => process.argv.includes(name)

const dbPath = arg('--db')
const outDir = arg('--out')
const onlyTables = arg('--tables')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const force = has('--force')
const quiet = has('--quiet')

if (!dbPath || !outDir) {
  console.error('用法: node scripts/migrate-db-to-vault.mjs --db <knowledge.db> --out <仓库/.knowbase/legacy-export> [--force] [--tables a,b] [--quiet]')
  process.exit(1)
}
if (!existsSync(dbPath)) {
  console.error(`数据库不存在: ${dbPath}`)
  process.exit(1)
}

const log = (...a) => { if (!quiet) console.log(...a) }

/** 系统表/迁移表不导出（sqlite 元数据 + 迁移记录） */
function isUserTable(name) {
  return !name.startsWith('sqlite_') && name !== '_migrations'
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const SQL = await initSqlJs({
  locateFile: () => path.join(PROJECT_ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm'),
})

const dbBytes = readFileSync(dbPath)
const dbSha = sha256(dbBytes)
log(`读取数据库: ${dbPath}`)
log(`  体积: ${(dbBytes.length / 1024 / 1024).toFixed(2)} MB  sha256: ${dbSha.slice(0, 16)}…`)

const db = new SQL.Database(dbBytes)

const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
const allTables = (tablesRes[0]?.values ?? []).map((r) => r[0])
const targets = allTables.filter(isUserTable).filter((t) => !onlyTables || onlyTables.includes(t))

log(`发现 ${allTables.length} 张表，待导出 ${targets.length} 张`)

const manifestPath = path.join(outDir, '_manifest.json')
if (existsSync(manifestPath) && !force) {
  console.error(`已存在导出清单，拒绝覆盖（如需重跑请加 --force）: ${manifestPath}`)
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })

const manifest = {
  exportedAt: new Date().toISOString(),
  dbPath,
  dbSha256: dbSha,
  tool: 'scripts/migrate-db-to-vault.mjs',
  tables: [],
}

let totalRows = 0
let failed = 0

for (const table of targets) {
  let res
  try {
    res = db.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`)
  } catch (e) {
    console.error(`  ✗ ${table}: 读取失败 — ${e.message}`)
    failed++
    continue
  }
  const columns = res[0]?.columns ?? []
  const rows = res[0]?.values ?? []
  const payload = { table, columns, rows }
  const json = JSON.stringify(payload, null, 0)
  const file = path.join(outDir, `${table}.json`)
  writeFileSync(file, json, 'utf-8')
  const fileSha = sha256(Buffer.from(json, 'utf-8'))
  manifest.tables.push({ name: table, rows: rows.length, columns: columns.length, sha256: fileSha })
  totalRows += rows.length
  log(`  ✓ ${table.padEnd(28)} ${String(rows.length).padStart(6)} 行  ${columns.length} 列`)
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
log(`\n导出完成: ${manifest.tables.length} 表 / ${totalRows} 行 → ${outDir}`)
if (failed > 0) log(`⚠️  ${failed} 张表读取失败`)

// ---- 校验：重读落盘文件，比对行数与 sha256 ----
log('\n校验中…')
let verifyFail = 0
for (const t of manifest.tables) {
  const file = path.join(outDir, `${t.name}.json`)
  if (!existsSync(file)) { console.error(`  ✗ ${t.name}: 文件缺失`); verifyFail++; continue }
  const raw = readFileSync(file, 'utf-8')
  const sha = sha256(Buffer.from(raw, 'utf-8'))
  if (sha !== t.sha256) { console.error(`  ✗ ${t.name}: sha256 不符`); verifyFail++; continue }
  let parsed
  try { parsed = JSON.parse(raw) } catch { console.error(`  ✗ ${t.name}: JSON 解析失败`); verifyFail++; continue }
  if (parsed.rows.length !== t.rows) { console.error(`  ✗ ${t.name}: 行数 ${parsed.rows.length} ≠ ${t.rows}`); verifyFail++; continue }
}
if (verifyFail > 0) {
  console.error(`\n❌ 校验失败 ${verifyFail} 项，导出不可信，请勿据此删库`)
  process.exit(3)
}
log(`✓ 全部 ${manifest.tables.length} 张表校验通过（行数 + sha256 一致）`)
log('\n提示：这是删库前的安全网。删库前请另做一次全仓备份（工具箱 → 数据导出）。')
