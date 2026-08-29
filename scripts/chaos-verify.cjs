/**
 * 混沌验证脚本 —— 注入灾难现场并验证恢复机制。
 *
 * 用法：先以 KNOWBASE_DEV_BRIDGE=1 构建（npm run build），再运行：
 *   node scripts/chaos-verify.cjs [--scenario corrupt-main|corrupt-bak|half-migrated|all]
 *
 * 原理：应用死亡后 HTTP 桥随之消失，因此「注入」在桥内完成（/action chaos.*），
 * 「验证」在进程重启后进行（.bak 回退 / 全新库降级 / 迁移幂等补齐）。
 *
 * 注意：仅在 dev 数据目录生效（dev 模式数据与正式版隔离）。
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const MAIN = path.join(ROOT, 'out/main/index.js')
const PORT = 7465
const BASE = `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let app = null

function killAll() {
  try {
    require('child_process').execSync('taskkill /F /IM electron.exe >nul 2>&1')
  } catch { /* 无进程 */ }
  if (app) { try { app.kill('SIGKILL') } catch { /* ignore */ } }
  app = null
}

function spawnApp() {
  app = spawn(ELECTRON, [MAIN, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT,
    env: { ...process.env, KNOWBASE_DEV_BRIDGE: '1' },
    stdio: 'ignore',
  })
}

async function waitBridge(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return await r.json()
    } catch { /* 未就绪 */ }
    await sleep(1000)
  }
  throw new Error('桥未就绪（超时）')
}

async function post(pathname, body) {
  const r = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  return r.json()
}

async function getDbPath() {
  const h = await waitBridge()
  return h?.data?.db?.path
}

function assert(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`)
  if (!cond) process.exitCode = 1
}

async function withFreshApp(fn) {
  killAll()
  await sleep(800)
  spawnApp()
  const h = await waitBridge()
  console.log(`  桥就绪: ${h?.data?.db?.path}`)
  return fn()
}

async function scenarioCorruptMain() {
  console.log('\n[场景 1] 主库损坏 → .bak 自动回退')
  const dbPath = await withFreshApp(async () => {
    const r = await post('/action', { name: 'chaos.corruptMainDb', params: { confirm: true } })
    assert(r.ok, `注入主库损坏: ${r.data?.result?.corrupted}`)
    return (await getDbPath()).replace('\\', '\\\\')
  })
  killAll()
  await sleep(800)
  spawnApp()
  const h = await waitBridge()
  assert(h.ok, '重启后应用可启动（桥响应）')
  const q = await post('/db/query', { sql: 'SELECT count(*) AS c FROM _migrations' })
  assert(q.ok, `重启后数据库可查询（.bak 回退或全新库）: ${JSON.stringify(q.data?.rows?.[0])}`)
  // 主库损坏现场应留存
  const parent = path.dirname(dbPath)
  const corrupt = fs.readdirSync(parent).filter((f) => f.includes('.corrupt-'))
  assert(corrupt.length > 0, `损坏现场已留存: ${corrupt.join(', ') || '未找到'}`)
  console.log(`  提示: 若需还原原库（含 .pre-chaos 备份），见 chaos.restoreMainDb`)
}

async function scenarioCorruptBak() {
  console.log('\n[场景 2] 主库 + .bak 双损坏 → 全新库降级')
  const dbPath = await withFreshApp(async () => {
    // 先确保 .bak 存在：做一次写操作触发保存
    await post('/action', { name: 'data.seed', params: { scenario: 'blog30d', days: 1 } })
    const r = await post('/action', { name: 'chaos.corruptBak', params: { confirm: true } })
    assert(r.ok, `注入 .bak 损坏: ${r.data?.result?.corrupted}`)
    return (await getDbPath())
  })
  // 双损坏：主库与 .bak 都坏了，必须从全新库启动（不崩溃、不卡死）
  killAll()
  await sleep(800)
  spawnApp()
  const h = await waitBridge()
  assert(h.ok, '双损坏后应用仍可启动（全新库降级，未崩溃死循环）')
}

async function scenarioHalfMigrated() {
  console.log('\n[场景 3] 中断库（表已建、标记丢失）→ 迁移幂等补齐')
  const dbPath = await withFreshApp(async () => {
    const r = await post('/action', { name: 'chaos.halfMigratedDb', params: { confirm: true } })
    assert(r.ok, `已生成中断库: ${r.data?.result?.path}`)
    return { current: await getDbPath(), chaos: r.data?.result?.path, lost: r.data?.result?.lostMarkers }
  })
  killAll()
  await sleep(800)
  // 用中断库替换当前库（先备份原件）
  const backup = dbPath.current + '.pre-chaos-test'
  fs.copyFileSync(dbPath.current, backup)
  fs.copyFileSync(dbPath.chaos, dbPath.current)
  spawnApp()
  const h = await waitBridge()
  assert(h.ok, '中断库启动成功（桥响应）')
  const s = await (await fetch(`${BASE}/db/schema`)).json()
  const tableCount = s?.data?.tableCount
  assert(tableCount >= 30, `表结构完整（${tableCount} 张）`)
  const q = await post('/db/query', { sql: "SELECT count(*) AS c FROM _migrations WHERE name IN ('047_knowledge_pack_imports','048_habit_links')" })
  const c = q?.data?.rows?.[0]?.c
  assert(Number(c) === 2, `丢失的标记已补齐（最新迁移存在: ${c}/2）: 丢失标记 ${JSON.stringify(dbPath.lost)}`)
  console.log(`  提示: 测试库为 ${dbPath.current}，原件在 ${backup}，恢复正常开发请用原件替换回来`)
}

async function main() {
  const arg = process.argv[2]?.replace('--scenario=', '') || 'all'
  const scenarios = {
    'corrupt-main': [scenarioCorruptMain],
    'corrupt-bak': [scenarioCorruptBak],
    'half-migrated': [scenarioHalfMigrated],
    all: [scenarioCorruptMain, scenarioCorruptBak, scenarioHalfMigrated],
  }
  const list = scenarios[arg]
  if (!list) {
    console.error('未知场景，可用: corrupt-main / corrupt-bak / half-migrated / all')
    process.exit(2)
  }
  console.log('注意: 脚本会反复杀/启 electron，且数据目录为 dev 隔离目录。开始...')
  try {
    for (const fn of list) await fn()
  } finally {
    killAll()
  }
  console.log(process.exitCode ? '\n有断言失败' : '\n全部场景通过')
}

main().catch((e) => {
  console.error('脚本失败:', e.message)
  killAll()
  process.exit(1)
})
