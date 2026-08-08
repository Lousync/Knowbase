/**
 * 日期显示工具
 */

/** 本地时区的今天（YYYY-MM-DD），避免 UTC 截断导致凌晨日期错位 */
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 列表日期显示：
 * - 当年条目只显示「月-日」（保持紧凑）
 * - 跨年份条目补上「年-月-日」，避免「全部文章」视图下不同年份日期混淆
 */
export function formatEntryDate(date: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date)
  if (!m) return date
  const [, y, mo, d] = m
  if (y === String(new Date().getFullYear())) return `${mo}-${d}`
  return `${y}-${mo}-${d}`
}
