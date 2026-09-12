// 模拟错题本界面（QuizCollection）在「408 学习空间」下的渲染结果，核对播种数据
import fs from 'node:fs'

/** 与 seed-quiz.mjs 同口径：本机当天（本地时区） */
function localToday() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const D = 'E:/演示/.knowbase/modules/quiz/'
const rec = JSON.parse(fs.readFileSync(D + 'records.json', 'utf-8'))
const col = JSON.parse(fs.readFileSync(D + 'collections.json', 'utf-8'))
const rc = JSON.parse(fs.readFileSync(D + 'record-collections.json', 'utf-8'))
const tags = JSON.parse(fs.readFileSync(D + 'tags.json', 'utf-8'))
const rt = JSON.parse(fs.readFileSync(D + 'record-tags.json', 'utf-8'))

const SPACE = '408 学习空间'
// quizRecord:list kind=wrong + sourceSpace
const wrongList = rec.filter((r) => (r.wrong_count ?? 0) > 0 && (r.streak_correct ?? 0) < 2 && r.source_space === SPACE)
// 书架分组：空间内按 source_notebook 分书
const bookMap = new Map()
for (const r of wrongList) {
  const k = r.source_notebook || '其他'
  if (!bookMap.has(k)) bookMap.set(k, [])
  bookMap.get(k).push(r)
}
console.log(`待复习错题 ${wrongList.length} 条，书架 ${bookMap.size} 本`)
for (const [name, list] of [...bookMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const wrong = list.filter((r) => r.wrong_count > 0).length
  const fav = list.filter((r) => r.is_favorite).length
  console.log(`\n📕 ${name}  共 ${list.length} 题 · 错 ${wrong} · 藏 ${fav}`)
  // 章节目录
  const chMap = new Map()
  for (const r of list) {
    const k = r.source_chapter || '未分章节'
    if (!chMap.has(k)) chMap.set(k, [])
    chMap.get(k).push(r)
  }
  for (const [ch, cl] of [...chMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const bands = [
      ['顽固错', cl.filter((r) => r.wrong_count >= 4).length],
      ['中错', cl.filter((r) => r.wrong_count >= 2 && r.wrong_count <= 3).length],
      ['轻错', cl.filter((r) => r.wrong_count === 1).length],
    ].filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' / ')
    console.log(`   └ ${ch}（${cl.length} 题）${bands}`)
  }
}

// 侧栏筛选条
console.log('\n自定义分组：')
for (const c of col) {
  const ids = new Set(rec.filter((r) => r.source_space === SPACE).map((r) => r.id))
  const n = rc.filter((l) => l.collection_id === c.id && ids.has(l.record_id)).length
  console.log(`  ${c.name}（${n}）`)
}
console.log('\n标签筛选：')
for (const t of tags) {
  const ids = new Set(rec.filter((r) => r.source_space === SPACE).map((r) => r.id))
  const n = rt.filter((l) => l.tag_id === t.id && ids.has(l.record_id)).length
  console.log(`  ${t.name}（${n}）  [${t.kind}]`)
}

// 统计头
const scoped = rec.filter((r) => r.source_space === SPACE)
const mastered = scoped.filter((r) => r.wrong_count > 0 && (r.streak_correct ?? 0) >= 2).length
const today = localToday()
const todayWrong = scoped.filter((r) => r.last_result === 0 && r.updated_at.slice(0, 10) === today).length
const sumC = scoped.reduce((a, r) => a + r.correct_count, 0)
const sumW = scoped.reduce((a, r) => a + r.wrong_count, 0)
console.log(`\n统计头：待复习 ${wrongList.length} · 已掌握 ${mastered} · 今日错 ${todayWrong} · 正确率 ${Math.round((sumC / (sumC + sumW)) * 100)}%`)
console.log(`备注 ${scoped.filter((r) => r.note).length} 条 · 收藏 ${scoped.filter((r) => r.is_favorite).length} 条`)
