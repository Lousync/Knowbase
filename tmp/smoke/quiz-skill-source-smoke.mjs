// quiz-generator Skill 资产断言：frontmatter 合法 + 格式示例齐全。
// 用法：node tmp/smoke/quiz-skill-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const F = path.join(ROOT, 'resources/skills/quiz-generator/SKILL.md')
const S = fs.readFileSync(F, 'utf-8')
const FM = S.split('---')[1] ?? ''

let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}

console.log('quiz-generator SKILL.md 断言')
ok('文件存在且带 frontmatter', S.startsWith('---') && FM.includes('id: quiz-generator'))
ok('title/description 齐备（description 含触发词"出题/考考我"）',
  FM.includes('title: 出题官') && FM.includes('description:') && S.includes('考考我'))
ok('variables 内联数组 [topic, sourceContext, questionCount]',
  FM.includes('variables: [topic, sourceContext, questionCount]'))
ok('tools 数组声明资料读 + 沉淀写工具',
  FM.includes('builtin.vault.read') && FM.includes('builtin.docs.read-text') && FM.includes('builtin.vault.write'))
ok('选择题格式：quiz 围栏 + JSON 字段（options/answer/explanation，key 大写）',
  S.includes('```quiz') && S.includes('"options":[{"key":"A"') && S.includes('"answer":"C"') && S.includes('"explanation"'))
ok('多选/错项铁律（answer ABD 说明 + 错因讲解）',
  S.includes('"ABD"') && S.includes('常见错因'))
ok('大题格式：spoiler-answer 折叠 + (1)(2)(3) 全角小问 + **解析**： 首行',
  S.includes('```spoiler-answer') && S.includes('(1)') && S.includes('**解析**：'))
ok('沉淀约定：frontmatter type: quiz + tags/source',
  S.includes('type: quiz') && S.includes('tags:') && S.includes('source:'))
ok('质量铁律：出处/难度梯度/错项合理/去重/一次 3-5 题/答错先讲错在哪',
  S.includes('出处') && S.includes('难度梯度') && S.includes('3–5 题') && S.includes('错得合理'))

console.log('安装副本断言（正式 + 两个 dev 数据目录）')
for (const d of [process.env.APPDATA + '/knowbase', process.env.APPDATA + '/knowbase (dev agent-file-tools)', process.env.APPDATA + '/knowbase (dev KnowledgeRecorder)']) {
  const p = path.join(d, 'skills/quiz-generator/SKILL.md')
  ok(`installed: ${p.replace(process.env.APPDATA, '…')}`, fs.existsSync(p))
}

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
