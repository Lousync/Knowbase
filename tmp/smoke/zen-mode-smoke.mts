/**
 * 禅模式冒烟：nextZenLevel 状态机 / countWords 字数口径 / shouldExitZen 弹窗让位。
 * 运行：node --experimental-strip-types --no-warnings tmp/smoke/zen-mode-smoke.mts
 */
import assert from 'node:assert/strict'
import { countWords } from '../../src/lib/wordCount.ts'
import { nextZenLevel, shouldExitZen } from '../../src/lib/zenMode.ts'

let n = 0
const ok = (name: string) => { n++; console.log(`  ok ${n} - ${name}`) }

// ---- nextZenLevel 状态机 ----
assert.equal(nextZenLevel(0, { hasModal: false, hasDocument: true }), 1, 'off→Z1')
ok('off → Z1')

assert.equal(nextZenLevel(1, { hasModal: false, hasDocument: true }), 2, 'Z1→Z2')
assert.equal(nextZenLevel(2, { hasModal: false, hasDocument: true }), 0, 'Z2→off（V1 循环上限=2）')
ok('Z1 → Z2 → off 循环')

assert.equal(nextZenLevel(0, { hasModal: true, hasDocument: true }), 0, '弹窗存在：不进档')
assert.equal(nextZenLevel(2, { hasModal: true, hasDocument: true }), 2, '弹窗存在：切档无效')
ok('弹窗优先：切档让位')

assert.equal(nextZenLevel(0, { hasModal: false, hasDocument: false }), 0, '无文件：不可进入')
assert.equal(nextZenLevel(1, { hasModal: false, hasDocument: false }), 2, '已处于禅模式：无文件仍可继续切（收尾不依赖文档）')
ok('无文档不可进入，已进入可退出循环')

// ---- shouldExitZen ----
assert.equal(shouldExitZen(false), true, '无弹窗：Esc 退出')
assert.equal(shouldExitZen(true), false, '有弹窗：Esc 让位')
ok('Esc 弹窗优先')

// ---- countWords ----
assert.deepEqual(countWords(''), { words: 0, chars: 0 }, '空文档')
ok('空文档 = 0')

assert.deepEqual(countWords('你好世界 hello world'), { words: 6, chars: 14 }, '中英混排：CJK 4 + 单词 2')
ok('中英混排：CJK 字符 + 非 CJK 单词')

assert.deepEqual(
  countWords('---\ntitle: x\n---\n\n正文一段'),
  { words: 4, chars: 4 },
  'frontmatter 不计入',
)
ok('frontmatter 不计入')

assert.deepEqual(countWords('。。。！！！'), { words: 0, chars: 6 }, '纯标点：字数 0，字符计入')
ok('纯标点不计词数')

assert.deepEqual(countWords('v2.15 update #tag 42'), { words: 4, chars: 17 }, '含符号词整体计 1（v2.15/update/#tag/42）')
ok('带符号词整体计数')

assert.equal(countWords('阅读').words, 2, '双字词 = 2')
assert.equal(countWords('a').chars, 1, '单字符')
ok('边界字符')

console.log(`\n禅模式冒烟全部通过：${n} 组断言`)
