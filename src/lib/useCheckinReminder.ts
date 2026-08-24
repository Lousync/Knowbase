import { useEffect } from 'react'
import { habitGetAll } from './ipc'
import { showToast } from './toast'
import { useSettings } from './SettingsContext'
import { buildRecordIndex, formatLocalDate, isPlannedOn } from '../modules/toolbox/components/habit-tracker/dateUtils'

const CHECK_INTERVAL_MS = 30000
const STORAGE_PREFIX = 'checkinReminded:'

/**
 * 打卡提醒 —— 到达设置的时间后，若当天仍有"计划内且未打卡"的习惯，
 * 弹一次应用内 Toast（每天至多提醒一次，勾选完 / 无计划习惯则静默）。
 * 全局挂载（App 根部），与当前所在页面无关。
 */
export function useCheckinReminder() {
  const { s } = useSettings()

  useEffect(() => {
    if (!s.checkinReminderEnabled) return
    let alive = true
    const timeStr = /^\d{1,2}:\d{2}$/.test(s.checkinReminderTime || '') ? s.checkinReminderTime : '20:00'
    const [hh, mm] = timeStr.split(':').map(Number)

    const check = async () => {
      try {
        const now = new Date()
        const curMin = now.getHours() * 60 + now.getMinutes()
        const target = (hh || 0) * 60 + (mm || 0)
        if (curMin < target) return

        const key = STORAGE_PREFIX + formatLocalDate(now)
        if (localStorage.getItem(key)) return

        // 先占位再查询：避免网络/数据库慢导致 30s 内重复弹窗
        localStorage.setItem(key, '1')

        const data = await habitGetAll()
        if (!alive) return
        const idx = buildRecordIndex(data.records)
        const today = formatLocalDate(now)
        const missed = data.habits.filter(
          h => !h.archived && isPlannedOn(h, now) && !idx.get(h.id)?.has(today)
        )
        if (missed.length === 0) return

        const names = missed.slice(0, 3).map(h => h.name).join('、')
        showToast({
          type: 'warning',
          message: `⏰ 打卡提醒：今天还有 ${missed.length} 个习惯未打卡${missed.length <= 3 ? `（${names}）` : `（${names} 等）`}`,
          duration: 8000,
        })
      } catch {
        // 静默失败，不打扰用户
      }
    }

    void check()
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [s.checkinReminderEnabled, s.checkinReminderTime])
}
