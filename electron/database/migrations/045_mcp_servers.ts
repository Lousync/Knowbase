import type { Migration } from './types'

export const m045McpServersMigration: Migration = {
  name: '045_mcp_servers',
  up: (db) => {
    // MCP 外部服务器配置（见 .claude/plans/agent-tools-foundation.md 第三节）
    // endpoint: stdio=命令行 JSON 数组 ["node","srv.js"] / sse·http=完整 URL
    // args_json: {"env":{k:v}} 环境变量，值经 DPAPI 加密后存储
    db.run(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        transport   TEXT NOT NULL,
        endpoint    TEXT NOT NULL,
        args_json   TEXT NOT NULL DEFAULT '{}',
        enabled     INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'untested',
        last_error  TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `)
  },
}
