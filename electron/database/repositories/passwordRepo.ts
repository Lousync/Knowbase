// R6 去库化：真相源 = .knowbase/secret/passwords.json（DPAPI，sql.js 路径已移除，D9）
import { ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { vaultPasswordsAll, vaultPasswordsSave, type SecretPwdRow } from '../../lib/kbStore/secretVaultRepo'

// ---- types ----
interface PasswordRow {
  id: string; title: string; url: string | null; username: string | null
  account: string | null; password: string; notes: string | null
  sort_order: number; created_at: string; updated_at: string
}

// ---- 密码加密(safeStorage/DPAPI) ----
// 密文格式: 'enc1:' + base64(加密字节);无前缀视为历史明文,读取时原样返回。
const ENC_PREFIX = 'enc1:'

export function encryptPassword(plain: string): string {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch { /* fall through */ }
  return plain // 加密不可用时退回明文(功能优先)
}

export function decryptPassword(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!stored.startsWith(ENC_PREFIX)) return stored // 历史明文
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return '' // 解密失败(如密文来自其他机器),不把密文当密码返回
  }
}

function rowToPassword(row: PasswordRow) {
  return {
    id: row.id, title: row.title, url: row.url || '',
    username: row.username || '', account: row.account || '',
    password: decryptPassword(row.password), notes: row.notes || '',
    sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at
  }
}

// ---- helpers ----
function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

// 行结构与表一致（snake_case），password 字段沿用 enc1: 密文格式，回收站快照跨模式兼容。

function vaultRows(): PasswordRow[] {
  return vaultPasswordsAll() as unknown as PasswordRow[]
}

function vaultNextSortOrder(rows: PasswordRow[]): number {
  return rows.reduce((m, r) => Math.max(m, (r.sort_order ?? 0) + 1), 0)
}

// ---- IPC handlers ----
export function registerPasswordHandlers(): void {

  ipcMain.handle('passwordVault:getAll', () => {
    return vaultRows().map(rowToPassword)
  })

  ipcMain.handle('passwordVault:getById', (_e, id: string) => {
    const rows = vaultRows()
    const hit = rows.find((r) => r.id === id)
    return hit ? rowToPassword(hit) : null
  })

  ipcMain.handle('passwordVault:create', (_e, data: {
    title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string
  }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const rows = vaultRows()
    const row: PasswordRow = {
      id, title: data.title || '', url: data.url || '', username: data.username || '',
      account: data.account || '', password: encryptPassword(data.password || ''), notes: data.notes || '',
      sort_order: vaultNextSortOrder(rows), created_at: now, updated_at: now,
    }
    vaultPasswordsSave([...rows, row] as unknown as SecretPwdRow[])
    return rowToPassword(row)
  })

  ipcMain.handle('passwordVault:update', (_e, id: string, data: {
    title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string; sortOrder?: number
  }) => {
    const rows = vaultRows()
    const i = rows.findIndex((r) => r.id === id)
    if (i < 0) return null
    const cur = rows[i]
    const next: PasswordRow = {
      ...cur,
      title: data.title !== undefined ? data.title : cur.title,
      url: data.url !== undefined ? data.url : cur.url,
      username: data.username !== undefined ? data.username : cur.username,
      account: data.account !== undefined ? data.account : cur.account,
      password: data.password !== undefined ? encryptPassword(data.password) : cur.password,
      notes: data.notes !== undefined ? data.notes : cur.notes,
      sort_order: data.sortOrder !== undefined ? data.sortOrder : cur.sort_order,
      updated_at: new Date().toISOString(),
    }
    rows[i] = next
    vaultPasswordsSave(rows as unknown as SecretPwdRow[])
    return rowToPassword(next)
  })

  ipcMain.handle('passwordVault:delete', (_e, id: string) => {
    // Move to recycle bin instead of permanent delete
    const rows = vaultRows()
    const hit = rows.find((r) => r.id === id)
    if (!hit) return
    const entry = rowToPassword(hit)
    const binId = randomUUID()
    const snapshot = JSON.stringify({ ...entry, password: encryptPassword(entry.password) })
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [binId, id, 'passwordVault', entry.title || '未命名', snapshot, new Date().toISOString()]
    )
    vaultPasswordsSave(rows.filter((r) => r.id !== id) as unknown as SecretPwdRow[])
  })
}
