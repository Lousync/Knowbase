/**
 * frontmatter 泛查询求值器（knowledge-index-design §2 缺口4 / A3-1）—— 纯函数，node 冒烟可跑。
 *
 * 文法（白名单，无代码执行——对齐插件设计 §5.4 的 when 表达式约定）：
 *   expr      := andExpr ( '||' andExpr )*
 *   andExpr   := cond ( '&&' cond )*
 *   cond      := key op value
 *   op        := == | != | >= | <= | > | <
 *   key       := 裸词（字母/数字/_-/. 和中文）
 *   value     := 裸词 | '单引号' | "双引号" | 数字 | true/false/null
 *
 * 比较语义：两侧都能解析为数字 → 数值比较；否则字符串比较（ISO 日期天然字典序可用）。
 * 键缺失：== / > / < / >= / <= 一律 false；!= 为 true（undefined 不等于任何值）。
 * 不支持括号（场景是简单过滤，组合优先级 && > || 已够用）；语法错误抛 Error（含位置）。
 */

export type FmValue = string | number | boolean

const KEY_RE = /[\w.\-\u4e00-\u9fa5]+/u

interface Token {
  kind: 'word' | 'value' | 'op' | 'and' | 'or'
  text: string
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const s = input.trim()
  while (i < s.length) {
    const rest = s.slice(i)
    if (/^\s+/.test(rest)) { i += /^\s+/.exec(rest)![0].length; continue }
    if (rest.startsWith('&&')) { tokens.push({ kind: 'and', text: '&&' }); i += 2; continue }
    if (rest.startsWith('||')) { tokens.push({ kind: 'or', text: '||' }); i += 2; continue }
    const opM = /^(==|!=|>=|<=|>|<)/.exec(rest)
    if (opM) { tokens.push({ kind: 'op', text: opM[1] }); i += opM[1].length; continue }
    const qM = /^(['"])([\s\S]*?)\1/.exec(rest)
    if (qM) { tokens.push({ kind: 'value', text: qM[2] }); i += qM[0].length; continue }
    const wM = KEY_RE.exec(rest)
    if (wM) {
      const word = wM[0]
      // true/false/null 是值；其余裸词在 op 后视为值，在 cond 起点视为键
      tokens.push({ kind: /^(true|false|null)$/i.test(word) && (tokens.length === 0 || tokens[tokens.length - 1].kind !== 'op') ? 'value' : 'word', text: word })
      i += word.length
      continue
    }
    throw new Error(`frontmatter 查询语法错误（位置 ${i}）：不认识的字符「${s[i]}」`)
  }
  return tokens
}

function tokenizeCond(input: string): { key: string; op: string; value: string } {
  const tokens = tokenize(input)
  if (tokens.length !== 3) throw new Error(`frontmatter 查询条件需要「键 运算符 值」三段：${input}`)
  const [k, op, v] = tokens
  if (k.kind !== 'word') throw new Error(`frontmatter 查询：条件开头应为键名：${input}`)
  if (op.kind !== 'op') throw new Error(`frontmatter 查询：缺少比较运算符（== != > >= < <=）：${input}`)
  if (v.kind !== 'value' && v.kind !== 'word') throw new Error(`frontmatter 查询：缺少比较值：${input}`)
  return { key: k.text, op: op.text, value: v.text }
}

function compare(actual: FmValue | undefined, op: string, expected: string): boolean {
  if (actual === undefined || actual === null) return op === '!='
  const aStr = String(actual)
  const aNum = Number(actual)
  const eNum = Number(expected)
  const numeric = expected.trim() !== '' && Number.isFinite(aNum) && Number.isFinite(eNum) && typeof actual !== 'boolean'
  const a = numeric ? aNum : aStr.toLowerCase()
  const e = numeric ? eNum : expected.toLowerCase()
  switch (op) {
    case '==': return a === e
    case '!=': return a !== e
    case '>': return a > e
    case '>=': return a >= e
    case '<': return a < e
    case '<=': return a <= e
    default: throw new Error(`frontmatter 查询：不支持的运算符 ${op}`)
  }
}

/** 求值一条 frontmatter 查询表达式；语法错误抛 Error（消息面向用户） */
export function evaluateFrontmatterQuery(expr: string, fm: Record<string, FmValue>): boolean {
  const tokens = tokenize(expr)
  if (tokens.length === 0) throw new Error('frontmatter 查询：表达式为空')
  // 手写递归下降：or → and → cond（词序列切分，cond 恰好 3 个 token）
  let pos = 0
  const peek = () => tokens[pos]

  function parseCond(): boolean {
    const cond = tokens.slice(pos, pos + 3)
    if (cond.length < 3 || cond[0].kind !== 'word' || cond[1].kind !== 'op' || (cond[2].kind !== 'value' && cond[2].kind !== 'word')) {
      throw new Error(`frontmatter 查询：条件需为「键 运算符 值」，此处解析到：${cond.map(t => t.text).join(' ') || '（空）'}`)
    }
    pos += 3
    return compare(fm[cond[0].text], cond[1].text, cond[2].text)
  }

  function parseAnd(): boolean {
    let v = parseCond()
    while (peek()?.kind === 'and') { pos++; v = parseCond() && v }
    return v
  }

  function parseOr(): boolean {
    let v = parseAnd()
    while (peek()?.kind === 'or') { pos++; v = parseAnd() || v }
    return v
  }

  const result = parseOr()
  if (pos !== tokens.length) throw new Error(`frontmatter 查询：多余的部分「${tokens.slice(pos).map(t => t.text).join(' ')}」`)
  return result
}
