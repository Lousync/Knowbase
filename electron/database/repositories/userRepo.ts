import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import { randomBytes, pbkdf2Sync } from 'crypto'
import { getDatabase, saveToDisk, getAttachmentsDir } from '../connection'
import { join, basename } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, unlinkSync } from 'fs'
import { registerAttachment, deleteAttachments } from './attachmentRepo'

// ---- types ----
interface UserProfileRow {
  id: string
  username: string
  avatar_path: string
  password_hash: string
  created_at: string
  updated_at: string
}

interface UserStats {
  blogCount: number
  knowledgePages: number
  scheduleTodos: number
  blogTags: number
  knowledgeTags: number
  scheduleTags: number
  consecutiveDays: number
  totalWords: number
  totalCategories: number
}

// ---- helpers ----
function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  let row: T | null = null
  if (stmt.step()) row = stmt.getAsObject() as T
  stmt.free()
  return row
}

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

function count(table: string, extraCondition: string = ''): number {
  const sql = `SELECT COUNT(*) as cnt FROM ${table}` + (extraCondition ? ` WHERE ${extraCondition}` : '')
  const row = queryOne<{ cnt: number }>(sql)
  return row?.cnt ?? 0
}

// ---- Avatar directory ----
function avatarsDir(): string {
  const dir = join(app.getPath('userData'), 'avatars')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// ---- PBKDF2 password ----
const PBKDF2_ITERATIONS = 100000
const PBKDF2_KEYLEN = 64
const PBKDF2_DIGEST = 'sha512'
const SALT_LEN = 16

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN).toString('hex')
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const computed = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex')
  return computed === hash
}

