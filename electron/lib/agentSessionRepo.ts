import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../database/connection'

/** AI 助手会话留存（迁移 046）：会话 + 消息两级，删除会话级联清消息 */

export interface AgentSessionRow {
  id: string
  title: string
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

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDatabase().prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

export function createAgentSession(title = '新会话'): AgentSessionRow {
  const id = randomUUID()
  run('INSERT INTO agent_sessions (id, title) VALUES (?, ?)', [id, title])
  return queryAll<AgentSessionRow>('SELECT * FROM agent_sessions WHERE id = ?', [id])[0]
}

export function listAgentSessions(): AgentSessionRow[] {
  return queryAll<AgentSessionRow>('SELECT * FROM agent_sessions ORDER BY updated_at DESC, rowid DESC LIMIT 200')
}

export function renameAgentSession(id: string, title: string): void {
  run("UPDATE agent_sessions SET title = ?, updated_at = datetime('now','localtime') WHERE id = ?", [title, id])
}

export function deleteAgentSession(id: string): void {
  // 显式先删子消息：sql.js 运行时的外键级联不可靠，不依赖 CASCADE
  run('DELETE FROM agent_messages WHERE session_id = ?', [id])
  run('DELETE FROM agent_sessions WHERE id = ?', [id])
}

export function sessionExists(id: string): boolean {
  return queryAll<{ id: string }>('SELECT id FROM agent_sessions WHERE id = ?', [id]).length > 0
}

/** 追加消息并刷新会话活跃时间 */
export function appendAgentMessage(sessionId: string, role: 'user' | 'assistant', content: string, trace?: unknown): void {
  run(
    'INSERT INTO agent_messages (id, session_id, role, content, trace_json) VALUES (?, ?, ?, ?, ?)',
    [randomUUID(), sessionId, role, content, trace ? JSON.stringify(trace) : null]
  )
  run("UPDATE agent_sessions SET updated_at = datetime('now','localtime') WHERE id = ?", [sessionId])
}

/** 首条用户消息自动成为会话标题（仅当仍是默认标题时） */
export function ensureSessionTitle(sessionId: string, firstUserMessage: string): void {
  const rows = queryAll<AgentSessionRow>('SELECT title FROM agent_sessions WHERE id = ?', [sessionId])
  if (rows.length === 0) return
  const t = rows[0].title
  if (!t || t === '新会话') {
    const title = firstUserMessage.replace(/\s+/g, ' ').trim().slice(0, 20) || '新会话'
    renameAgentSession(sessionId, title)
  }
}

export function getAgentMessages(sessionId: string): AgentMessageRow[] {
  return queryAll<AgentMessageRow>(
    'SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 500',
    [sessionId]
  )
}
