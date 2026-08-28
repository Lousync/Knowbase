import { randomBytes, pbkdf2Sync } from 'crypto'
import { getDatabase, saveToDisk } from '../../database/connection'
import { throwErr } from '../response'

/**
 * 模拟登录与权限 —— 让 AI 在测试时绕过锁屏，无需人工输入密码。
 *
 * 注意：以下 PBKDF2 参数必须与 `electron/database/repositories/userRepo.ts`
 * 中的常量保持一致，否则设置的密码与主程序互斥。userRepo 未导出这些常量
 * （为避免改动既有文件），故此处复刻一份并注明。
 */

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

function readHash(): string {
  const res = getDatabase().exec("SELECT password_hash FROM user_profile WHERE id = 'default'")
  if (res.length === 0 || !res[0].values || res[0].values.length === 0) return ''
  return String(res[0].values[0][0] ?? '')
}

export function hasPassword(): { hasPassword: boolean } {
  return { hasPassword: readHash() !== '' }
}

export function unlock(password: string): { unlocked: boolean } {
  const stored = readHash()
  if (!stored) return { unlocked: true }
  if (typeof password !== 'string' || !password) {
    throwErr('E_BAD_REQUEST', '缺少 password 参数')
  }
  return { unlocked: verifyPassword(password, stored) }
}

export function setPassword(password: string): { set: boolean } {
  if (typeof password !== 'string' || !password) {
    throwErr('E_BAD_REQUEST', 'password 不能为空')
  }
  getDatabase().run(
    "UPDATE user_profile SET password_hash = ?, updated_at = datetime('now') WHERE id = 'default'",
    [hashPassword(password)]
  )
  saveToDisk()
  return { set: true }
}

export function clearPassword(password: string): { cleared: boolean } {
  const stored = readHash()
  if (stored && !verifyPassword(String(password ?? ''), stored)) {
    throwErr('E_ACTION_FAILED', '原密码不正确')
  }
  getDatabase().run(
    "UPDATE user_profile SET password_hash = '', updated_at = datetime('now') WHERE id = 'default'"
  )
  saveToDisk()
  return { cleared: true }
}
