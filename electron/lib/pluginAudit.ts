// R6 去库化（D9）：全局数据 = userData/data/*.json（sql.js 已移除）
import { randomUUID } from 'crypto'
import { globalReadJson, globalWriteJson } from './globalJsonStore'

/**
 * 行为审计日志 —— 追加式记录插件与 AI 工具的关键动作。
 * 原表结构见迁移 044（plugin_audit_log）；写入方：工具调用、后续的插件安装/授权等（tiers 方案复用）。
 * 约定：detail 只存摘要（入参截断、不含敏感正文），created_at 为本地时间（对齐原 SQLite 默认值格式）。
 * 存储：userData/data/plugin-audit.json（数组顺序即写入顺序，对齐原 rowid 语义）。
 */

/** 审计行（snake_case 结构对齐原 plugin_audit_log 表） */
export interface AuditRow {
  id: string
  plugin_id: string
  action: string
  detail: string
  created_at: string
}

const AUDIT_FILE = 'plugin-audit.json'

function readAuditRows(): AuditRow[] {
  return globalReadJson<AuditRow[]>(AUDIT_FILE, [])
}

/** 本地时间戳，格式对齐 SQLite datetime('now','localtime')："YYYY-MM-DD HH:MM:SS" */
function localTimestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 当前本地月份键："YYYY-MM"（对齐原 strftime('%Y-%m', 'now', 'localtime') 过滤语义） */
function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 追加一条审计记录并持久化 */
export function appendAudit(pluginId: string, action: string, detail: Record<string, unknown> = {}): void {
  try {
    const rows = readAuditRows()
    rows.push({
      id: randomUUID(),
      plugin_id: pluginId || '',
      action,
      detail: JSON.stringify(detail),
      created_at: localTimestamp(),
    })
    globalWriteJson(AUDIT_FILE, rows)
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
  const capped = Math.max(1, Math.min(200, Math.round(limit) || 20))
  // 数组按写入顺序排列；从尾部倒序遍历 = created_at DESC, rowid DESC
  const rows = readAuditRows()
  const out: AuditEntry[] = []
  for (let i = rows.length - 1; i >= 0 && out.length < capped; i--) {
    const r = rows[i]
    if (actionPrefixes.length > 0 && !actionPrefixes.some(p => r.action.startsWith(p))) continue
    out.push({ id: r.id, pluginId: r.plugin_id, action: r.action, detail: r.detail, createdAt: r.created_at })
  }
  return out
}

/** 原始行读取（供插件注册表审计列表 IPC 复用；按 plugin_id 过滤，新在前，默认 20 条） */
export function readAuditRaw(pluginId?: string, limit = 20): AuditRow[] {
  const capped = Math.max(0, Math.round(limit) || 20)
  const rows = readAuditRows()
  const out: AuditRow[] = []
  for (let i = rows.length - 1; i >= 0 && out.length < capped; i--) {
    const r = rows[i]
    if (pluginId && r.plugin_id !== pluginId) continue
    out.push(r)
  }
  return out
}

/** 清空审计记录（pluginId 缺省 = 全清） */
export function clearAudit(pluginId?: string): void {
  if (!pluginId) {
    globalWriteJson(AUDIT_FILE, [])
    return
  }
  globalWriteJson(AUDIT_FILE, readAuditRows().filter(r => r.plugin_id !== pluginId))
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
  const month = currentMonthKey()
  return readAuditRows().filter(
    r => (r.action === 'tool.invoke' || r.action === 'mcp.invoke') && r.created_at.startsWith(month)
  ).length
}

/** 本月 LLM 消耗 token 总量（读审计聚合，供预算硬限制使用；无记录返回 0） */
export function countMonthLlmTokens(): number {
  const month = currentMonthKey()
  let total = 0
  for (const r of readAuditRows()) {
    if (r.action !== 'llm.invoke' || !r.created_at.startsWith(month)) continue
    try {
      const d = JSON.parse(r.detail || '{}') as { tokens?: number }
      if (Number.isFinite(d.tokens)) total += Number(d.tokens)
    } catch { /* 跳过损坏条目 */ }
  }
  return total
}
