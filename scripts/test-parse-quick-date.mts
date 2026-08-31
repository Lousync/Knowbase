/**
 * parseQuickDate 冒烟测试（纯 Node，无测试框架）
 *
 *   node --experimental-strip-types scripts/test-parse-quick-date.mts
 *
 * 说明：src/daypanel/parseQuickDate.ts 是纯函数，不依赖 Electron / DOM，
 * 因此可直接被 Node 加载。每次改动解析规则后都应跑一遍。
 */
import { parseQuickDate } from '../src/daypanel/parseQuickDate.ts'

/** 固定"今天"为 2026-08-31（周一），保证用例可复现 */
const NOW = new Date(2026, 7, 31)

interface Case {
  input: string
  date: string
  time: string | null
  title: string
}

const CASES: Case[] = [
  // ---- 相对日 ----
  { input: '今天买菜', date: '2026-08-31', time: null, title: '买菜' },
  { input: '明天下午3点开会', date: '2026-09-01', time: '15:00', title: '开会' },
  { input: '后天交作业', date: '2026-09-02', time: null, title: '交作业' },
  { input: '大后天体检', date: '2026-09-03', time: null, title: '体检' },

  // ---- 周 X（含下周 / 下下周；今天周一，"周五"取本周五） ----
  { input: '周五 14:00 复习计网', date: '2026-09-04', time: '14:00', title: '复习计网' },
  { input: '下周三交作业', date: '2026-09-09', time: null, title: '交作业' },
  { input: '下下周一例会', date: '2026-09-14', time: null, title: '例会' },

  // ---- 具体日期 ----
  { input: '8月5号交报告', date: '2027-08-05', time: null, title: '交报告' },  // 今年已过 → 明年
  { input: '12月25号寄礼物', date: '2026-12-25', time: null, title: '寄礼物' },
  { input: '25号取快递', date: '2026-09-25', time: null, title: '取快递' },    // 本月已过 → 下月
  { input: '3号报税', date: '2026-09-03', time: null, title: '报税' },

  // ---- 时间写法 ----
  { input: '09:30 站会', date: '2026-08-31', time: '09:30', title: '站会' },
  { input: '晚上8点半看电影', date: '2026-08-31', time: '20:30', title: '看电影' },
  { input: '上午9点打卡', date: '2026-08-31', time: '09:00', title: '打卡' },

  // ---- 正文数字不得误伤 ----
  { input: '复习第3章', date: '2026-08-31', time: null, title: '复习第3章' },
  { input: '做完 3-4 节练习', date: '2026-08-31', time: null, title: '做完 3-4 节练习' },
  { input: '看 20 页教材', date: '2026-08-31', time: null, title: '看 20 页教材' },

  // ---- 只有时间 / 只有日期 ----
  // 剔除时间后标题为空（说明整句就是个时间）→ 回退原文当标题，不当时间，避免建出无标题任务
  { input: '15:00', date: '2026-08-31', time: null, title: '15:00' },
  { input: '开会', date: '2026-08-31', time: null, title: '开会' },
]

let pass = 0
const failures: string[] = []

for (const c of CASES) {
  const got = parseQuickDate(c.input, NOW)
  const ok = got.date === c.date && got.time === c.time && got.title === c.title
  if (ok) {
    pass++
  } else {
    failures.push(
      `  ✗ 「${c.input}」\n      期望 date=${c.date} time=${c.time} title=${c.title}\n      实际 date=${got.date} time=${got.time} title=${got.title}`,
    )
  }
}

console.log(`parseQuickDate: ${pass}/${CASES.length} 通过`)
if (failures.length > 0) {
  console.error('\n失败用例：')
  for (const f of failures) console.error(f)
  process.exit(1)
}
console.log('全部通过')
