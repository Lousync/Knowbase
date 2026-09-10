/**
 * 日程表（周视图）共享工具与常量。
 *
 * 数据口径：排期时段用「当天分钟数」表示（540 = 09:00），存 `scheduledStart` / `scheduledEnd`。
 * 与 `time`（截止时刻，'YYYY-MM-DDTHH:mm' 字符串）严格分离 —— 前者是「排到哪个时段」，
 * 后者是「几点前必须完成」，同一任务可以两者都有（网格里既有卡片又有截止红线）。
 */

/** 粒度档位（分钟）：决定网格线细分与拖拽吸附步长 */
export const GRANULARITY_VALUES = [15, 30, 60] as const
export type Granularity = (typeof GRANULARITY_VALUES)[number]

/** 行高档位 → 每小时像素高度 */
export const DENSITY_VALUES = ['compact', 'normal', 'loose'] as const
export type DensityId = (typeof DENSITY_VALUES)[number]
export const DENSITY_PX: Record<DensityId, number> = { compact: 44, normal: 60, loose: 78 }
export const DENSITY_LABEL: Record<DensityId, string> = { compact: '紧凑', normal: '舒适', loose: '宽松' }

/** 卡片最小时长（分钟）。与粒度解耦：1 小时粒度下也能排出 15 分钟的短任务 */
export const MIN_DURATION = 15

/**
 * 跨栏拖拽的当前源（模块级缓存）。
 *
 * HTML5 DnD 的 `dataTransfer.getData()` 在 dragover 阶段**读不到**（浏览器安全限制，
 * 只在 drop 时可见），但 dragover 需要知道「拖的是什么、多长、抓在块内哪个位置」才能
 * 算落点与预览框 —— 所以用模块级缓存传递。同窗口内的拖拽都是同一 JS 环境，安全。
 */
export const dndMeta: { id: string | null; from: 'tray' | 'grid' | null; duration: number; grabOffset: number } =
  { id: null, from: null, duration: 60, grabOffset: 0 }

/** 拖拽时的时间轴范围约束（起止之间至少留 4 小时） */
export const MIN_RANGE_HOURS = 4

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 分钟数 → 'HH:mm' */
export function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 吸附到 step 的整数倍（step 为分钟） */
export function snapMin(min: number, step: number): number {
  return Math.round(min / step) * step
}

/** 'YYYY-MM-DD' → 本地零点的 Date（不用 new Date(str)，避免被当成 UTC 造成跨时区偏一天） */
export function parseDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Date → 'YYYY-MM-DD' */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 某个日期所在周的周一（周一为一周之首） */
export function mondayOf(dateStr: string): Date {
  const d = parseDay(dateStr)
  const dow = (d.getDay() + 6) % 7 // 周一 = 0
  d.setDate(d.getDate() - dow)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 周偏移：相对 base 日期的第 weekOffset 周的周一 */
export function mondayOfWeek(baseDateStr: string, weekOffset: number): Date {
  const d = mondayOf(baseDateStr)
  d.setDate(d.getDate() + weekOffset * 7)
  return d
}

/** 把周一往后推 i 天 */
export function dayFromMonday(monday: Date, i: number): Date {
  const d = new Date(monday)
  d.setDate(d.getDate() + i)
  return d
}

/** 展示用短日期 'M/D' */
export function shortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 已排期的最小形状（泛型约束用，避免依赖完整 ScheduleTodo） */
export interface ScheduledLike {
  scheduledStart: number | null
  scheduledEnd: number | null
}

export interface Laid<T> {
  item: T
  /** 同一重叠簇内第几列（0 起） */
  lane: number
  /** 该重叠簇共分几列 */
  lanes: number
}

/**
 * 重叠分列：把同一天时段相交的任务摊到不同列上并排显示。
 *
 * 做法是先按起点切「重叠簇」（簇内任意两个任务通过相交关系连通），
 * 再在簇内贪心分配 lane（放进第一条已结束的列）。
 * 跨簇不共享 lane 宽度 —— 早上的冲突不该把傍晚的单条任务挤窄。
 */
export function layoutDay<T extends ScheduledLike>(items: T[]): Laid<T>[] {
  const arr = items
    .filter((t) => t.scheduledStart != null && t.scheduledEnd != null)
    .slice()
    .sort((a, b) => a.scheduledStart! - b.scheduledStart! || a.scheduledEnd! - b.scheduledEnd!)

  const out: Laid<T>[] = []
  let cluster: T[] = []
  let clusterEnd = -1

  const flush = () => {
    if (!cluster.length) return
    const laneEnds: number[] = []
    const assigned: Laid<T>[] = []
    for (const it of cluster) {
      const s = it.scheduledStart!
      const e = it.scheduledEnd!
      let lane = laneEnds.findIndex((end) => end <= s)
      if (lane === -1) {
        laneEnds.push(e)
        lane = laneEnds.length - 1
      } else {
        laneEnds[lane] = e
      }
      assigned.push({ item: it, lane, lanes: 0 })
    }
    for (const a of assigned) a.lanes = laneEnds.length
    out.push(...assigned)
    cluster = []
    clusterEnd = -1
  }

  for (const it of arr) {
    const s = it.scheduledStart!
    const e = it.scheduledEnd!
    if (cluster.length && s >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return out
}

/** 某人某天是否需要画「截止红线」（截止时刻落在当天，且未完成） */export function dueOfDay<T extends { time: string | null; taskType: string }>(items: T[], dateStr: string): number[] {
  const out: number[] = []
  for (const t of items) {
    if (t.taskType !== 'deadline' || !t.time) continue
    if (t.time.slice(0, 10) !== dateStr) continue
    const hh = Number(t.time.slice(11, 13))
    const mm = Number(t.time.slice(14, 16))
    if (Number.isNaN(hh) || Number.isNaN(mm)) continue
    out.push(hh * 60 + mm)
  }
  return out
}
