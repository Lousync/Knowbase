/**
 * 构造安全的 UPDATE SET 子句。
 *
 * 渲染进程传入的 data key 不可信——此前直接 `camelToSnake(k)` 拼进 SQL,
 * 形如 "title=(SELECT...)--" 的 key 可注入任意 SQL 片段(值虽参数化,列名没有)。
 * 现在只允许白名单内的 snake_case 列名进入 SET 子句,其余键一律丢弃。
 */
export function buildUpdateSet(
  data: Record<string, unknown>,
  allowedColumns: string[],
  preset?: { sets: string[]; params: unknown[] }
): { sets: string[]; params: unknown[] } {
  const sets: string[] = preset ? [...preset.sets] : []
  const params: unknown[] = preset ? [...preset.params] : []
  const allow = new Set(allowedColumns)
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue
    const col = k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
    if (!allow.has(col)) continue
    sets.push(`${col} = ?`)
    params.push(v)
  }
  return { sets, params }
}
