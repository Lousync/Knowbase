import { randomBytes, timingSafeEqual } from 'crypto'

/**
 * 设备传输鉴权：
 *  - 一次性 token（每次开启服务重新生成，关闭即失效）
 *  - 来源 IP 私有网段白名单（数据不出局域网）
 */

// 私有网段（IPv4）：10/8、172.16/12、192.168/16、169.254/16（link-local）
const PRIVATE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0a000000, 0x0affffff],
  [0xac100000, 0xac1fffff],
  [0xc0a80000, 0xc0a8ffff],
  [0xa9fe0000, 0xa9feffff],
]

function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let v = 0
  for (const p of parts) {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    v = (v << 8) | n
  }
  return v >>> 0
}

export function isPrivateAddress(ip: string): boolean {
  const v = ipToInt(ip)
  if (v === null) return false
  return PRIVATE_RANGES.some(([start, end]) => v >= start && v <= end)
}

export function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

/** 常量时间比较，防时序侧信道 */
export function tokenMatches(expected: string, actual: string | undefined | null): boolean {
  if (!actual) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 从 Authorization / 查询串中提取 token：优先 query，其次 Bearer 头（浏览器直连场景用 query） */
export function extractToken(url: string | undefined, authorization: string | undefined): string {
  if (url) {
    const m = /\btoken=([^&]+)/.exec(url)
    if (m) return decodeURIComponent(m[1])
  }
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim()
  }
  return ''
}
