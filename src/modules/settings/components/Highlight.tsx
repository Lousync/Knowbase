import { Fragment } from 'react'

/** 把命中的关键词片段高亮出来（大小写不敏感，按字符标记，兼容中文） */
export function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  const valid = tokens.map(t => t.toLowerCase()).filter(Boolean)
  if (valid.length === 0) return <>{text}</>

  const lower = text.toLowerCase()
  const marked = new Array<boolean>(text.length).fill(false)
  for (const t of valid) {
    let from = 0
    for (;;) {
      const i = lower.indexOf(t, from)
      if (i < 0) break
      for (let k = i; k < i + t.length && k < text.length; k++) marked[k] = true
      from = i + t.length
    }
  }

  const parts: { s: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = marked[i]
    const last = parts[parts.length - 1]
    if (last && last.hit === hit) last.s += text[i]
    else parts.push({ s: text[i], hit })
  }

  return (
    <>
      {parts.map((p, i) => p.hit
        ? <mark key={i} className="bg-transparent text-[var(--accent)] font-semibold">{p.s}</mark>
        : <Fragment key={i}>{p.s}</Fragment>)}
    </>
  )
}

/** 把查询串切成用于高亮的 token */
export function highlightTokens(query: string): string[] {
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean)
  const joined = query.toLowerCase().replace(/\s+/g, '')
  if (joined && !parts.includes(joined)) parts.push(joined)
  return parts
}
