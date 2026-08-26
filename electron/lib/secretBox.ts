import { safeStorage } from 'electron'

/**
 * 机密值加密封装（与密码本同一机制：Electron safeStorage / Windows DPAPI）。
 * 库内格式：'enc1:' + base64(密文字节)；无前缀视为历史明文，读取时原样返回。
 * 与 passwordRepo 保持格式兼容，但不互相引用（避免模块耦合）。
 */
const ENC_PREFIX = 'enc1:'

export function encryptSecret(plain: string): string {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch { /* fall through */ }
  return plain // 加密不可用时退回明文(功能优先，与密码本策略一致)
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!stored.startsWith(ENC_PREFIX)) return stored // 历史明文
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return '' // 解密失败(如密文来自其他机器)，不把密文当有效值返回
  }
}
