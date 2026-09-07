import { randomUUID } from 'crypto'
import { globalReadJson, globalWriteJson } from './globalJsonStore'

/** R6 去库化（D9）：AI 会话 = userData/data/agent-*.json（sql.js 已移除）
 *  会话 + 消息两级（迁移 046），删除会话级联清消息。
 *  两文件：agent-sessions.json / agent-messages.json，行结构与原表列名（snake_case）一致；
 *  数组顺序即原 rowid 顺序（只 push / filter，不重排存储数组），用于平局排序与「删某条之后」语义。
 */

const SESSIONS_FILE = 'agent-sessions.json'
const MESSAGES_FILE = 'agent-messages.json'

export interface AgentSessionRow {
  id: string
  title: string
  /** 会话级全局要求（056 迁移；空串=无） */
  instructions?: string
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

export function createAgentSession(title = '新会话'): AgentSessionRow {
  const row: AgentSessionRow = {
    id: randomUUID(),
    title,
    instructions: '',
    created_at: nowLocal(),
    updated_at: nowLocal(),
  }
  const sessions = readSessions()
  sessions.push(row)
  globalWriteJson(SESSIONS_FILE, sessions)
  return row
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
