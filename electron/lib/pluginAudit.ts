import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../database/connection'

/**
 * 行为审计日志 —— 追加式记录插件与 AI 工具的关键动作。
 * 表结构见迁移 044（plugin_audit_log）；写入方：工具调用、后续的插件安装/授权等（tiers 方案复用）。
 * 约定：detail 只存摘要（入参截断、不含敏感正文），created_at 由 SQLite 默认值生成（本地时间）。
 */

/** 追加一条审计记录并持久化 */
export function appendAudit(pluginId: string, action: string, detail: Record<string, unknown> = {}): void {
  try {
    getDatabase().run(
      'INSERT INTO plugin_audit_log (id, plugin_id, action, detail) VALUES (?, ?, ?, ?)',
      [randomUUID(), pluginId || '', action, JSON.stringify(detail)]
    )
    saveToDisk()
  } catch (err) {
    // 审计失败不阻断业务调用
    console.error('[audit] 写入失败:', err)
  }
}

export interface AuditEntry {
  id: string
  pluginId: string
  action: string
  detail: string
  createdAt: string
}

/** 最近 N 条审计记录（新在前），可按动作前缀集合过滤 */
export function listAudit(limit = 20, actionPrefixes: string[] = []): AuditEntry[] {
  const db = getDatabase()
  const capped = Math.max(1, Math.min(200, Math.round(limit) || 20))
  if (actionPrefixes.length === 0) {
    const stmt = db.prepare(
      `SELECT id, plugin_id, action, detail, created_at FROM plugin_audit_log
       ORDER BY created_at DESC, rowid DESC LIMIT ${capped}`
    )
    return drainAudit(stmt)
  }
  // 每个前缀一个 LIKE 条件，LIMIT 取并集后截断
  const conds = actionPrefixes.map(() => 'action LIKE ?').join(' OR ')
  const stmt = db.prepare(
    `SELECT id, plugin_id, action, detail, created_at FROM plugin_audit_log
     WHERE ${conds}
     ORDER BY created_at DESC, rowid DESC LIMIT ${capped}`
  )
  stmt.bind(actionPrefixes.map(p => `${p}%`))
  return drainAudit(stmt)
}

function drainAudit(stmt: { step: () => boolean; getAsObject: () => unknown; free: () => void }): AuditEntry[] {
  const rows: AuditEntry[] = []
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>
    rows.push({
      id: String(r.id ?? ''),
      pluginId: String(r.plugin_id ?? ''),
      action: String(r.action ?? ''),
      detail: String(r.detail ?? '{}'),
      createdAt: String(r.created_at ?? ''),
    })
  }
  stmt.free()
  return rows
}

/** 入参摘要：JSON 序列化后截断，防止超大入参撑爆审计表 */
export function summarizeArgs(args: unknown, maxChars = 200): string {
  let s: string
  try { s = JSON.stringify(args ?? {}) } catch { s = String(args) }
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…'
  return s
}

/**
 * 本月（本地时区自然月）工具调用次数。
 * 统计范围：action IN ('tool.invoke', 'mcp.invoke') 的所有调用（成败都算），
 * 与「月度调用上限」设置配合拦截失控循环调用。
 */
export function countMonthInvocations(): number {
  const db = getDatabase()
  const stmt = db.prepare(
    `SELECT COUNT(*) AS n FROM plugin_audit_log
     WHERE action IN ('tool.invoke', 'mcp.invoke')
       AND substr(created_at, 1, 7) = strftime('%Y-%m', 'now', 'localtime')`
  )
  let n = 0
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>
    n = Number(r.n ?? 0)
  }
  stmt.free()
  return n
}

/** 本月 LLM 消耗 token 总量（读审计聚合，供预算硬限制使用；无记录返回 0） */
export function countMonthLlmTokens(): number {
  const db = getDatabase()
  const stmt = db.prepare(
    `SELECT detail FROM plugin_audit_log
     WHERE action = 'llm.invoke'
       AND substr(created_at, 1, 7) = strftime('%Y-%m', 'now', 'localtime')`
  )
  let total = 0
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>
    try {
      const d = JSON.parse(String(r.detail ?? '{}')) as { tokens?: number }
      if (Number.isFinite(d.tokens)) total += Number(d.tokens)
    } catch { /* 跳过损坏条目 */ }
  }
  stmt.free()
  return total
}
