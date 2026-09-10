/**
 * 随机强密码生成（主窗口密码本 / 悬浮小密码本共用）
 *
 * 默认 16 位，四类字符各至少一位，生成后整体 Fisher-Yates 打乱，
 * 避免「前四位固定是各类字符」这种可预测模式。
 */
export function genPassword(len = 16): string {
  const lowers = 'abcdefghijkmnopqrstuvwxyz'
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const syms = '!@#$%^&*-_=+'
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)]
  const base = [pick(lowers), pick(uppers), pick(digits), pick(syms)]
  const all = lowers + uppers + digits + syms
  while (base.length < len) base.push(pick(all))
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[base[i], base[j]] = [base[j], base[i]]
  }
  return base.join('')
}
