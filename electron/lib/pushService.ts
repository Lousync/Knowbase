import { getDatabase, saveToDisk } from '../database/connection'
import { adaptPush, type SupervisePlatform, type SupervisePushConfig, type PushPayload } from './pushAdapters'

/**
 * 远程监督推送服务 —— 配置读写、免打扰判断、带重试的 webhook 发送、
 * 打卡即时通知、每日汇总定时任务。由 superviseRepo 注册 IPC，
 * 由 checkinRepo 的打卡钩子触发即时推送。
 */

// ===== 配置（存 supervise_config KV 表，避免与 settings 模块耦合） =====

export interface SuperviseConfig extends SupervisePushConfig {
  enabled: boolean
  instantPush: boolean
  dailyPush: boolean
  /** HH:mm */
  dailyTime: string
  /** 免打扰起止 HH:mm，空串 = 不启用；支持跨天区间（如 23:00~07:00） */
  quietStart: string
  quietEnd: string
}

const CONFIG_DEFAULTS: SuperviseConfig = {
  enabled: false,
  platform: 'serverchan' as SupervisePlatform,
  webhookUrl: '',
  secret: '',
  instantPush: true,
  dailyPush: false,
  dailyTime: '22:00',
  quietStart: '',
  quietEnd: '',
}

interface ConfigRow { key: string; value: string }

export function getSuperviseConfig(): SuperviseConfig {
  const db = getDatabase()
  const stmt = db.prepare('SELECT key, value FROM supervise_config')
  const rows: ConfigRow[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as ConfigRow)
  stmt.free()
  const cfg = { ...CONFIG_DEFAULTS }
  for (const row of rows) {
    if (row.key in cfg) {
      const v = row.value
      ;(cfg as unknown as Record<string, unknown>)[row.key] =
        v === 'true' ? true : v === 'false' ? false : v
    }
  }
  return cfg
}

