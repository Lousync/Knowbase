import { randomUUID } from 'crypto'
import { globalReadJson, globalWriteJson } from './globalJsonStore'

/** R6 去库化（D9）：AI 会话 = userData/data/agent-*.json（sql.js 已移除）
 *  会话 + 消息两级（迁移 046），删除会话级联清消息。
 *  两文件：agent-sessions.json / agent-messages.json，行结构与原表列名（snake_case）一致；
 *  数组顺序即原 rowid 顺序（只 push / filter，不重排存储数组），用于平局排序与「删某条之后」语义。
 */

const SESSIONS_FILE = 'agent-sessions.json'
const MESSAGES_FILE = 'agent-messages.json'

/**
 * 会话来源：用于把「通用 AI 助手」（侧栏 / AI 学堂）与「AI 教学」的会话列表互相隔离。
 * 二者共用同一张会话表（同一份存储、同一套 AgentRunner），只在列表展示上按来源分流。
 */
export type AgentSessionSource = 'assistant' | 'aiTeaching'

export interface AgentSessionRow {
  id: string
  title: string
  /** 会话级全局要求（056 迁移；空串=无） */
  instructions?: string
  /** 来源（缺省=assistant；存量老数据无此字段，由 backfillSessionSources 回填） */
  source?: AgentSessionSource
  created_at: string
  updated_at: string
}

export interface AgentMessageRow {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  trace_json: string | null
  created_at: string
}

/** 等价 datetime('now','localtime')：本地时间 "YYYY-MM-DD HH:MM:SS" */
function nowLocal(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function readSessions(): AgentSessionRow[] {
  return globalReadJson<AgentSessionRow[]>(SESSIONS_FILE, [])
}

function readMessages(): AgentMessageRow[] {
  return globalReadJson<AgentMessageRow[]>(MESSAGES_FILE, [])
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

export function deleteAgentSession(id: string): void {
  // 显式先删子消息（不依赖原 SQL 外键级联）
  const messages = readMessages()
  const keptMessages = messages.filter((m) => m.session_id !== id)
  if (keptMessages.length !== messages.length) globalWriteJson(MESSAGES_FILE, keptMessages)
  const sessions = readSessions()
  const keptSessions = sessions.filter((s) => s.id !== id)
  if (keptSessions.length !== sessions.length) globalWriteJson(SESSIONS_FILE, keptSessions)
}

export function sessionExists(id: string): boolean {
  return readSessions().some((s) => s.id === id)
}

/** 追加消息并刷新会话活跃时间 */
export function appendAgentMessage(sessionId: string, role: 'user' | 'assistant', content: string, trace?: unknown): void {
  const messages = readMessages()
  messages.push({
    id: randomUUID(),
    session_id: sessionId,
    role,
    content,
    trace_json: trace ? JSON.stringify(trace) : null,
    created_at: nowLocal(),
  })
  globalWriteJson(MESSAGES_FILE, messages)
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
  return readMessages()
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.session_id === sessionId)
    .sort((a, b) => {
      if (a.m.created_at !== b.m.created_at) return a.m.created_at < b.m.created_at ? -1 : 1
      return a.i - b.i
    })
    .slice(0, 500)
    .map((x) => x.m)
}

export function getMessageById(id: string): AgentMessageRow | null {
  return readMessages().find((m) => m.id === id) ?? null
}

/** 编辑消息内容（仅用于用户消息改写后重推） */
export function updateMessageContent(id: string, content: string): void {
  const messages = readMessages()
  const row = messages.find((m) => m.id === id)
  if (!row) return
  row.content = content
  row.trace_json = null
  globalWriteJson(MESSAGES_FILE, messages)
}

export function deleteMessage(id: string): void {
  globalWriteJson(MESSAGES_FILE, readMessages().filter((m) => m.id !== id))
}

/** 删除某条消息之后的所有消息（重新生成/编辑重推时清掉旧回复） */
export function deleteMessagesAfter(sessionId: string, messageId: string): void {
  // 数组下标即原 rowid：删除同会话中下标大于该消息的消息
  const messages = readMessages()
  const idx = messages.findIndex((m) => m.id === messageId)
  if (idx === -1) return
  globalWriteJson(MESSAGES_FILE, messages.filter((m, i) => !(m.session_id === sessionId && i > idx)))
}
