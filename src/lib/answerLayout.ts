/**
 * 大题答案解析排版优化：让每个小问单独一行。
 *
 * 问题背景：408 知识包大题解析里，小问常以「1、」「2、」「(1)」「1)」等编号开头，
 * 但同一段内编号前的内容（上一小问正文）没有断行，导致「1、…并深度加 1。2、结点数据…」挤在一起。
 *
 * 处理：仅在"句末标点（。！？：；,）之后的小问编号"前插入空行（跳过代码围栏），
 * 使每个小问成为独立段落。要求编号后紧跟中文/字母（标题或内容起始），
 * 避免误伤数学表达式（如 (key×3) mod 7 的 ×3)、O(n) 的括号、0.7 小数、192.1 IP 等数值场景。
 */
const SENT_END = /[。！？：；;，]/
const QUESTION_NUM = /[（(]?\d{1,2}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z]/

export function normalizeAnswerLayout(text: string): string {
  if (!text || !QUESTION_NUM.test(text)) return text
  const lines = text.split('\n')
  const out: string[] = []
  let inFence = false
  for (const line of lines) {
    // 代码围栏切换：围栏内不做任何断行（避免破坏代码块）
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (!inFence && QUESTION_NUM.test(line)) {
      const fixed = line.replace(
        /([。！？：；;，])(?=\s*[（(]?\d{1,2}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z])/g,
        '$1\n\n',
      )
      out.push(...fixed.split('\n'))
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}
