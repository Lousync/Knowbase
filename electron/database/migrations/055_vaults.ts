import type { Migration } from './types'

/**
 * 编辑器工作区（Vault 仓库）登记表。
 *
 * Vault 化演进的数据底座：任何磁盘文件夹经系统对话框授权后登记为一个仓库，
 * 仓库内文件即内容（.md 即页面），本表只记录"哪些文件夹被授权 + 最近使用顺序"，
 * 文件内容与元数据不落库（对标 Obsidian 的 Vault 模型）。
 *
 * space_id 预留：后续阶段支持把仓库绑定到知识库空间（混合演进），v1 固定为 NULL。
 */
export const m055VaultsMigration: Migration = {
  name: '055_vaults',
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS vaults (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        path       TEXT NOT NULL UNIQUE,
        space_id   TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_vaults_updated ON vaults (updated_at DESC);
    `)
  },
}
