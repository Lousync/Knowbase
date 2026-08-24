/**
 * 周/月总结的日期窗口计算。
 *
 * 规则：
 * - 周总结：当天星期几 === 设置的周总结日 → 窗口 = 往前推 7 天（含当天）
 * - 月总结：
 *   - first（每月第一天）→ 窗口 = 上一个完整自然月
 *   - last（每月最后一天）→ 窗口 = 当前自然月（1 号 ~ 当天）
 *   - fixed（每月固定第 N 天，N 夹取到 1-28）→ 窗口 = 近 30 天（含当天）
 * - 若同一天同时命中周总结与月总结，月总结优先
 */

export interface PeriodWindow {
  type: 'week' | 'month'
  start: string
  end: string
  /** 面板标题，如「周总结(08.17 ~ 08.23)」「2026年8月月总结」 */
  label: string
  /** 下期任务的落日（总结日的下一天） */
  nextDate: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type MonthlyMode = 'first' | 'last' | 'fixed'

export function getSummaryWindow(
  dateStr: string,
  weeklyDay: number,
  monthlyMode: MonthlyMode,
  monthlyFixedDay: number
): PeriodWindow | null {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d)
  const nextDate = fmt(new Date(y, m - 1, d + 1))

  // ---- 月总结优先判定 ----
  const lastDom = new Date(y, m, 0).getDate()
  const isFirst = d === 1
  const isLast = d === lastDom
  const fixedClamped = Math.min(Math.max(monthlyFixedDay, 1), 28)
  const hitFixed = d === fixedClamped

  if (monthlyMode === 'first' && isFirst) {
    const ps = new Date(y, m - 2, 1)
    const pe = new Date(y, m - 1, 0)
    return {
      type: 'month',
      start: fmt(ps),
      end: fmt(pe),
      label: `${ps.getFullYear()}年${ps.getMonth() + 1}月月总结`,
      nextDate,
    }
  }
  if (monthlyMode === 'last' && isLast) {
    return {
      type: 'month',
      start: `${y}-${pad(m)}-01`,
      end: dateStr,
      label: `${y}年${m}月月总结`,
      nextDate,
    }
  }
  if (monthlyMode === 'fixed' && hitFixed) {
    const start = new Date(y, m - 1, d - 29)
    return {
      type: 'month',
      start: fmt(start),
      end: dateStr,
      label: `近30天月总结(${fmt(start).slice(5)}~${dateStr.slice(5)})`,
      nextDate,
    }
  }

  // ---- 周总结 ----
  if (date.getDay() === weeklyDay) {
    const start = new Date(y, m - 1, d - 6)
    return {
      type: 'week',
      start: fmt(start),
      end: dateStr,
      label: `周总结(${fmt(start).slice(5)} ~ ${dateStr.slice(5)})`,
      nextDate,
    }
  }

  return null
}
