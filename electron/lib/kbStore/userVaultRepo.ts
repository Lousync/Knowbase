import { readJson, writeJson } from './jsonStore'

/**
 * 用户档案 vault 数据仓库（去库化 R6，D9）
 *
 * 存储：.knowbase/modules/user.json
 * 行结构保留 sql.js 同名字段（snake_case），便于一次性搬迁与对齐：
 * Array<{ id, username, avatar_path, password_hash?, created_at, updated_at }>
 * 迁移快照中无 password_hash 列 → 行上该字段可选，无（undefined/null/''）= 未设密码。
 */

export interface UserVaultRow {
  id: string
  username: string
  avatar_path: string
  password_hash?: string | null
  created_at: string
  updated_at: string
}

const MOD = 'modules'

// ===== 低层存取 =====
export function userVaultRowsAll(): UserVaultRow[] {
  return readJson<UserVaultRow[]>(MOD, 'user.json', [])
}

export function userVaultRowsSave(rows: UserVaultRow[]): void {
  writeJson(MOD, 'user.json', rows)
}

/** 取默认档案：id='default' 优先，否则首行；无数据返回 null */
export function vaultUserProfile(): UserVaultRow | null {
  const rows = userVaultRowsAll()
  return rows.find((r) => r.id === 'default') ?? rows[0] ?? null
}

/** 按 id upsert 用户档案 */
export function vaultUserProfileSave(row: UserVaultRow): void {
  const rows = userVaultRowsAll()
  const i = rows.findIndex((r) => r.id === row.id)
  if (i >= 0) rows[i] = row
  else rows.push(row)
  userVaultRowsSave(rows)
}
