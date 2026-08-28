import { useEffect } from 'react'
import { onHabitAutoChecked } from './ipc'
import { showToast } from './toast'

/**
 * 习惯跨模块自动打卡的全局轻提示。
 * 挂在 App 层 —— 联动可能在任意模块触发（如博客写作时），
 * 监听放在习惯打卡组件内会因组件未挂载而漏提示。
 */
export function useHabitAutoCheckinToast() {
  useEffect(() => {
    return onHabitAutoChecked(items => {
      for (const it of items) {
        showToast({ type: 'info', message: `⚡「${it.habitName}」已自动打卡（${it.date}）` })
      }
    })
  }, [])
}
