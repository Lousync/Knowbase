import { randomUUID } from 'crypto'
import { globalReadJson, globalWriteJson, globalDataDir } from './globalJsonStore'
import {
  appendMessage, deleteMessageById, deleteMessagesAfterId, deleteMessagesFile,
  getMessagesPage, migrateLegacyMessages, readMessages, updateMessageContent as storeUpdateMessageContent,
  type AgentMessageRow,
} from './agentMessageStore'

export type { AgentMessageRow }

/**
 * R6 去库化（D9）：AI 会话 = userData/data/*.json（sql.js 已移除）。
 * 会话索引 = agent-sessions.json（小文件，全量重写可接受，保持不变）；
 * 消息 = agent-messages/<sessionId>.jsonl 按会话分文件追加写（v2，agentMessageStore），
 * 替代 v1 的 agent-messages.json 全量双文件（每条消息 O(全部历史) 重写，已迁移）。
 * 删除会话级联清消息文件；首次消息操作触发 legacy 一次性迁移。
 *
 * 会话 + 消息两级（迁移 046）；
 * 行结构与原表列名（snake_case）一致；会话数组顺序即原 rowid 顺序（只 push / filter，
 * 不重排存储数组），用于平局排序；消息文件行序 = 会话内插入序（v1 rowid 等价物）。
 */

const SESSIONS_FILE = 'agent-sessions.json'

/**
 * 会话来源：用于把「通用 AI 助手」（侧栏 / AI 学堂）与「AI 教学」的会话列表互相隔离。
 * 二者共用同一张会话表（同一份存储、同一套 AgentRunner），只在列表展示上按来源分流。
 */
export type AgentSessionSource = 'assistant' | 'aiTeaching'

/** 会话压缩纪要（docs/conversation-compaction-design.md）：覆盖 upto_id 及之前的消息 */
export interface SessionDigest {
  /** 纪要正文（markdown，生成侧 ≤4000 chars 截断保护） */
  text: string
  /** 检查点：已纳入纪要的最后一条消息 id（之后的消息仍以原文进上下文） */
  upto_id: string
  /** 累计被折叠的消息条数（跨多次增量压缩累加） */
  covered: number
  updated_at: string
}

export interface AgentSessionRow {
  id: string
  title: string
  /** 会话级全局要求（056 迁移；空串=无） */
  instructions?: string
  /** 来源（缺省=assistant；存量老数据无此字段，由 backfillSessionSources 回填） */
  source?: AgentSessionSource
  created_at: string
  updated_at: string
  /** 会话压缩纪要（缺省=未压缩）。原消息永不删除，置 null 即回滚 */
  digest?: SessionDigest
}

/** 等价 datetime('now','localtime')：本地时间 "YYYY-MM-DD HH:MM:SS" */
export function nowLocal(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function readSessions(): AgentSessionRow[] {
  return globalReadJson<AgentSessionRow[]>(SESSIONS_FILE, [])
}

/** legacy 全量文件 → 分文件，进程内一次性（失败不置位，下次消息操作重试） */
let legacyMigrated = false
function ensureMigrated(): void {
  if (legacyMigrated) return
  try {
    const r = migrateLegacyMessages(globalDataDir())
    if (r) {
      console.log(`[AgentSessions] 旧版全量消息已迁移：${r.sessions} 会话 / ${r.messages} 条 → agent-messages/*.jsonl（原文件留存为 agent-messages.migrated.json）`)
    }
    legacyMigrated = true
  } catch (err) {
    console.error('[AgentSessions] 旧版消息迁移失败（原文件保留，下次操作重试；本次按 v2 读取）', err)
  }
}

export function createAgentSession(title = '新会话', source: AgentSessionSource = 'assistant'): AgentSessionRow {
  const row: AgentSessionRow = {
    id: randomUUID(),
    title,
    instructions: '',
    source,
    created_at: nowLocal(),
    updated_at: nowLocal(),
  }
  const sessions = readSessions()
  sessions.push(row)
  globalWriteJson(SESSIONS_FILE, sessions)
  return row
}

/**
 * 存量会话来源回填：老数据没有 source 字段，调用方传入推断函数。
 *
 * @param infer 返回 'aiTeaching' 表示判定为教学会话；返回 null 表示"判不出来"
 * @param overwrite 修正模式。默认 false（初始化）：source 缺省的一律定性，判不出来算 assistant。
 *   置 true（修正）：**允许覆盖已标记的条目**，但只在 infer 明确返回来源时才改 ——
 *   用于修复"上一轮回填判据不全、把教学会话误标成 assistant"的历史数据
 *   （2026-09-10 实况：只按工作区归属判定，漏掉了未分配工作区的教学会话）。
 * @returns 实际写入的条数
 */
export function backfillSessionSources(
  infer: (id: string, title: string) => AgentSessionSource | null,
  overwrite = false,
): number {
  const sessions = readSessions()
  let n = 0
  for (const s of sessions) {
    const src = infer(s.id, s.title)
    if (overwrite) {
      if (src && src !== s.source) { s.source = src; n++ }
    } else if (!s.source) {
      s.source = src ?? 'assistant'
      n++
    }
  }
  if (n > 0) globalWriteJson(SESSIONS_FILE, sessions)
  return n
}

export function listAgentSessions(): AgentSessionRow[] {
  // 原 SQL：ORDER BY updated_at DESC, rowid DESC LIMIT 200
  return readSessions()
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      if (a.s.updated_at !== b.s.updated_at) return a.s.updated_at < b.s.updated_at ? 1 : -1
      return b.i - a.i
    })
    .slice(0, 200)
    .map((x) => x.s)
}

