import type { WebContents } from 'electron'
import { notifyCheckin } from './pushService'
import { vaultHabitRecordAddIfAbsent, vaultHabitsAll, vaultHabitLinksAll } from './kbStore/habitVaultRepo'
import { vaultTodosAll } from './kbStore/scheduleVaultRepo'
import { vaultGetEntryById } from './kbStore/blogVaultRepo'
import { pomoSessionsAll } from './kbStore/pomoVaultRepo'
import { vaultWordbookDaily } from './kbStore/wordbookVaultRepo'
import { getKnowledgeIndex } from './kbStore/knowledgeIndex'

/**
 * 习惯跨模块自动打卡服务。
 *
 * 设计口径（docs/habit-module-linkage.md §3.3）：各业务模块只上报「发生了行为」，
 * 不携带指标值；本服务在触发时按业务日期从各模块源数据反查现值，与阈值比对后
 * 幂等写入 habit_records。好处：
 * - 服务无状态：重启不丢进度，漏触发的事件下次自动补上，导入备份后自愈
 * - 幂等：文件内 UNIQUE(habit_id,date) 判定保证只在新打卡时推送
 *
 * R6 去库化（D9）：联动规则读 .knowbase/modules/checkin/links.json，
 * 全部指标反查走 vault 数据源（sql.js 路径已移除）。
 */

export type LinkSource = 'blog' | 'pomodoro' | 'schedule' | 'knowledge' | 'wordbook'

const SOURCE_WHITELIST: LinkSource[] = ['blog', 'pomodoro', 'schedule', 'knowledge', 'wordbook']

/** 业务模块保存行为后上报；date 为行为发生的业务日期（本地 YYYY-MM-DD），非系统当天 */
export interface Activity {
  source: LinkSource
  date: string
  /** 来源实体 ID（博文/页面），用于精确反查该实体的现值；可省略（按日期聚合的场景） */
  refId?: string
  /** 指标现值覆盖：由上报方直接给出反查值（如博客字数） */
  value?: number
}

export interface AutoCheckin {
  habitId: string
  habitName: string
  date: string
}

interface LinkRow {
  habit_id: string; habit_name: string; source: string; threshold: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 本地日期（对标 sqlite date(x,'localtime')） */
function localDay(ts: unknown): string {
  if (typeof ts !== 'string' || !ts) return ''
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 源数据反查：返回当前指标现值；无法确定时返回 null（本次放弃判定） */
function computeMetric(a: Activity): number | null {
  // 上报方自带指标值（如博客 vault 字数）——直接使用
  if (a.value !== undefined && a.value !== null) return a.value
  switch (a.source) {
    // 博客：该篇日志去空白后的字符数（与 word_count 维护口径一致）
    case 'blog': {
      if (!a.refId) return null
      const entry = vaultGetEntryById(a.refId)
      if (!entry) return null
      return (entry.contentMd || '').replace(/\s/g, '').length
    }
    // 番茄钟：当天完成的专注场次
    case 'pomodoro':
      return pomoSessionsAll().filter((r) => r.date === a.date).length
    // 日程：当天完成的顶层任务数（parent_id 为空，避免父子重复计数）
    case 'schedule':
      return vaultTodosAll().filter((r) => r.status === 'done' && r.date === a.date && (r.parent_id === null || r.parent_id === undefined)).length
    // 知识库：当天新建的页面数（created_at 为 UTC ISO 串，转本地日期再比）
    case 'knowledge':
      return getKnowledgeIndex().pages.filter((p) => localDay(p.createdAt) === a.date).length
    // 单词本：当天完成学习的词数（新学+复习）
    case 'wordbook': {
      const row = vaultWordbookDaily().find((r) => r.date === a.date)
      return (row?.new_words ?? 0) + (row?.reviewed ?? 0)
    }
    default:
      return null
  }
}

/**
 * 上报一次行为事件：匹配联动规则 → 源数据反查现值 → 阈值判定 → 幂等写入打卡。
 * 任何失败都静默吞掉 —— 联动是锦上添花，绝不能拖垮业务保存本身。
 * sender 用于向渲染层推送 habit:autoChecked（界面轻提示），可省略。
 */
export function recordActivity(activity: Activity, sender?: WebContents): void {
  try {
    if (!SOURCE_WHITELIST.includes(activity.source)) return
    if (!DATE_RE.test(activity.date)) return

    const links = vaultHabitLinksAll()
      .filter((l) => l.source === activity.source && l.enabled === 1)
      .map((l) => ({
        habit_id: l.habit_id,
        habit_name: vaultHabitsAll().find((h) => h.id === l.habit_id && !h.archived)?.name ?? '',
        source: l.source,
        threshold: l.threshold,
      }))
      .filter((l) => l.habit_name)
    if (links.length === 0) return

    const value = computeMetric(activity)
    if (value === null) return

    const checked: AutoCheckin[] = []
    for (const link of links) {
      if (value < link.threshold) continue
      // 幂等打卡：文件内 UNIQUE(habit_id,date) 判定（返回 true 才算新打卡）
      if (vaultHabitRecordAddIfAbsent(link.habit_id, activity.date, 'auto')) {
        checked.push({ habitId: link.habit_id, habitName: link.habit_name, date: activity.date })
        void notifyCheckin(link.habit_id, activity.date)
      }
    }

    if (checked.length > 0 && sender && !sender.isDestroyed()) {
      sender.send('habit:autoChecked', checked)
    }
  } catch (err) {
    console.error('[habitLink] Auto check-in evaluation failed:', err)
  }
}
