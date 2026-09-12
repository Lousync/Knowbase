/**
 * 度量「工具返回结果」的体积 —— 与 measure-tool-schema.mjs（输入侧 schema）配成一对。
 *
 * 为什么需要它：agent loop 每轮把整个 convo 重发给模型（agentService.ts:480），
 * 而工具返回是 `convo.push({role:'tool', content: JSON.stringify(exec.data)})`（:621-625）
 * —— **工具结果会累积增长并随轮次反复重发**。固定 schema 能被 prompt cache 覆盖，
 * 累积的结果不能（每轮都在变长），这才是长任务真正失控的地方。
 *
 * 本脚本用真实 vault 数据（默认演示仓库）复现 quiz.list 的返回形状，给出可对比的硬数字。
 * 用法：node .AGENT/scripts/ai-tools-audit/measure-tool-output.mjs [vaultPath]
 */
import fs from 'node:fs'
import path from 'node:path'

const vault = process.argv[2] ?? 'E:/演示'
const dir = path.join(vault, '.knowbase', 'modules', 'quiz')

const readJson = (f, dflt) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return dflt }
}

const records = readJson('records.json', [])
const tags = readJson('tags.json', [])
const collections = readJson('collections.json', [])
const recTags = readJson('record_tags.json', [])
const recCols = readJson('record_collections.json', [])

const pick = (o, ...keys) => keys.map((k) => o?.[k]).find((v) => v !== undefined)

const tagNameById = new Map(tags.map((t) => [t.id, t.name]))
const colNameById = new Map(collections.map((c) => [c.id, c.name]))

const group = (rows, recKey, valKey, nameById) => {
  const m = new Map()
  for (const r of rows) {
    const rid = pick(r, recKey, 'recordId')
    const vid = pick(r, valKey, 'tagId', 'collectionId')
    if (rid === undefined || vid === undefined) continue
    if (!m.has(rid)) m.set(rid, [])
    m.get(rid).push(nameById.get(vid) ?? String(vid))
  }
  return m
}
const tagsByRec = group(recTags, 'record_id', 'tag_id', tagNameById)
const colsByRec = group(recCols, 'record_id', 'collection_id', colNameById)

/** 与 builtin.quiz.list 的返回映射逐字段对齐（含 question 截断 300） */
function mapRow(r, withQuestion) {
  let q = ''
  try { q = String(JSON.parse(r.snapshot_json ?? '{}').question ?? '') } catch { /* 空 */ }
  return {
    id: r.id,
    pageTitle: r.page_title,
    quizNo: r.quiz_no,
    ...(withQuestion ? { question: q.slice(0, 300) } : {}),
    wrongCount: r.wrong_count,
    correctCount: r.correct_count,
    streakCorrect: r.streak_correct,
    isFavorite: r.is_favorite === 1 || r.is_favorite === true,
    ...(r.note ? { note: r.note } : {}),
    tags: tagsByRec.get(r.id) ?? [],
    collections: colsByRec.get(r.id) ?? [],
    source: [r.source_space, r.source_notebook, r.source_chapter].filter(Boolean).join(' / '),
  }
}

const estTokens = (s) => {
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length
  return Math.round(cjk + (s.length - cjk) / 4)
}

const buildPayload = (limit, withQuestion) => {
  const rows = records.slice(0, limit)
  return JSON.stringify({
    total: records.length,
    returned: Math.min(records.length, limit),
    items: rows.map((r) => mapRow(r, withQuestion)),
  })
}

const out = []
out.push(`vault: ${vault}`)
out.push(`records.json 记录数: ${records.length}｜标签定义 ${tags.length}｜分组定义 ${collections.length}｜标签关联行 ${recTags.length}｜分组关联行 ${recCols.length}`)
out.push('')
out.push('【quiz.list 单次调用返回体积】（真实数据，question 按源码截断 300 字符）')
out.push('limit   withQuestion   字符数    ~tok')
for (const limit of [10, 20, 50, 200]) {
  for (const wq of [true, false]) {
    const s = buildPayload(limit, wq)
    out.push(`${String(limit).padStart(5)}   ${String(wq).padEnd(12)}  ${String(s.length).padStart(7)}  ${String(estTokens(s)).padStart(6)}`)
  }
}
out.push('')

const one = buildPayload(records.length, true)
const oneNow = buildPayload(Math.min(50, records.length), true)
out.push(`全部 ${records.length} 条一次拉取: ${one.length} 字符 ≈ ${estTokens(one)} tok`)
out.push(`默认 limit=50:          ${oneNow.length} 字符 ≈ ${estTokens(oneNow)} tok`)
out.push('')

/** 8 轮 agent 任务（MAX_ITERATIONS=8）下工具结果的重发放大倍数 */
const rounds = 8
const avgHold = (rounds + 1) / 2
out.push('【累积重发放大】agent loop 每轮重发整个 convo —— 第 k 轮的结果会被后续 (N-k) 轮捎带重发')
out.push(`一个 ${rounds} 轮的整理任务里，单次 quiz.list 结果平均被重发 ${avgHold} 次`)
out.push(`若首轮就拉 limit=50（≈${estTokens(oneNow)} tok），它自身在整任务里累计 ≈ ${Math.round(estTokens(oneNow) * avgHold)} tok`)
out.push('')
out.push('注：token 为估算（中文 1 字≈1 token，其余 4 字符≈1 token），用于横向比较。')

const text = out.join('\n')
const dst = path.resolve('.AGENT/scripts/ai-tools-audit/out-tool-output-baseline.txt')
fs.mkdirSync(path.dirname(dst), { recursive: true })
fs.writeFileSync(dst, text, 'utf8')
console.log(text)
