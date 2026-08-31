/**
 * 快速添加轻量时间解析（纯函数，便于单测）
 *
 * 示例：
 *   『周五 14:00 复习计网』→ { title: '复习计网', date: 下个周五, time: '14:00' }
 *   『明天下午3点开会』    → { title: '开会', date: 明天, time: '15:00' }
 *   『8月5号交报告』      → { title: '交报告', date: 今年/明年 8月5日, time: null }
 *   『复习第3章』         → { title: '复习第3章', date: 今天, time: null }（不误伤正文数字）
 *
 * 规则：
 * - 时间：HH:mm / HH：mm / X点[半]（支持 早上/上午/中午/下午/晚上 前缀，下午/晚上 <12 时 +12）
 * - 日期：今天/明天/后天/大后天、周X/星期X/礼拜X（含 下周X / 下下周X）、X号/X日、X月X日、MM-DD
 * - 命中的片段从标题中剔除；未命中日期 → 今天；未命中时间 → null
 */

export interface ParsedQuickInput {
  title: string
  date: string // YYYY-MM-DD
  time: string | null // HH:mm
}

const WEEKDAY_TOKENS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

/** 从文本中剔除匹配片段并清理多余空白 */
function cut(text: string, m: RegExpExecArray): string {
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length))
    .replace(/\s+/g, ' ')
    .replace(/^[，,。、\-—\s]+|[，,、\-—\s]+$/g, '')
    .trim()
}

export function parseQuickDate(raw: string, now: Date = new Date()): ParsedQuickInput {
  const fallback = (): ParsedQuickInput => ({ title: raw.trim(), date: toDateStr(now), time: null })
  let text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return fallback()
  let time: string | null = null
  let date: string | null = null
  let m: RegExpExecArray | null

  // ---- 时间：HH:mm（避免吞掉标题中的普通数字，前后不得贴数字） ----
  m = /(?:^|[^\d:])([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/.exec(text)
  if (m) {
    time = `${pad(+m[1])}:${m[2]}`
    text = cut(text, m)
  }

  // ---- 时间：X点[半]（支持上午/下午等前缀） ----
  if (!time) {
    m = /(早上|上午|中午|下午|晚上)?\s*([01]?\d|2[0-3])点(半)?(?![\d分秒])/.exec(text)
    if (m) {
      let h = +m[2]
      const prefix = m[1] || ''
      if ((prefix === '下午' || prefix === '晚上') && h < 12) h += 12
      time = `${pad(h)}:${m[3] ? '30' : '00'}`
      text = cut(text, m)
    }
  }

  // ---- 日期：相对日（先长后短，避免『大后天』被『后天』截胡） ----
  const relatives: Array<[RegExp, number]> = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明天|明日/, 1],
    [/今天|今日/, 0],
  ]
  for (const [re, offset] of relatives) {
    if (date) break
    m = re.exec(text)
    if (m) {
      date = toDateStr(addDays(now, offset))
      text = cut(text, m)
    }
  }

  // ---- 日期：周X（下周X / 下下周X → 严格未来的下一个该星期几，再 +7/+14） ----
  if (!date) {
    m = /(下下|下)?(周|礼拜|星期)([日天一二三四五六])(?![日天一二三四五六])/.exec(text)
    if (m) {
      const target = WEEKDAY_TOKENS[m[3]]
      let delta = (target - now.getDay() + 7) % 7
      if (delta === 0) delta = 7
      if (m[1] === '下') delta += 7
      if (m[1] === '下下') delta += 14
      date = toDateStr(addDays(now, delta))
      text = cut(text, m)
    }
  }

  // ---- 日期：X月X日/X月X号（已过 → 明年同日） ----
  if (!date) {
    m = /(?<!\d)(\d{1,2})月(\d{1,2})[号日](?!\d)/.exec(text)
    if (m) {
      const mo = +m[1]
      const day = +m[2]
      if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
        let d = new Date(now.getFullYear(), mo - 1, day)
        if (toDateStr(d) < toDateStr(now)) d = new Date(now.getFullYear() + 1, mo - 1, day)
        date = toDateStr(d)
        text = cut(text, m)
      }
    }
  }

  // ---- 日期：X号/X日（本月；早于今天 → 下月） ----
  if (!date) {
    m = /(?<!\d)(\d{1,2})[号日](?!\d)/.exec(text)
    if (m) {
      const day = +m[1]
      if (day >= 1 && day <= 31) {
        let d = new Date(now.getFullYear(), now.getMonth(), day)
        if (toDateStr(d) < toDateStr(now)) d = new Date(now.getFullYear(), now.getMonth() + 1, day)
        date = toDateStr(d)
        text = cut(text, m)
      }
    }
  }

  // ---- 日期：MM-DD / MM/DD（排除 3-4节/页 之类正文数字） ----
  if (!date) {
    m = /(?<![\d/-])(\d{1,2})[-/](\d{1,2})(?![\d/-章节页条款个题道])/.exec(text)
    if (m) {
      const mo = +m[1]
      const day = +m[2]
      if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
        let d = new Date(now.getFullYear(), mo - 1, day)
        if (toDateStr(d) < toDateStr(now)) d = new Date(now.getFullYear() + 1, mo - 1, day)
        date = toDateStr(d)
        text = cut(text, m)
      }
    }
  }

  // 标题剔除后为空（如输入只有时间）→ 回退原文
  if (!text) return fallback()
  return { title: text, date: date ?? toDateStr(now), time }
}
