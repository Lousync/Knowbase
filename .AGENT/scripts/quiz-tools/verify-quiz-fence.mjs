// 契约验证：builtin.quiz.gen-paper 落盘的练习页能否被真实 QuizParser 解析成题卡。
//
// 为什么需要它：gen-paper 生成的 .md 必须让 extractQuizzes 认出题目、
// 且题号必须重排为 1..N —— 否则答题回报 (pageId, quizNo) 会与页面题序错位，
// 错题回流就记到了错误的题上。这是整条「错题 → 组卷 → 重练 → 回流」闭环里
// 最容易静默出错的一环，所以用真实解析器而不是复制品来验。
//
// 运行（项目根目录）：
//   node --experimental-strip-types --no-warnings .AGENT/scripts/quiz-tools/verify-quiz-fence.mjs
// 期望：输出 PASS 且 exit=0

import { extractQuizzes } from '../../../src/components/shared/QuizParser.ts'

// 记录里的快照：no 是它在"原页面"的序号，组卷时必须重排
const snapshot = {
  no: 7,
  question: '关于二叉树的遍历，下列说法正确的是？',
  options: [
    { key: 'A', text: '前序遍历先访问根结点' },
    { key: 'B', text: '中序遍历先访问左子树' },
    { key: 'C', text: '后序遍历先访问右子树' },
    { key: 'D', text: '层序遍历使用栈实现' },
  ],
  answer: 'A',
  explanation: '前序遍历顺序为 根→左→右。',
}

// ↓↓↓ 与 electron/lib/builtinTools.ts 中 builtin.quiz.gen-paper 的落盘代码逐字一致 ↓↓↓
const picked = [snapshot]
const lines = []
lines.push('# 错题重练 · 2026-09-12')
lines.push('')
lines.push('> 由错题本自动组卷（全部学习空间），共 1 题，生成于 2026-09-12。')
lines.push('> 直接在本页作答：答错的题会自动回流到错题本，答对两次即视为已掌握。')
lines.push('')
picked.forEach((snap, i) => {
  lines.push('```quiz')
  lines.push(JSON.stringify({
    no: i + 1,
    points: '',
    question: snap.question,
    options: snap.options,
    answer: snap.answer,
    explanation: snap.explanation || '',
  }))
  lines.push('```')
  lines.push('')
})
const md = lines.join('\n')
// ↑↑↑ 改动上面这段时，务必同步 builtinTools.ts 的 gen-paper 实现 ↑↑↑

console.log('--- 生成的页面 markdown ---')
console.log(md)
console.log('--- QuizParser 解析结果 ---')
const items = extractQuizzes(md)
console.log('extracted =', items.length)

if (items.length !== 1) {
  console.error(`FAIL: 期望解析出 1 题，实得 ${items.length}`)
  process.exit(1)
}
const q = items[0]
const checks = [
  ['题号已重排为 1', q.no === 1],
  ['选项 4 个', q.options.length === 4],
  ['答案可取', q.answer === 'A'],
  ['题干含关键词', q.question.includes('二叉树')],
  ['解析可取', q.explanation.includes('根→左→右')],
]
let pass = true
for (const [name, ok] of checks) {
  console.log(`${ok ? '  ok  ' : ' fail '} ${name}`)
  if (!ok) pass = false
}
console.log(pass ? 'PASS: 围栏格式与 QuizParser 契约一致' : 'FAIL: 字段不符')
process.exit(pass ? 0 : 1)