export function renameAgentSession(id: string, title: string): void {
  const sessions = readSessions()
  const row = sessions.find((s) => s.id === id)
  if (!row) return
  row.title = title
  row.updated_at = nowLocal()
  globalWriteJson(SESSIONS_FILE, sessions)
}

/** 会话级全局要求（≤800 字；空串=清除）：只在本会话的后续轮次注入 system */
export function updateAgentSessionInstructions(id: string, instructions: string): void {
  const text = String(instructions ?? '').trim().slice(0, 800)
  const sessions = readSessions()
  const row = sessions.find((s) => s.id === id)
  if (!row) return
  row.instructions = text
  row.updated_at = nowLocal()
  globalWriteJson(SESSIONS_FILE, sessions)
}

export function getAgentSession(id: string): AgentSessionRow | undefined {
  return readSessions().find((s) => s.id === id)
}

/**
 * 写回/清除会话压缩纪要（null = 清除，即回滚到未压缩态）。
 * 不动 updated_at：会话列表排序由消息活跃驱动，压缩本身不应把会话顶到最上。
 */
export function updateSessionDigest(id: string, digest: SessionDigest | null): void {
  const sessions = readSessions()
  const row = sessions.find((s) => s.id === id)
  if (!row) return
  if (digest) row.digest = digest
  else delete row.digest
  globalWriteJson(SESSIONS_FILE, sessions)
}

export function deleteAgentSession(id: string): void {
  // 显式先删子消息（不依赖原 SQL 外键级联；v2 = 删整个会话消息文件）
  ensureMigrated()
  deleteMessagesFile(globalDataDir(), id)
  const sessions = readSessions()
  const keptSessions = sessions.filter((s) => s.id !== id)
  if (keptSessions.length !== sessions.length) globalWriteJson(SESSIONS_FILE, keptSessions)
}

export function sessionExists(id: string): boolean {
  return readSessions().some((s) => s.id === id)
}

/** 追加消息并刷新会话活跃时间（消息落盘 = 单行 append，O(本条消息)） */
export function appendAgentMessage(sessionId: string, role: 'user' | 'assistant', content: string, trace?: unknown): void {
  ensureMigrated()
  appendMessage(globalDataDir(), {
    id: randomUUID(),
    session_id: sessionId,
    role,
    content,
    trace_json: trace ? JSON.stringify(trace) : null,
    created_at: nowLocal(),
  })
  const sessions = readSessions()
  const row = sessions.find((s) => s.id === sessionId)
  if (row) {
    row.updated_at = nowLocal()
    globalWriteJson(SESSIONS_FILE, sessions)
  }
}

/** 首条用户消息自动成为会话标题（仅当仍是默认标题时） */
export function ensureSessionTitle(sessionId: string, firstUserMessage: string): void {
  const row = getAgentSession(sessionId)
  if (!row) return
  if (!row.title || row.title === '新会话') {
    const title = firstUserMessage.replace(/\s+/g, ' ').trim().slice(0, 20) || '新会话'
    renameAgentSession(sessionId, title)
  }
}

export function getAgentMessages(sessionId: string): AgentMessageRow[] {
  // 原 SQL：WHERE session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 500（取最早 500 条）
  ensureMigrated()
  return getMessagesPage(globalDataDir(), sessionId)
}

export function getMessageById(sessionId: string, id: string): AgentMessageRow | null {
  ensureMigrated()
  return readMessages(globalDataDir(), sessionId).find((m) => m.id === id) ?? null
}

/**
 * 消息删改与纪要一致性（压缩设计 §13）：删改命中纪要覆盖范围时作废 digest，
 * 下次压缩自动重建。mode 'at' = 目标消息本身被删/改（位置 ≤ 检查点即作废）；
 * mode 'after' = 目标之后的消息被删（检查点被删才作废，即检查点位置 > 锚点位置）。
 */
function invalidateDigestOnMutation(sessionId: string, targetId: string, mode: 'at' | 'after'): void {
  try {
    const row = getAgentSession(sessionId)
    if (!row?.digest) return
    const rows = getAgentMessages(sessionId)
    const uptoIdx = rows.findIndex((m) => m.id === row.digest!.upto_id)
    if (uptoIdx === -1) {
      updateSessionDigest(sessionId, null)
      return
    }
    const tIdx = rows.findIndex((m) => m.id === targetId)
    if (tIdx === -1) return
    const covered = mode === 'at' ? tIdx <= uptoIdx : tIdx < uptoIdx
    if (covered) updateSessionDigest(sessionId, null)
  } catch { /* 一致性作废失败不阻断消息操作本身 */ }
}

/** 编辑消息内容（仅用于用户消息改写后重推） */
export function updateMessageContent(sessionId: string, id: string, content: string): void {
  ensureMigrated()
  storeUpdateMessageContent(globalDataDir(), sessionId, id, content)
  invalidateDigestOnMutation(sessionId, id, 'at')
}

export function deleteMessage(sessionId: string, id: string): void {
  ensureMigrated()
  deleteMessageById(globalDataDir(), sessionId, id)
  invalidateDigestOnMutation(sessionId, id, 'at')
}

/** 删除某条消息之后的所有消息（重新生成/编辑重推时清掉旧回复） */
export function deleteMessagesAfter(sessionId: string, messageId: string): void {
  ensureMigrated()
  deleteMessagesAfterId(globalDataDir(), sessionId, messageId)
  invalidateDigestOnMutation(sessionId, messageId, 'after')
}
