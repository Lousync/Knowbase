/**
 * 危险标签/属性剥离（剪藏管线双端使用）。
 * 背景：DOMPurify 在 linkedom（defuddle 的 Node DOM）环境是静默 no-op——sanitize 原样返回输入，
 * 只会给假安全感；故自实现。成对危险标签连内容删、自闭合删壳、on* 事件属性删、javascript: 协议删。
 * 定位是「双保险之一」：defuddle 主提取本身已按白名单重序列化，这里兜住其透传容器（iframe/svg 壳）。
 */
const DANGER_TAGS = '(script|style|iframe|object|embed|form|link|meta|base|svg|math|animate|set)'

export function stripDangerous(html: string): string {
  return html
    .replace(new RegExp('<\\s*' + DANGER_TAGS + '\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>', 'gi'), '')
    .replace(new RegExp('<\\s*' + DANGER_TAGS + '\\b[^>]*/?>', 'gi'), '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
}
