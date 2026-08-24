import { useState, useEffect } from 'react'
import { BellRing } from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'

/** 设置 → 提醒：应用内提醒类功能开关 */
export function ReminderView() {
  const { s, update } = useSettings()
  const [time, setTime] = useState(s.checkinReminderTime || '20:00')

  useEffect(() => { setTime(s.checkinReminderTime || '20:00') }, [s.checkinReminderTime])

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">打卡提醒</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          到达设定时间后，若当天仍有计划内习惯未打卡，会在应用内弹窗提醒（每天至多一次）。
        </p>

        <div className="space-y-3 max-w-md">
          <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] cursor-pointer">
            <span className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
              <BellRing size={14} className={s.checkinReminderEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
              启用打卡提醒
            </span>
            <input
              type="checkbox"
              checked={s.checkinReminderEnabled}
              onChange={e => update('checkinReminderEnabled', e.target.checked)}
              className="accent-[var(--accent)] w-4 h-4"
            />
          </label>

          <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <span className="text-[13px] text-[var(--text-primary)]">提醒时间</span>
            <input
              type="time"
              value={time}
              disabled={!s.checkinReminderEnabled}
              onChange={e => {
                setTime(e.target.value)
                if (/^\d{1,2}:\d{2}$/.test(e.target.value)) void update('checkinReminderTime', e.target.value)
              }}
              className="px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-40"
            />
          </label>

          <p className="text-[11px] text-[var(--text-disabled)] leading-relaxed px-1">
            仅统计"今天计划内且未打卡"的习惯（按各自周期规则判断），已勾选或非计划日不会触发。
            提醒只在应用运行时弹出；若打开应用时已过提醒时间，会立即补一次提醒。
          </p>
        </div>
      </div>
    </div>
  )
}
