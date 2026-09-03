/**
 * 联网搜索服务 —— 内置只读工具 builtin.web.search 的数据源。
 * - 主源 Bing 网页搜索（免 key）：www.bing.com/search?q=（大陆网络可达，实测 ~2s）
 * - 备源 DuckDuckGo HTML 端点（免 key）：html.duckduckgo.com/html/?q=（部分网络不可达，短超时兜底）
 * - 仅请求固定域名（无 SSRF 面）；结果只返回 标题/链接/摘要片段（控制 token）
 * - 主进程使用：Node 全局 fetch（Electron 33 主进程 Node >= 18）
 */

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchOutput {
  /** 命中的来源：bing / duckduckgo */
  source: 'bing' | 'duckduckgo'
  results: WebSearchResult[]
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_RESULTS = 20
const TITLE_MAX = 200
const SNIPPET_MAX = 300

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_HTML_BYTES) throw new Error('响应过大')
    return new TextDecoder('utf-8', { fatal: false }).decode(buf)
  } finally {
    clearTimeout(timer)
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x2F;|&#47;/g, '/')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&ensp;|&emsp;/g, ' ')
    .replace(/&#0183;|&middot;/g, '·')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** DDG /l/ 重定向链接 → 解码 uddg 参数得到真实 URL */
function cleanUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) {
    try { return decodeURIComponent(m[1]) } catch { /* fallthrough */ }
  }
  if (href.startsWith('//')) return 'https:' + href
  return href
}

/** Bing 网页搜索解析（b_algo 块：h2 > a 标题 + p 摘要） */
function parseBing(html: string): WebSearchResult[] {
  const out: WebSearchResult[] = []
  for (const block of html.split(/<li class="b_algo"/)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>\s*<\/h2>/)
    if (!a) continue
    const title = stripTags(a[2]).slice(0, TITLE_MAX)
    if (!title) continue
    const url = a[1]
    if (!/^https?:\/\//.test(url)) continue
    const p = block.match(/<p[^>]*>(.*?)<\/p>/)
    const snippet = (p ? stripTags(p[1]) : '').slice(0, SNIPPET_MAX)
    out.push({ title, url, snippet })
    if (out.length >= MAX_RESULTS) break
  }
  return out
}

/** DuckDuckGo HTML 端点解析（result 块：result__a 标题 + result__snippet 摘要） */
function parseDuckDuckGo(html: string): WebSearchResult[] {
  const out: WebSearchResult[] = []
  for (const block of html.split(/<div[^>]*class="[^"]*result\b/)) {
    const a = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/)
    if (!a) continue
    const title = stripTags(a[2]).slice(0, TITLE_MAX)
    if (!title) continue
    const url = cleanUrl(a[1])
    if (!/^https?:\/\//.test(url)) continue
    const snip = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/)
    const snippet = (snip ? stripTags(snip[1]) : '').slice(0, SNIPPET_MAX)
    out.push({ title, url, snippet })
    if (out.length >= MAX_RESULTS) break
  }
  return out
}

/** 联网搜索：Bing 优先（大陆可达），DuckDuckGo 短超时兜底 */
export async function webSearch(query: string, limit = 8): Promise<WebSearchOutput> {
  const q = String(query ?? '').trim()
  if (!q) throw new Error('搜索关键词不能为空')
  const count = Math.min(Math.max(Math.floor(limit), 1), MAX_RESULTS)
  const enc = encodeURIComponent(q)

  const bing = await trySearch(
    `https://www.bing.com/search?q=${enc}&setlang=zh-hans`,
    parseBing,
    count,
    'bing',
    8000
  )
  if (bing.ok) return bing.out!

  const ddg = await trySearch(
    `https://html.duckduckgo.com/html/?q=${enc}`,
    parseDuckDuckGo,
    count,
    'duckduckgo',
    5000
  )
  if (ddg.ok) return ddg.out!

  throw new Error(`联网搜索失败（Bing: ${bing.err}；DuckDuckGo: ${ddg.err}）`)
}

async function trySearch(
  url: string,
  parser: (html: string) => WebSearchResult[],
  count: number,
  source: WebSearchOutput['source'],
  timeoutMs: number
): Promise<{ ok: true; out: WebSearchOutput } | { ok: false; err: string }> {
  try {
    const html = await fetchText(url, timeoutMs)
    const results = parser(html).slice(0, count)
    if (results.length === 0) return { ok: false, err: '无结果' }
    return { ok: true, out: { source, results } }
  } catch (e: any) {
    return { ok: false, err: String(e?.message ?? e).slice(0, 120) }
  }
}
