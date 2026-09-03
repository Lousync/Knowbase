import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getVaultKbRoot } from './vaultContext'

/**
 * 通用 JSON 存储引擎（去库化的数据访问层地基）。
 *
 * 每个模块在 `.knowbase/<module>/<key>.json` 落盘，key 可含子路径（如 '2026/09.json'）。
 * 特性：
 * - 原子写：临时文件 + rename 覆盖（防半写损坏，对标数据库写盘策略）
 * - 损坏兜底：读失败时把损坏文件备份为 `<key>.corrupt-<ts>` 后返回 fallback，不崩应用
 * - 自动建目录
 */

/** 计算模块文件绝对路径；无当前仓库返回 null */
export function kbModulePath(module: string, key: string): string | null {
  const root = getVaultKbRoot()
  if (!root) return null
  return join(root, module, key)
}

/** 读 JSON：文件不存在返回 fallback；损坏时备份损坏文件后返回 fallback */
export function readJson<T>(module: string, key: string, fallback: T): T {
  const p = kbModulePath(module, key)
  if (!p || !existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    try {
      renameSync(p, `${p}.corrupt-${Date.now()}`)
    } catch {
      /* ignore */
    }
    return fallback
  }
}

/** 写 JSON（原子写）。成功返回 true */
export function writeJson(module: string, key: string, data: unknown): boolean {
  const p = kbModulePath(module, key)
  if (!p) return false
  const dir = dirname(p)
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    try {
      renameSync(tmp, p)
    } catch {
      if (existsSync(p)) unlinkSync(p)
      renameSync(tmp, p)
    }
    return true
  } catch {
    return false
  }
}

/** 删除模块文件。成功返回 true（文件不存在视为成功） */
export function deleteFile(module: string, key: string): boolean {
  const p = kbModulePath(module, key)
  if (!p || !existsSync(p)) return true
  try {
    unlinkSync(p)
    return true
  } catch {
    return false
  }
}

/** 列出模块下直接子文件（不含 .tmp / .corrupt 中间产物），带大小 */
export function listFiles(module: string): Array<{ name: string; size: number; mtime: number }> {
  const root = getVaultKbRoot()
  if (!root) return []
  const dir = join(root, module)
  if (!existsSync(dir)) return []
  const out: Array<{ name: string; size: number; mtime: number }> = []
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name.includes('.tmp') || name.includes('.corrupt-')) continue
      const full = join(dir, name)
      try {
        const st = statSync(full)
        if (st.isFile()) out.push({ name, size: st.size, mtime: st.mtimeMs })
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

/** 文件是否存在 */
export function exists(module: string, key: string): boolean {
  const p = kbModulePath(module, key)
  return !!p && existsSync(p)
}
