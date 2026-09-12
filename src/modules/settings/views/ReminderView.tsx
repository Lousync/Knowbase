import { useState, useEffect } from 'react'
import { BellRing, AlarmClock } from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { SettingSwitch } from '../../../components/shared/SettingSwitch'
import { SettingSelect } from '../components/SettingSelect'

/** 设置 → 提醒：应用内提醒 + 日程截止系统通知类功能开关 */
export function ReminderView() {
  const { s, update } = useSettings()
  const [time, setTime] = useState(s.checkinReminderTime || '20:00')
  const [quietStart, setQuietStart] = useState(s.scheduleReminderQuietStart || '22:30')
  const [quietEnd, setQuietEnd] = useState(s.scheduleReminderQuietEnd || '07:30')

  useEffect(() => { setTime(s.checkinReminderTime || '20:00') }, [s.checkinReminderTime])
  useEffect(() => { setQuietStart(s.scheduleReminderQuietStart || '22:30') }, [s.scheduleReminderQuietStart])
  useEffect(() => { setQuietEnd(s.scheduleReminderQuietEnd || '07:30') }, [s.scheduleReminderQuietEnd])

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-1">打卡提醒</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          到达设定时间后，若当天仍有计划内习惯未打卡，会在应用内弹窗提醒（每天至多一次）。
        </p>

        <div className="space-y-3 max-w-md">
          <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] cursor-pointer" data-setting-anchor="reminder.enable">
            <span className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
              <BellRing size={14} className={s.checkinReminderEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
              启用打卡提醒
            </span>
            <SettingSwitch checked={s.checkinReminderEnabled} onChange={(v) => update('checkinReminderEnabled', v)} />
          </label>

          <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]" data-setting-anchor="reminder.time">
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

      {/* ---- 日程截止提醒（系统通知） ---- */}
      <div>
        <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-1">任务截止提醒</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          日程任务临近截止时通过 <b className="text-[var(--text-secondary)]">系统通知</b> 提醒，
          点击通知可直接跳回日程模块。提醒基于截止时刻的绝对时间，应用未运行时错过的提醒会在下次打开时汇总补发。
        </p>

        <div className="space-y-3 max-w-md">
          <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] cursor-pointer" data-setting-anchor="reminder.ddlEnable">
            <span className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
              <AlarmClock size={14} className={s.scheduleReminderEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
              启用截止提醒
            </span>
            <SettingSwitch checked={s.scheduleReminderEnabled} onChange={(v) => update('scheduleReminderEnabled', v)} />
          </label>
        </div>

        <div className={s.scheduleReminderEnabled ? '' : 'opacity-40 pointer-events-none select-none'}>
          <div className="space-y-7 max-w-xl mt-5">
            <div data-setting-anchor="reminder.ddlLead">
              <SettingSelect
                title="提前多久提醒"
                description="在任务截止时刻之前多久发出提醒。例如「截止 09:00 + 提前 12 小时」会在前一晚 21:00 提醒。"
                value={String(s.scheduleReminderLead ?? '30')}
                onChange={v => update('scheduleReminderLead', v)}
                options={[
                  { id: '15', label: '提前 15 分钟', desc: '临近截止的最后冲刺提醒' },
                  { id: '30', label: '提前 30 分钟', desc: '留出准备时间的推荐档位', isDefault: true },
                  { id: '60', label: '提前 1 小时', desc: '适合会议、提交等需要提前安排的事项' },
                  { id: '1440', label: '提前 1 天', desc: '跨天提前提醒，适合期限较远的任务' },
                ]}
              />
            </div>

            <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] cursor-pointer max-w-md" data-setting-anchor="reminder.ddlOverdue">
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] text-[var(--text-primary)]">逾期后重复提醒</span>
                <span className="text-[11px] text-[var(--text-muted)]">任务已过截止仍未完成时，继续在后续巡检中提醒</span>
              </span>
              <SettingSwitch checked={s.scheduleReminderOverdueRepeat} onChange={(v) => update('scheduleReminderOverdueRepeat', v)} />
            </label>

            <div data-setting-anchor="reminder.ddlQuiet">
              <h3 className="text-[13px] font-medium text-[var(--text-primary)] mb-1">免打扰时段</h3>
              <p className="text-[11px] text-[var(--text-muted)] mb-2.5 leading-relaxed">
                该时段内不发送提醒（支持跨天，如 22:30 ~ 次日 07:30）；
                <b className="text-[var(--text-secondary)]">错过的提醒会在时段结束后补发一次</b>，不会被丢弃。
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={quietStart}
                  onChange={e => {
                    setQuietStart(e.target.value)
                    if (/^\d{1,2}:\d{2}$/.test(e.target.value)) void update('scheduleReminderQuietStart', e.target.value)
                  }}
                  className="px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <span className="text-[12px] text-[var(--text-muted)]">至</span>
                <input
                  type="time"
                  value={quietEnd}
                  onChange={e => {
                    setQuietEnd(e.target.value)
                    if (/^\d{1,2}:\d{2}$/.test(e.target.value)) void update('scheduleReminderQuietEnd', e.target.value)
                  }}
                  className="px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] cursor-pointer max-w-md" data-setting-anchor="reminder.ddlExternal">
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] text-[var(--text-primary)]">同时推送外部通道</span>
                <span className="text-[11px] text-[var(--text-muted)]">复用「远程监督」已配置的 webhook 推送（默认关闭）</span>
              </span>
              <SettingSwitch checked={s.scheduleReminderExternalPush} onChange={(v) => update('scheduleReminderExternalPush', v)} />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
