/**
 * vaultScope 写入范围收敛（plugin-api-v2-design §5.2 ADR-7 / knowledge-index 无关）—— 纯函数。
 *
 * manifest.vaultScope: ["pages/", "docs/"] = 只读全库 + 只写声明前缀内；
 * 未声明 = 写整库（授权弹窗承担风险沟通）。读路径不受 scope 约束。
 */

/** 仓库相对路径归一化：反斜杠→斜杠、去首尾斜杠；非法（越界/盘符/空）返回 null */
export function normalizeRelPath(rel: string): string | null {
  if (typeof rel !== 'string') return null
  const norm = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!norm) return null
  if (/^[a-zA-Z]:/.test(norm) || norm.startsWith('//') || norm.split('/').includes('..')) return null
  return norm
}

/** scope 前缀归一化（条目本身在 manifest 校验时已过格式关，这里只做形态统一） */
export function normalizeScopeEntry(entry: string): string {
  return entry.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** relPath 是否落在 scope 内（scope 空数组 = 未声明 = 全库放行） */
export function isWithinVaultScope(rel: string, scope: string[] | undefined): boolean {
  if (!scope || scope.length === 0) return true
  const norm = normalizeRelPath(rel)
  if (!norm) return false
  return scope.some((s) => {
    const p = normalizeScopeEntry(s)
    return norm === p || norm.startsWith(p + '/')
  })
}

/** 写操作强制执行：越界抛错（EPATH），调用方直接透传给 Gateway 裁决链 */
export function enforceVaultScope(rel: string, scope: string[] | undefined): void {
  if (isWithinVaultScope(rel, scope)) return
  const list = (scope ?? []).map(normalizeScopeEntry).join('、') || '（未声明）'
  throw Object.assign(
    new Error(`写入路径超出插件声明的 vaultScope 范围（${list}）: ${rel}`),
    { code: 'EPATH' },
  )
}
