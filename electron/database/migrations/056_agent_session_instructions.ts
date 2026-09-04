import type { Migration } from './types'

export const m056AgentSessionInstructionsMigration: Migration = {
  name: '056_agent_session_instructions',
  up: (db) => {
    // 会话级全局要求（AgentRunner）：该会话附加的持久系统指令，只对本会话生效
    // 幂等：列已存在时 ALTER 会报错，先查 pragma 再决定是否加列
    const cols = db.exec("PRAGMA table_info(agent_sessions)")[0]?.values ?? []
    const hasInstructions = cols.some((c: unknown[]) => String(c[1]) === 'instructions')
    if (!hasInstructions) {
      db.run("ALTER TABLE agent_sessions ADD COLUMN instructions TEXT NOT NULL DEFAULT ''")
    }
  },
}
