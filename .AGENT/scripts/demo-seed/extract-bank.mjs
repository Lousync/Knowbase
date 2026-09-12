/**
 * 演示仓库题库抽取（配合 seed-quiz.mjs 使用）
 *
 * 从演示仓库 `408 学习空间/历年真题/**` 的 md 里把全部选择题抽成 JSON 题库，
 * 供「给知识点页配课后题」「生成错题记录」两步复用。
 *
 * 用法：node extract-bank.mjs [演示仓库绝对路径]
 * 输出：<脚本目录>/out/quiz-bank.json
 *
 * 解析规则与渲染层 src/components/shared/QuizParser.ts 的旧 408 格式分支等价：
 *   `### 第 N 题（X 分）` + `- **A.** 选项` + ```spoiler-answer 内的 **答案：X** / **解析**：
 * 该分支若在 QuizParser 里改了，这里要同步（两处都改才行）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.argv[2] || process.env.DEMO_VAULT || 'E:/演示'
const OUT = path.join(HERE, 'out')

const QUESTION_HEAD_RE = /^###\s+第\s*(\d+)\s*题(?:\s*[（(]\s*(\d+)\s*分\s*[）)])?/m
const OPTION_RE = /^-\s*\*\*([A-H])\.?\*\*\s*(.*)$/i
const ANSWER_RE = /^\*\*?\s*答案\s*[：:]\s*\*?\s*([A-H]{1,8})\b/im
const EXPLAIN_RE = /^\*\*?\s*解析\s*\*{0,2}\s*[：:]\s*([\s\S]*)$/im

function blockRegex() {
  return /(^|\n)(###\s+第[^\n]*\n[\s\S]*?)(?=\n#{2,4}\s+第|$)/g
}

function parseSpoiler(spoiler) {
  let answer = ''
  const am = spoiler.match(ANSWER_RE)
  if (am) answer = am[1].toUpperCase()
  let explanation = ''
  const em = spoiler.match(EXPLAIN_RE)
  if (em) {
    explanation = em[1].trim().replace(/^答案\s*[：:]?\s*[A-H]{1,8}\s*[，,。]?\s*/i, '')
  } else {
    explanation = spoiler.replace(ANSWER_RE, '').trim()
  }
  return { answer, explanation }
}

function parseQuestionBlock(block) {
  const head = block.match(QUESTION_HEAD_RE)
  if (!head) return null
  const no = parseInt(head[1], 10) || 0
  const points = head[2] || ''
  const spoilerMatch = block.match(/```spoiler-answer\s*\n([\s\S]*?)\n```/)
  const spoiler = spoilerMatch ? spoilerMatch[1] : ''
  const { answer, explanation } = spoiler ? parseSpoiler(spoiler) : { answer: '', explanation: '' }

  const lines = block.split('\n')
  const options = []
  let questionEnd = -1
  let cur = null
  let inSpoiler = false
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (/^```spoiler/i.test(line)) { inSpoiler = !inSpoiler; i++; continue }
    if (inSpoiler) { i++; continue }
    const om = OPTION_RE.exec(line)
    if (om) {
      if (cur) options.push(cur)
      cur = { key: om[1].toUpperCase(), text: om[2] }
      if (questionEnd === -1) questionEnd = i
      i++
    } else if (cur && !/^\s*$/.test(line) && !line.startsWith('---')) {
      cur.text += '\n' + line
      i++
    } else {
      i++
    }
  }
  if (cur) options.push(cur)
  if (options.length < 2 || !answer) return null

  let question = questionEnd >= 0 ? lines.slice(0, questionEnd).join('\n').trim() : ''
  if (question && question.startsWith('###')) {
    question = question.replace(/^###\s+第\s*\d+\s*题(?:\s*[（(]\s*\d+\s*分\s*[）)])?\s*\n?/, '').trim()
  }
  return { no, points, question, options, answer, explanation }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const fm = {}
  if (!m) return { fm, body: text }
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^(\w+):\s*(.*)$/)
    if (mm) fm[mm[1]] = mm[2]
  }
  return { fm, body: text.slice(m[0].length) }
}

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['.knowbase', '.git', '.attachments'].includes(e.name)) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.md')) acc.push(p)
  }
  return acc
}

/** 与 electron/database/repositories/quizRepo.ts 的 vaultResolveSource 同口径（上溯到 space） */
function makeResolver(cats) {
  const catById = new Map(cats.map((c) => [c.id, c]))
  return (categoryId) => {
    let space = ''
    let notebook = ''
    const folders = []
    let curId = categoryId
    let guard = 0
    while (curId && guard++ < 12) {
      const cat = catById.get(curId)
      if (!cat) break
      if (cat.categoryType === 'space') { space = cat.name; break }
      if (cat.categoryType === 'notebook') { if (!notebook) notebook = cat.name }
      else if (cat.categoryType === 'folder' && cat.name) folders.unshift(cat.name)
      curId = cat.parentId
    }
    return { space, notebook, chapter: folders.join(' › ') }
  }
}

const files = walk(ROOT)
const cats = JSON.parse(fs.readFileSync(path.join(ROOT, '.knowbase/modules/knowledge/categories.json'), 'utf-8'))
const resolveSource = makeResolver(cats)

const bank = []
const pages = []
for (const f of files) {
  const text = fs.readFileSync(f, 'utf-8')
  if (!/### 第 \d+ 题/.test(text)) continue
  const { fm, body } = parseFrontmatter(text)
  // 跳过 seed-quiz.mjs 自己播种的《## 配套练习》章节——否则第二次抽取会把配套题
  // 当成新题目重复收进题库（题库从 720 变 792 的坑，2026-09-12 踩过一次）。
  const cut = body.indexOf('\n## 配套练习')
  const scanBody = cut === -1 ? body : body.slice(0, cut)
  const rel = path.relative(ROOT, f).split(path.sep).join('/')
  const src = resolveSource(fm.category)
  const pageRec = { file: rel, id: fm.id, title: fm.title, ...src, quizzes: 0 }
  pages.push(pageRec)
  let m
  const re = blockRegex()
  while ((m = re.exec(scanBody)) !== null) {
    const q = parseQuestionBlock(m[2])
    if (q) {
      bank.push({ ...q, pageId: fm.id, pageTitle: fm.title, rel, ...src })
      pageRec.quizzes++
    }
  }
}

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'quiz-bank.json'), JSON.stringify(bank, null, 1), 'utf-8')
console.log(`仓库: ${ROOT}`)
console.log(`题库题量: ${bank.length} | 来源页: ${pages.length}`)
const byNb = {}
for (const q of bank) byNb[q.notebook] = (byNb[q.notebook] || 0) + 1
console.log('按笔记本:', JSON.stringify(byNb))
console.log(`输出: ${path.join(OUT, 'quiz-bank.json')}`)
