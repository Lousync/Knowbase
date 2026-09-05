import { ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { buildUpdateSet } from '../../lib/safeUpdate'
import { isVaultDataSource } from '../dataSourceMode'
import { vaultPasswordsAll, vaultPasswordsSave, vaultSecretPasswordsExists, type SecretPwdRow } from '../../lib/kbStore/secretVaultRepo'

// ---- types ----
interface PasswordRow {
  id: string; title: string; url: string | null; username: string | null
  account: string | null; password: string; notes: string | null
  sort_order: number; created_at: string; updated_at: string
}

// ---- 密码加密(safeStorage/DPAPI) ----
// 库内密文格式: 'enc1:' + base64(加密字节);无前缀视为历史明文,读取时原样返回、启动时批量加密。
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

/** 将库内仍是明文的密码批量加密(启动时与导入后调用,幂等) */
export function encryptExistingPasswords(): void {
  try {
    const rows = queryAll<{ id: string; password: string }>(
      "SELECT id, password FROM toolbox_passwords WHERE password IS NOT NULL AND password != '' AND password NOT LIKE 'enc1:%'"
    )
    for (const r of rows) {
      getDatabase().run('UPDATE toolbox_passwords SET password = ? WHERE id = ?', [encryptPassword(r.password), r.id])
    }
    if (rows.length > 0) {
      saveToDisk()
      console.log(`[PasswordVault] 已加密 ${rows.length} 条存量明文密码`)
    }
  } catch (err) {
    console.error('[PasswordVault] 加密存量密码失败:', err)
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
function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
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

// ---- vault 路由（P5b / D4）：storageData=vault 时真相源 = .knowbase/secret/passwords.json ----
// 行结构与表一致（snake_case），password 字段沿用 enc1: 密文格式，回收站快照跨模式兼容。

function vaultRows(): PasswordRow[] {
  return vaultPasswordsAll() as unknown as PasswordRow[]
}

/** 首次进入 vault 模式：从 sqlite 台账播种（密文原样搬，幂等；库不可用时从空开始） */
export function ensureSecretVaultSeeded(): void {
  if (!isVaultDataSource()) return
  if (vaultSecretPasswordsExists()) return
  let rows: SecretPwdRow[] = []
  try {
    rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords').map((r) => ({ ...r }) as unknown as SecretPwdRow)
  } catch { rows = [] }
  vaultPasswordsSave(rows)
}

function vaultNextSortOrder(rows: PasswordRow[]): number {
  return rows.reduce((m, r) => Math.max(m, (r.sort_order ?? 0) + 1), 0)
}

// ---- IPC handlers ----
export function registerPasswordHandlers(): void {

  ipcMain.handle('passwordVault:getAll', () => {
    if (isVaultDataSource()) {
      ensureSecretVaultSeeded()
      return vaultRows().map(rowToPassword)
    }
    const rows = queryAll<PasswordRow>(
      'SELECT * FROM toolbox_passwords ORDER BY sort_order, updated_at DESC'
    )
    return rows.map(rowToPassword)
  })

  ipcMain.handle('passwordVault:getById', (_e, id: string) => {
    if (isVaultDataSource()) {
      ensureSecretVaultSeeded()
      const rows = vaultRows()
      const hit = rows.find((r) => r.id === id)
      return hit ? rowToPassword(hit) : null
    }
    const rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords WHERE id = ?', [id])
    return rows.length > 0 ? rowToPassword(rows[0]) : null
  })

  ipcMain.handle('passwordVault:create', (_e, data: {
    title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string
  }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    if (isVaultDataSource()) {
      ensureSecretVaultSeeded()
      const rows = vaultRows()
      const row: PasswordRow = {
        id, title: data.title || '', url: data.url || '', username: data.username || '',
        account: data.account || '', password: encryptPassword(data.password || ''), notes: data.notes || '',
        sort_order: vaultNextSortOrder(rows), created_at: now, updated_at: now,
      }
      vaultPasswordsSave([...rows, row] as unknown as SecretPwdRow[])
      return rowToPassword(row)
    }
    const maxRow = queryAll<{ m: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM toolbox_passwords'
    )
    const sortOrder = (maxRow[0]?.m ?? -1) + 1
    run(
      `INSERT INTO toolbox_passwords (id, title, url, username, account, password, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.title || '', data.url || '', data.username || '', data.account || '', encryptPassword(data.password || ''), data.notes || '', sortOrder, now, now]
    )
    const rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords WHERE id = ?', [id])
    return rowToPassword(rows[0])
  })

  ipcMain.handle('passwordVault:update', (_e, id: string, data: {
    title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string; sortOrder?: number
  }) => {
    if (isVaultDataSource()) {
      ensureSecretVaultSeeded()
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
    }
    // 列名白名单:渲染层传入的 key 不直接拼 SQL(防注入);密码先加密再入库
    const payload = { ...data, password: data.password !== undefined ? encryptPassword(data.password) : undefined }
    const { sets, params } = buildUpdateSet(
      payload,
      ['title', 'url', 'username', 'account', 'password', 'notes', 'sort_order'],
      { sets: ['updated_at = ?'], params: [new Date().toISOString()] }
    )
    params.push(id)
    run(`UPDATE toolbox_passwords SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords WHERE id = ?', [id])
    return rowToPassword(rows[0])
  })

  ipcMain.handle('passwordVault:delete', (_e, id: string) => {
    // Move to recycle bin instead of permanent delete
    if (isVaultDataSource()) {
      ensureSecretVaultSeeded()
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
      return
    }
    const rows = queryAll<PasswordRow>('SELECT * FROM toolbox_passwords WHERE id = ?', [id])
    if (rows.length === 0) return
    const entry = rowToPassword(rows[0])
    const binId = randomUUID()
    // 快照中的密码加密存储,避免回收站快照成为明文扩散点(恢复时直接插回密文,读取端统一解密)
    const snapshot = JSON.stringify({ ...entry, password: encryptPassword(entry.password) })
    run(
      `INSERT INTO recycle_bin (id, original_id, module, title, data, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [binId, id, 'passwordVault', entry.title || '未命名', snapshot, new Date().toISOString()]
    )
    run('DELETE FROM toolbox_passwords WHERE id = ?', [id])
  })

  // 启动时批量加密存量明文密码(幂等)
  encryptExistingPasswords()
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
