/**
 * kb.store 插件私有存储（plugin-api-v2-design §5.1）。
 *
 * 落盘位置：`<vault>/.knowbase/plugins/<pluginId>/`（复用 jsonStore：原子写 + 损坏兜底 + 自动建目录）
 * - 完全私有：pluginId 取自 gateway token 会话，不信任调用方（对齐 kb.data 的防伪造）
 * - 天然隔离：目录在 vault 内，随仓库切换整套切换
 * - 免授权（capability 空串）：私有目录 + key 穿越校验 + 单文件配额 = 安全边界，无需额外授权
 *
 * key 规则：相对子路径（可含 '/'），禁绝对/盘符/UNC/`..` 越出根；key 可含子路径实现分层。
 * 纯逻辑（只依赖 jsonStore / node:path / node:crypto），node 可冒烟。
 */
import { writeJson, readJson, deleteFile as jsonDelete, exists as jsonExists, kbModulePath } from './jsonStore'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/** 单文件配额（契约：≤ 10MB） */
const MAX_KEY_BYTES = 64
const MAX_VALUE_BYTES = 10 * 1024 * 1024

const PLUGIN_DIR = 'plugins'

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** key 安全校验：相对子路径（可含 '/' 分层），拒绝对/盘符/UNC/`..`/非法字符。合法返回规范化 key */
export function validateStoreKey(key: unknown): string | null {
  if (typeof key !== 'string' || !key) return null
  if (key.length > MAX_KEY_BYTES) return null
  if (/^[a-zA-Z]:[\\/]/.test(key)) return null
  if (key.startsWith('\\\\') || key.startsWith('//')) return null
  if (key.startsWith('/') || key.startsWith('\\')) return null
  const norm = key.replace(/\\/g, '/')
  // `..` 段、空段、以 . 开头的隐藏段（防读到 .tmp/.corrupt 中间产物之外的东西）全部拒绝
  if (norm.split('/').some((seg) => !seg || seg === '..' || seg.startsWith('.'))) return null
  if (!/^[\w.\-\u4e00-\u9fff/]+$/.test(norm)) return null
  return norm
}

/** 读：文件不存在返回 null；错误返回 { ok:false } */
export function pluginStoreGet(pluginId: string, key: string): { ok: true; value: unknown | null } | { ok: false; error: string } {
  const k = validateStoreKey(key)
  if (!k) return { ok: false, error: 'key 非法（需相对路径，禁 .. 与隐藏段）' }
  return { ok: true, value: readJson<unknown>(`${PLUGIN_DIR}/${pluginId}`, k, null) }
}

/** 写：JSON 序列化 + 单文件 10MB 配额 */
export function pluginStoreSet(pluginId: string, key: string, value: unknown): { ok: true } | { ok: false; error: string } {
  const k = validateStoreKey(key)
  if (!k) return { ok: false, error: 'key 非法（需相对路径，禁 .. 与隐藏段）' }
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    return { ok: false, error: '值无法序列化为 JSON（含循环引用或 BigInt?）' }
  }
  if (json.length > MAX_VALUE_BYTES) {
    return { ok: false, error: `值过大（${(json.length / 1024 / 1024).toFixed(1)}MB，单键上限 10MB）` }
  }
  if (!writeJson(`${PLUGIN_DIR}/${pluginId}`, k, value)) return { ok: false, error: '写入失败（无当前仓库或磁盘错误）' }
  return { ok: true }
}

/** 删除：文件不存在视为成功 */
export function pluginStoreDelete(pluginId: string, key: string): { ok: true } | { ok: false; error: string } {
  const k = validateStoreKey(key)
  if (!k) return { ok: false, error: 'key 非法' }
  jsonDelete(`${PLUGIN_DIR}/${pluginId}`, k)
  return { ok: true }
}

/** 存在性（供插件判断后决定走 get 还是初始化） */
export function pluginStoreHas(pluginId: string, key: string): boolean {
  const k = validateStoreKey(key)
  if (!k) return false
  return jsonExists(`${PLUGIN_DIR}/${pluginId}`, k)
}

/** 占用统计：插件目录下所有 .json 字节和（不含 .tmp/.corrupt 中间产物） */
export function pluginStoreUsage(pluginId: string): { bytes: number; files: number } {
  const total = { bytes: 0, files: 0 }
  try {
    const root = kbModulePath(`${PLUGIN_DIR}/${pluginId}`, '')
    if (!root || !existsSync(root)) return total
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.') || name.includes('.tmp') || name.includes('.corrupt-')) continue
        const full = join(dir, name)
        try {
          const st = statSync(full)
          if (st.isDirectory()) walk(full)
          else { total.bytes += st.size; total.files += 1 }
        } catch { /* skip */ }
      }
    }
    walk(root)
  } catch { /* ignore */ }
  return total
}