export function saveSuperviseConfig(partial: Partial<SuperviseConfig>): SuperviseConfig {
  const db = getDatabase()
  const merged = { ...getSuperviseConfig(), ...partial }
  for (const [key, value] of Object.entries(merged)) {
    db.run(
      `INSERT INTO supervise_config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, String(value)]
    )
  }
  saveToDisk()
  return getSuperviseConfig()
}

// ===== 日志 =====

interface LogRow {
  id: number; push_type: string; habit_id: string | null
  title: string; content: string; status: string
  retry_count: number; error_message: string | null
  created_at: string; pushed_at: string | null
}

function insertLog(pushType: 'instant' | 'daily', habitId: string | null, title: string, content: string): number {
  const db = getDatabase()
  db.run(
    `INSERT INTO supervise_log (push_type, habit_id, title, content, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now', 'localtime'))`,
    [pushType, habitId, title, content]
  )
  const stmt = db.prepare('SELECT last_insert_rowid() AS id')
  let id = 0
  while (stmt.step()) id = (stmt.getAsObject() as { id: number }).id
  stmt.free()
  saveToDisk()
  return id
}

function updateLogStatus(id: number, status: 'success' | 'failed' | 'pending', error?: string): void {
  getDatabase().run(
    `UPDATE supervise_log
     SET status = ?, retry_count = retry_count + 1, error_message = ?,
         pushed_at = CASE WHEN ? = 'success' THEN datetime('now', 'localtime') ELSE pushed_at END
     WHERE id = ?`,
    [status, error ?? null, status, id]
  )
  saveToDisk()
}

// ===== 免打扰 =====

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function isInQuietHours(cfg: SuperviseConfig, now = new Date()): boolean {
  if (!cfg.quietStart || !cfg.quietEnd) return false
  if (!/^\d{1,2}:\d{2}$/.test(cfg.quietStart) || !/^\d{1,2}:\d{2}$/.test(cfg.quietEnd)) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = toMinutes(cfg.quietStart)
  const end = toMinutes(cfg.quietEnd)
  // 跨天区间（23:00~07:00）与非跨天统一判断
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end
}

// ===== 发送（带重试：1s / 5s / 15s） =====

const RETRY_DELAYS_MS = [1000, 5000, 15000]
const FETCH_TIMEOUT_MS = 10000

async function postOnce(url: string, body: string, contentType?: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: contentType ? { 'Content-Type': contentType } : undefined,
      body,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // 各平台失败也返回 200，错误信息在响应体里
    const text = await res.text()
    if (text.includes('"errcode"') && !text.includes('"errcode":0')) {
      throw new Error(text.slice(0, 300))
    }
    if (text.includes('"code"') && text.includes('"message":"error"')) {
      throw new Error(text.slice(0, 300))
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 投递一条日志：内部重试，最终状态写回日志表 */
export async function deliverLog(id: number): Promise<{ ok: boolean; error?: string }> {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM supervise_log WHERE id = ?')
  stmt.bind([id])
  let row: LogRow | null = null
  while (stmt.step()) row = stmt.getAsObject() as LogRow
  stmt.free()
  if (!row) return { ok: false, error: '日志不存在' }

  const cfg = getSuperviseConfig()
  const payload: PushPayload = { title: row.title, contentMd: row.content }
  let lastError = ''
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const req = adaptPush(payload, cfg)
      await postOnce(req.url, req.body, req.contentType)
      updateLogStatus(id, 'success')
      return { ok: true }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[supervise] 推送失败(第 ${attempt + 1} 次):`, lastError)
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
      }
    }
  }
  updateLogStatus(id, 'failed', lastError.slice(0, 500))
  return { ok: false, error: lastError }
}

/** 直接发送（测试用）：不写日志、不重试 */
export async function testPush(cfg: SuperviseConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const req = adaptPush(
      { title: 'Knowbase 测试消息', contentMd: '这是一条测试消息，收到说明远程监督推送配置成功 ✅' },
      cfg
    )
    await postOnce(req.url, req.body, req.contentType)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ===== 即时推送（打卡钩子） =====

function todayStr(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 简化连续天数：从今天（无记录则从昨天）向前数连续有记录的天数 */
function plainStreak(habitId: string): number {
  const db = getDatabase()
  const stmt = db.prepare('SELECT date FROM habit_records WHERE habit_id = ?')
  stmt.bind([habitId])
  const dates = new Set<string>()
  while (stmt.step()) dates.add((stmt.getAsObject() as { date: string }).date)
  stmt.free()
  let streak = 0
  const cursor = new Date()
  if (!dates.has(todayStr(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (dates.has(todayStr(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 打卡成功后的即时通知入口（checkinRepo 钩子调用）；静默失败，不影响打卡 */
export async function notifyCheckin(habitId: string, date: string): Promise<void> {
  try {
    const cfg = getSuperviseConfig()
    if (!cfg.enabled || !cfg.instantPush || !cfg.webhookUrl) return
    const db = getDatabase()
    const stmt = db.prepare('SELECT name FROM habits WHERE id = ?')
    stmt.bind([habitId])
    let name = ''
    while (stmt.step()) name = (stmt.getAsObject() as { name: string }).name
    stmt.free()
    if (!name) return
    const streak = plainStreak(habitId)
    const title = `✅ 打卡「${name}」`
    const content = [
      `**${name}** 打卡成功`,
      `- 日期：${date}`,
      streak > 1 ? `- 连续打卡：${streak} 天` : '',
      '',
      `> 来自 Knowbase 远程监督`,
    ].filter(Boolean).join('\n')
    const id = insertLog('instant', habitId, title, content)
    if (isInQuietHours(cfg)) {
      console.log('[supervise] 免打扰时段，推送挂起待补发:', id)
      return
    }
    await deliverLog(id)
  } catch (err) {
    console.error('[supervise] 即时推送异常:', err)
  }
}

// ===== 每日汇总 =====

interface HabitNameRow { id: string; name: string }

async function buildDailySummary(date: string): Promise<PushPayload> {
  const db = getDatabase()
  const habits: HabitNameRow[] = []
  const stmt = db.prepare("SELECT id, name FROM habits WHERE archived = 0 ORDER BY sort_order ASC")
  while (stmt.step()) habits.push(stmt.getAsObject() as HabitNameRow)
  stmt.free()
  const done = new Set<string>()
  const rstmt = db.prepare('SELECT habit_id FROM habit_records WHERE date = ?')
  rstmt.bind([date])
  while (rstmt.step()) done.add((rstmt.getAsObject() as { habit_id: string }).habit_id)
  rstmt.free()

  const lines = habits.map(h => `- ${done.has(h.id) ? '✅' : '⬜'} ${h.name}`)
  const count = habits.filter(h => done.has(h.id)).length
  return {
    title: `📋 每日汇总：${count}/${habits.length} 完成`,
    contentMd: [
      `**${date} 打卡情况：${count}/${habits.length} 完成**`,
      ...(lines.length > 0 ? lines : ['- （暂无习惯）']),
      '',
      `> 来自 Knowbase 远程监督`,
    ].join('\n'),
  }
}

function hasDailySentToday(date: string): boolean {
  const db = getDatabase()
  // 含 failed：自动模式每天只尝试一次，失败靠历史页手动重推，避免调度器反复轰炸
  // created_at 已存本地时间（insertLog 显式 localtime），此处直接比较
  const stmt = db.prepare(
    "SELECT COUNT(*) AS n FROM supervise_log WHERE push_type = 'daily' AND status IN ('success','pending','failed') AND date(created_at) = ?"
  )
  stmt.bind([date])
  let n = 0
  while (stmt.step()) n = (stmt.getAsObject() as { n: number }).n
  stmt.free()
  return n > 0
}

/** 发送每日汇总；force = 手动触发（跳过去重与开关） */
export async function sendDailySummary(force = false): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const cfg = getSuperviseConfig()
  if (!force && (!cfg.enabled || !cfg.dailyPush)) return { ok: false, skipped: '未启用每日汇总' }
  if (!cfg.webhookUrl) return { ok: false, skipped: '未配置 webhook' }
  const date = todayStr()
  if (!force && hasDailySentToday(date)) return { ok: false, skipped: '今日已发送过汇总' }
  const payload = await buildDailySummary(date)
  const id = insertLog('daily', null, payload.title, payload.contentMd)
  if (!force && isInQuietHours(cfg)) return { ok: false, skipped: '免打扰时段，已挂起待补发' }
  return deliverLog(id)
}

// ===== 定时调度 =====

let schedulerTimer: ReturnType<typeof setInterval> | null = null

/** 补发所有 pending 日志（免打扰结束后由调度器调用） */
async function flushPending(): Promise<void> {
  const cfg = getSuperviseConfig()
  if (!cfg.enabled || isInQuietHours(cfg) || !cfg.webhookUrl) return
  const db = getDatabase()
  const stmt = db.prepare("SELECT id FROM supervise_log WHERE status = 'pending'")
  const ids: number[] = []
  while (stmt.step()) ids.push((stmt.getAsObject() as { id: number }).id)
  stmt.free()
  for (const id of ids) await deliverLog(id)
}

/** 启动调度器：每 30s 检查每日汇总时间点与待补发队列；启动时先跑一轮处理隔夜漏发 */
export function startSuperviseScheduler(): void {
  const tick = async (): Promise<void> => {
    try {
      const cfg = getSuperviseConfig()
      if (!cfg.enabled) return
      // 每日汇总：已过配置时间且今天还没尝试过（启动晚于时间点也会补发一次）
      if (cfg.dailyPush && /^\d{1,2}:\d{2}$/.test(cfg.dailyTime)) {
        const now = new Date()
        const target = toMinutes(cfg.dailyTime)
        const nowMin = now.getHours() * 60 + now.getMinutes()
        if (nowMin >= target && !hasDailySentToday(todayStr(now))) {
          await sendDailySummary(false)
        }
      }
      await flushPending()
    } catch (err) {
      console.error('[supervise] 调度器异常:', err)
    }
  }
  void tick()
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = setInterval(() => void tick(), 30000)
}

export function stopSuperviseScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}
