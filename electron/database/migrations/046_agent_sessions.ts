import type { Migration } from './types'

export const m046AgentSessionsMigration: Migration = {
  name: '046_agent_sessions',
  up: (db) => {
    // AI 助手会话留存（全局侧栏）：会话与消息两级，删除会话级联清消息
    db.run(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT '新会话',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS agent_messages (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        trace_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_msg_session ON agent_messages(session_id);
    `)
  },
}
