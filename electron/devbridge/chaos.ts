import { randomBytes } from 'crypto'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, writeFileSync, writeSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getDbPath, getSqlJs } from '../database/connection'
import { MIGRATIONS } from '../database/migrations'
import { zipBuffer } from '../lib/zip'
import { throwErr } from './response'

/**
 * 混沌注入 —— 主动布置灾难现场，验证项目的恢复机制
 * （.bak 回退 / 双损坏降级 / 备份导入预检 / Zip Slip 防护 / 迁移幂等）。
 *
 * 关键约束：应用死亡后 HTTP 桥也随之消失，因此「注入现场」在桥内完成，
 * 「重启后的恢复验证」由 scripts/chaos-verify.cjs 负责（spawn → 注入 → kill →
 * 重启 → 断言）。桥内动作返回的 warning 字段描述了正确的验证姿势。
 *
 * 所有动作都要求 confirm: true（在 actions/index.ts 统一拦截）。
 * corruptMainDb 会把原件另存为 *.pre-chaos，chaos.restoreMainDb 可还原。
 */

const CORRUPT_BYTES = 4096

function chaosDir(): string {
  const dir = join(app.getPath('userData'), 'devbridge-chaos')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 以不截断方式覆盖文件头部（SQLite 文件头被破坏 = 无法打开） */
function overwriteHead(filePath: string): void {
  const fd = openSync(filePath, 'r+')
  try {
    const buf = randomBytes(CORRUPT_BYTES)
    writeSync(fd, buf, 0, CORRUPT_BYTES, 0)
  } finally {
    closeSync(fd)
  }
}

const IMMEDIATE_KILL_WARNING =
  '现场已布置。请勿在应用内触发任何保存（saveToDisk 会覆盖坏文件）；验证脚本应立即 kill 进程后重启验证恢复。'

export function corruptMainDb(): { corrupted: string; originalSavedAs: string; warning: string } {
  if (app.isPackaged) throwErr('E_DISABLED', '生产环境禁止混沌注入')
  const dbPath = getDbPath()
  const original = `${dbPath}.pre-chaos`
  copyFileSync(dbPath, original)
  overwriteHead(dbPath)
  return { corrupted: dbPath, originalSavedAs: original, warning: IMMEDIATE_KILL_WARNING }
}

export function corruptBak(): { corrupted: string; warning: string } {
  const bakPath = `${getDbPath()}.bak`
  if (!existsSync(bakPath)) {
    throwErr('E_ACTION_FAILED', '.bak 不存在（当前库可能从未二次写盘）。先正常使用触发一次保存再试。')
  }
  overwriteHead(bakPath)
  return { corrupted: bakPath, warning: `${IMMEDIATE_KILL_WARNING} 双损坏场景：重启后应创建全新库而非崩溃死循环。` }
}

export function restoreMainDb(): { restored: boolean } {
  const dbPath = getDbPath()
  const original = `${dbPath}.pre-chaos`
  if (!existsSync(original)) {
    throwErr('E_ACTION_FAILED', '未找到 .pre-chaos 原件，无法还原')
  }
  copyFileSync(original, dbPath)
  return { restored: true }
}

export function malformedBackupZip(): { garbageZip: string; zipSlipZip: string; note: string } {
  const dir = chaosDir()

  // 坏包一：非法 ZIP（PK 头 + 随机垃圾）——测解析失败路径
  const garbageZip = join(dir, 'garbage.zip')
  writeFileSync(garbageZip, Buffer.concat([Buffer.from('PK\x03\x04'), randomBytes(2048)]))

  // 坏包二：结构合法但含路径穿越 entry —— 测逐条目路径校验
  const zipSlipZip = join(dir, 'zipslip.zip')
  writeFileSync(
    zipSlipZip,
    zipBuffer([
      { path: 'export.json', data: Buffer.from('{"version":"9.9.9"}') },
      { path: '../../evil-zipslip.txt', data: Buffer.from('pwned') },
      { path: 'attachments/../../../outside.txt', data: Buffer.from('pwned-2') },
    ])
  )

  return {
    garbageZip,
    zipSlipZip,
    note: '供导入流程验证：坏 ZIP 应被解析拒绝并给出可读错误；Zip Slip 应被路径校验拦截且原数据无损。',
  }
}

export function halfMigratedDb(): {
  path: string
  appliedMigrations: number
  lostMarkers: string[]
  expectation: string
} {
  // 取迁移链约 60% 处作为「当年版本」，再人为抹掉最后 3 条标记，
  // 模拟「表已建但标记丢失」的历史中断形态
  const n = Math.max(5, Math.floor(MIGRATIONS.length * 0.6))
  const SQL = getSqlJs()
  const db = new SQL.Database()
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    for (const m of MIGRATIONS.slice(0, n)) {
      m.up(db)
      db.run('INSERT INTO _migrations (name) VALUES (?)', [m.name])
    }
    const lost = MIGRATIONS.slice(Math.max(0, n - 3), n).map((m) => m.name)
    for (const name of lost) {
      db.run('DELETE FROM _migrations WHERE name = ?', [name])
    }

    const path = join(chaosDir(), `half-migrated-${Date.now()}.db`)
    writeFileSync(path, Buffer.from(db.export()))
    return {
      path,
      appliedMigrations: n - lost.length,
      lostMarkers: lost,
      expectation:
        '用此文件替换 knowledge.db 后启动：被抹标记的迁移会重跑，必须靠 IF NOT EXISTS / try-catch 幂等通过；应用正常打开且 _migrations 补齐到最新。',
    }
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}
