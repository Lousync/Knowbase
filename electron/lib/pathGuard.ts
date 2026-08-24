import { isAbsolute, resolve, sep } from 'path'

/**
 * 把不可信的相对路径（来自备份包 export.json / 数据库行）安全解析到 baseDir 内。
 *
 * 防护目标（Zip Slip / 路径穿越）:
 * - 拒绝盘符绝对路径（Windows 下 path.join 遇盘符路径会整体丢弃基目录）
 * - 拒绝 UNC 路径（\\server\share）与 POSIX 绝对路径
 * - 拒绝 `..` 越出 baseDir 的相对路径
 *
 * 返回解析后的安全绝对路径;非法输入返回 null,调用方应跳过该条目。
 */
export function safePathInside(baseDir: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || rel.length === 0) return null
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\') || rel.startsWith('//')) return null
  if (isAbsolute(rel)) return null
  const base = resolve(baseDir)
  const resolved = resolve(base, rel)
  const baseWithSep = base.endsWith(sep) ? base : base + sep
  return resolved.startsWith(baseWithSep) ? resolved : null
}