export function registerUserHandlers(): void {
  // ===== Get profile =====
  ipcMain.handle('user:getProfile', () => {
    const row = queryOne<UserProfileRow>('SELECT * FROM user_profile WHERE id = ?', ['default'])
    if (!row) return null
    return {
      username: row.username,
      avatarPath: row.avatar_path,
      hasPassword: row.password_hash !== '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  })

  // ===== Update username =====
  ipcMain.handle('user:setUsername', (_e, username: string) => {
    const now = new Date().toISOString()
    run("UPDATE user_profile SET username = ?, updated_at = ? WHERE id = 'default'", [username, now])
    return { success: true }
  })

  // ===== Set password =====
  ipcMain.handle('user:setPassword', (_e, password: string) => {
    const hash = hashPassword(password)
    const now = new Date().toISOString()
    run("UPDATE user_profile SET password_hash = ?, updated_at = ? WHERE id = 'default'", [hash, now])
    return { success: true }
  })

  // ===== Verify password =====
  ipcMain.handle('user:verifyPassword', (_e, password: string) => {
    const row = queryOne<UserProfileRow>('SELECT password_hash FROM user_profile WHERE id = ?', ['default'])
    if (!row || !row.password_hash) return false
    return verifyPassword(password, row.password_hash)
  })

  // ===== Check if password set =====
  ipcMain.handle('user:hasPassword', () => {
    const row = queryOne<UserProfileRow>('SELECT password_hash FROM user_profile WHERE id = ?', ['default'])
    return !!(row && row.password_hash)
  })

  // ===== Verify import password (against provided hash, not stored) =====
  ipcMain.handle('user:verifyImportPassword', (_e, password: string, storedHash: string) => {
    return verifyPassword(password, storedHash)
  })

  // ===== Change password (verify old first) =====
  ipcMain.handle('user:changePassword', (_e, oldPassword: string, newPassword: string) => {
    const row = queryOne<UserProfileRow>('SELECT password_hash FROM user_profile WHERE id = ?', ['default'])
    if (row && row.password_hash && !verifyPassword(oldPassword, row.password_hash)) {
      return { success: false, error: '当前密码错误' }
    }
    const hash = hashPassword(newPassword)
    const now = new Date().toISOString()
    run("UPDATE user_profile SET password_hash = ?, updated_at = ? WHERE id = 'default'", [hash, now])
    return { success: true }
  })

  // ===== Clear password =====
  ipcMain.handle('user:clearPassword', (_e, password: string) => {
    const row = queryOne<UserProfileRow>('SELECT password_hash FROM user_profile WHERE id = ?', ['default'])
    if (row && row.password_hash && !verifyPassword(password, row.password_hash)) {
      return { success: false, error: '密码错误' }
    }
    const now = new Date().toISOString()
    run("UPDATE user_profile SET password_hash = '', updated_at = ? WHERE id = 'default'", [now])
    return { success: true }
  })

  // ===== Avatar: pick file dialog =====
  ipcMain.handle('user:pickAvatar', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择头像图片',
      filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ===== Avatar: save to avatars/ dir =====
  ipcMain.handle('user:saveAvatar', (_e, sourcePath: string) => {
    const ext = sourcePath.match(/\.(png|jpe?g|gif|webp|bmp)$/i)?.[0] || '.png'
    const fileName = `avatar_${Date.now()}${ext}`
    const destDir = join(getAttachmentsDir(), 'user_profile', 'default')
    mkdirSync(destDir, { recursive: true })
    const destPath = join(destDir, fileName)
    copyFileSync(sourcePath, destPath)

    // 删除旧头像文件与旧附件记录
    const prev = queryOne<UserProfileRow>('SELECT avatar_path FROM user_profile WHERE id = ?', ['default'])
    if (prev?.avatar_path) {
      const oldPath = join(app.getPath('userData'), prev.avatar_path)
      try { if (existsSync(oldPath)) unlinkSync(oldPath) } catch { /* ignore */ }
    }
    const oldAtts = queryAll<{ id: string }>("SELECT id FROM attachments WHERE owner_type = 'user_profile' AND owner_id = 'default'")
    if (oldAtts.length > 0) deleteAttachments(oldAtts.map(a => a.id))

    const now = new Date().toISOString()
    const relativePath = `attachments/user_profile/default/${fileName}`
    registerAttachment({
      ownerType: 'user_profile',
      ownerId: 'default',
      fileName,
      relPath: `user_profile/default/${fileName}`,
      mime: `image/${ext.replace(/^\./, '').replace('jpg', 'jpeg')}`,
      size: readFileSync(destPath).length,
    })
    run("UPDATE user_profile SET avatar_path = ?, updated_at = ? WHERE id = 'default'", [relativePath, now])
    return { success: true, path: relativePath }
  })

  // ===== Avatar: read as base64 =====
  ipcMain.handle('user:getAvatarBase64', () => {
    const row = queryOne<UserProfileRow>('SELECT avatar_path FROM user_profile WHERE id = ?', ['default'])
    if (!row?.avatar_path) return null
    const fullPath = join(app.getPath('userData'), row.avatar_path)
    if (!existsSync(fullPath)) return null
    const buf = readFileSync(fullPath)
    const ext = row.avatar_path.match(/\.(\w+)$/)?.[1] || 'png'
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${buf.toString('base64')}`
  })

  // ===== Get stats =====
  ipcMain.handle('user:getStats', (): UserStats => {
    const blogCount = count('entries')
    const knowledgePages = count('knowledge_pages')
    const scheduleTodos = count('schedule_todos')
    const blogTags = count('tags')
    const knowledgeTags = count('knowledge_tags')
    const scheduleTags = count('schedule_tags')
    const totalWords = queryOne<{ sum: number }>('SELECT COALESCE(SUM(word_count), 0) as sum FROM entries')?.sum ?? 0
    const totalCategories = count('knowledge_categories')

    // Consecutive days: count backward from today how many consecutive days have entries
    let consecutiveDays = 0
    const today = new Date()
    for (let i = 0; i < 3650; i++) { // max 10 years
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      // 本地日期(不用 toISOString 的 UTC 截断,避免凌晨连击算错)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const hasEntry = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM entries WHERE date = ?', [dateStr])
      const hasSchedule = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM schedule_todos WHERE date = ?', [dateStr])
      if ((hasEntry?.cnt ?? 0) > 0 || (hasSchedule?.cnt ?? 0) > 0) {
        consecutiveDays++
      } else if (i > 0) {
        break // break on first gap (skip today, which may not have been written yet)
      }
    }

    return { blogCount, knowledgePages, scheduleTodos, blogTags, knowledgeTags, scheduleTags, consecutiveDays, totalWords, totalCategories }
  })

  // ===== Export: get full user data (for JSON export) =====
  ipcMain.handle('user:getExportData', () => {
    const row = queryOne<UserProfileRow>('SELECT * FROM user_profile WHERE id = ?', ['default'])
    if (!row) return null

    // Read avatar base64 if exists
    let avatarBase64: string | null = null
    if (row.avatar_path) {
      const fullPath = join(app.getPath('userData'), row.avatar_path)
      if (existsSync(fullPath)) {
        const buf = readFileSync(fullPath)
        const ext = row.avatar_path.match(/\.(\w+)$/)?.[1] || 'png'
        const mime = ext === 'jpg' ? 'jpeg' : ext
        avatarBase64 = `data:image/${mime};base64,${buf.toString('base64')}`
      }
    }

    return {
      username: row.username,
      avatarPath: row.avatar_path,
      avatarBase64,
      passwordHash: row.password_hash
    }
  })

  // ===== Import: restore user data =====
  ipcMain.handle('user:restoreFromImport', (_e, data: { username?: string; avatarPath?: string; avatarBase64?: string; passwordHash?: string }) => {
    const now = new Date().toISOString()

    if (data.username !== undefined) {
      run("UPDATE user_profile SET username = ?, updated_at = ? WHERE id = 'default'", [data.username, now])
    }
    if (data.passwordHash !== undefined) {
      run("UPDATE user_profile SET password_hash = ?, updated_at = ? WHERE id = 'default'", [data.passwordHash, now])
    }
    if (data.avatarBase64) {
      // Extract base64 data and mime type
      const match = data.avatarBase64.match(/^data:image\/(\w+);base64,(.+)$/)
      if (match) {
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
        const fileName = `avatar_imported_${Date.now()}.${ext}`
        const destDir = join(getAttachmentsDir(), 'user_profile', 'default')
        mkdirSync(destDir, { recursive: true })
        const destPath = join(destDir, fileName)
        writeFileSync(destPath, Buffer.from(match[2], 'base64'))
        const oldAtts = queryAll<{ id: string }>("SELECT id FROM attachments WHERE owner_type = 'user_profile' AND owner_id = 'default'")
        if (oldAtts.length > 0) deleteAttachments(oldAtts.map(a => a.id))
        const relativePath = `attachments/user_profile/default/${fileName}`
        registerAttachment({
          ownerType: 'user_profile',
          ownerId: 'default',
          fileName,
          relPath: `user_profile/default/${fileName}`,
          mime: `image/${ext}`,
          size: Buffer.byteLength(match[2], 'base64'),
        })
        run("UPDATE user_profile SET avatar_path = ?, updated_at = ? WHERE id = 'default'", [relativePath, now])
      }
    }

    return { success: true }
  })
}
