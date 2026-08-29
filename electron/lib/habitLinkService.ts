import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../database/connection'
import { notifyCheckin } from './pushService'

/**
 * 习惯跨模块自动打卡服务。
 *
 * 设计口径（docs/habit-module-linkage.md §3.3）：各业务模块只上报「发生了行为」，
 * 不携带指标值；本服务在触发时按业务日期从各模块源表反查现值，与阈值比对后
 * INSERT OR IGNORE 写入 habit_records。好处：
 * - 服务无状态：重启不丢进度，漏触发的事件下次自动补上，导入备份后自愈
 * - 幂等：UNIQUE(habit_id, date) + getRowsModified() 保证只在新打卡时推送
 */

export type LinkSource = 'blog' | 'pomodoro' | 'schedule' | 'knowledge' | 'wordbook'

const SOURCE_WHITELIST: LinkSource[] = ['blog', 'pomodoro', 'schedule', 'knowledge', 'wordbook']

/** 业务模块保存行为后上报；date 为行为发生的业务日期（本地 YYYY-MM-DD），非系统当天 */
export interface Activity {
  source: LinkSource
  date: string
  /** 来源实体 ID（博文/页面），用于精确反查该实体的现值；可省略（按日期聚合的场景） */
  refId?: string
}

export interface AutoCheckin {
  habitId: string
  habitName: string
  date: string
}

interface LinkRow {
  habit_id: string; habit_name: string; source: string; threshold: number
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  return queryAll<T>(sql, params)[0]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 源表反查：返回当前指标现值；无法确定时返回 null（本次放弃判定） */
function computeMetric(a: Activity): number | null {
  const db = getDatabase()
  switch (a.source) {
    // 博客：该篇日志去空白后的字符数（与 word_count 维护口径一致）
    case 'blog': {
      if (!a.refId) return null
      const row = queryOne<{ content_md: string }>('SELECT content_md FROM entries WHERE id = ?', [a.refId])
      if (!row) return null
      return (row.content_md || '').replace(/\s/g, '').length
    }
    // 番茄钟：当天完成的专注场次
    case 'pomodoro': {
      const row = queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM pomodoro_sessions WHERE date = ?', [a.date])
      return row?.n ?? 0
    }
    // 日程：当天完成的顶层任务数（parent_id IS NULL，避免父子重复计数）
    case 'schedule': {
      const row = queryOne<{ n: number }>(
        "SELECT COUNT(*) AS n FROM schedule_todos WHERE status = 'done' AND date = ? AND parent_id IS NULL",
        [a.date]
      )
      return row?.n ?? 0
    }
    // 知识库：当天新建的页面数（created_at 为 UTC ISO 串，转本地日期再比）
    case 'knowledge': {
      const row = queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM knowledge_pages WHERE date(created_at, 'localtime') = ?", [a.date])
      return row?.n ?? 0
    }
    // 单词本：当天完成学习的词数（新学+复习）
    case 'wordbook': {
      const row = queryOne<{ new_words: number; reviewed: number }>('SELECT new_words, reviewed FROM wordbook_daily WHERE date = ?', [a.date])
      return (row?.new_words ?? 0) + (row?.reviewed ?? 0)
    }
    default:
      return null
  }
}

/**
 * 上报一次行为事件：匹配联动规则 → 源表反查现值 → 阈值判定 → 幂等写入打卡。
 * 任何失败都静默吞掉 —— 联动是锦上添花，绝不能拖垮业务保存本身。
 * sender 用于向渲染层推送 habit:autoChecked（界面轻提示），可省略。
 */
export function recordActivity(activity: Activity, sender?: WebContents): void {
  try {
    if (!SOURCE_WHITELIST.includes(activity.source)) return
    if (!DATE_RE.test(activity.date)) return

    const links = queryAll<LinkRow>(
      `SELECT l.habit_id AS habit_id, h.name AS habit_name, l.source AS source, l.threshold AS threshold
       FROM habit_links l JOIN habits h ON h.id = l.habit_id
       WHERE l.source = ? AND l.enabled = 1 AND h.archived = 0`,
      [activity.source]
    )
    if (links.length === 0) return

    const value = computeMetric(activity)
    if (value === null) return

    const db = getDatabase()
    const checked: AutoCheckin[] = []
    for (const link of links) {
      if (value < link.threshold) continue
      db.run(
        "INSERT OR IGNORE INTO habit_records (id, habit_id, date, source) VALUES (?, ?, ?, 'auto')",
        [randomUUID(), link.habit_id, activity.date]
      )
      // 只有真正插入新行（今天之前没打过卡）才算一次新打卡：自动保存反复触发不重复推送
      if (db.getRowsModified() > 0) {
        checked.push({ habitId: link.habit_id, habitName: link.habit_name, date: activity.date })
        void notifyCheckin(link.habit_id, activity.date)
      }
    }
    saveToDisk()

    if (checked.length > 0 && sender && !sender.isDestroyed()) {
      sender.send('habit:autoChecked', checked)
    }
  } catch (err) {
    console.error('[habitLink] 自动打卡判定失败:', err)
  }
}
