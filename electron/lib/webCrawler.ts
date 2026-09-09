/**
 * 网页素材目录展开与批量抓取内核（.claude/plans/ai-teaching-web-source-crawl.md）
 *
 * 定位：纯程序流水线（零 LLM token），供 AI教学素材库「展开网页」调用——
 * probeWeb 判定 门户/目录/单文章 → parseToc 章节清单 → crawlQueue 批量 cleanPage 落盘。
 * 正文清洗复用剪藏管线 extractArticle（Defuddle+turndown），不另写启发式。
 *
 * 站点画像（SITE_PROFILES）刻意保持**纯数据 + 具名预处理钩子**结构：
 * 以后新站适配只需追加一条画像（或让 code 插件贡献同样形状的数据），不动内核。
 */
import { parseHTML } from 'linkedom'
import { extractArticle } from './clipperServer/extract'

// ===== 类型 =====

export interface SiteProfile {
  id: string
  /** 匹配 hostname 后缀（'runoob.com' 命中 www.runoob.com） */
  host: string
  /** 目录容器选择器；null = 走通用评分回退 */
  tocSelector: string | null
  /** 容器内条目链接选择器（默认 'a'） */
  tocItem?: string
  /** 分组标题选择器（容器内按文档序扫，遇到即切换当前组名） */
  groupBy?: string
  /** 排除路径正则（对 URL pathname 匹配即剔除，如参考手册/测验区） */
  excludePathRe?: string
  /** 代码块预处理钩子名（内核内注册表，画像保持纯数据） */
  preprocessId?: string
  /** 门户页锚点直达表：素材名关键词 → 教程入口 URL */
  anchorHints?: Array<{ kw: string; url: string; title: string }>
}

export interface TocChapter {
  no: number
  title: string
  url: string
  group: string
  defaultChecked: boolean
}

export interface ProbeResult {
  ok: boolean
  error?: string
  /** portal=门户页需选锚点；toc=目录页含章节清单；article=单文章页 */
  kind?: 'portal' | 'toc' | 'article'
  anchor?: string
  title?: string
  chapters?: TocChapter[]
  candidates?: Array<{ title: string; url: string }>
}

export interface CrawlPageResult {
  no: number
  title: string
  file: string
  url: string
}

export interface CrawlOutcome {
  done: CrawlPageResult[]
  failed: Array<{ url: string; title: string; reason: string }>
  skipped: number[]
}

// ===== 站点画像表（一期内置；结构预留外部加载/插件贡献） =====

export const SITE_PROFILES: SiteProfile[] = [
  {
    id: 'runoob',
    host: 'runoob.com',
    tocSelector: '#leftcolumn',
    tocItem: 'a',
    groupBy: 'h2,h3,div.left',
    excludePathRe: '^/(tags|quiz|charsets|w3c|cssref|jsref|php)(/|$)',
    preprocessId: 'runoob-code',
    anchorHints: [
      { kw: 'HTML', url: 'https://www.runoob.com/html/html-tutorial.html', title: 'HTML 教程' },
      { kw: 'CSS', url: 'https://www.runoob.com/css/css-tutorial.html', title: 'CSS 教程' },
      { kw: 'JavaScript', url: 'https://www.runoob.com/js/js-tutorial.html', title: 'JavaScript 教程' },
      { kw: 'Python', url: 'https://www.runoob.com/python3/python3-tutorial.html', title: 'Python3 教程' },
      { kw: 'Java', url: 'https://www.runoob.com/java/java-tutorial.html', title: 'Java 教程' },
      { kw: 'C++', url: 'https://www.runoob.com/cplusplus/cpp-tutorial.html', title: 'C++ 教程' },
      { kw: 'MySQL', url: 'https://www.runoob.com/mysql/mysql-tutorial.html', title: 'MySQL 教程' },
      { kw: 'Linux', url: 'https://www.runoob.com/linux/linux-tutorial.html', title: 'Linux 教程' },
      { kw: 'Git', url: 'https://www.runoob.com/git/git-tutorial.html', title: 'Git 教程' },
    ],
  },
]

/** hostname → 画像（后缀匹配）。未来可在此处并入插件贡献的画像 */
export function profileFor(url: string): SiteProfile | null {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return null }
  return SITE_PROFILES.find(p => host === p.host || host.endsWith('.' + p.host)) ?? null
}

// ===== 代码块预处理钩子（画像 preprocessId 路由） =====

const PREPROCESS: Record<string, (html: string) => string> = {
  // runoob 代码块 = .example_code 高亮 span 群（turndown 会压掉换行）→ 先固化成 <pre><code>
  'runoob-code': (html: string): string => {
    try {
      const { document } = parseHTML(html)
      const blocks = document.querySelectorAll('.example_code, .hl-main')
      if (!blocks.length) return html
      for (const el of blocks) {
        const code = (el.textContent ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
        if (!code) continue
        const pre = document.createElement('pre')
        const c = document.createElement('code')
        c.textContent = code
        pre.appendChild(c)
        el.parentNode?.replaceChild(pre, el)
      }
      return '<!doctype html>' + document.documentElement.outerHTML
    } catch {
      return html // 预处理失败退回原 HTML（Defuddle 尽力提，最坏丢换行不丢内容）
    }
  },
}

// ===== 网络层（SSRF/编码/护栏；assertSafeWebUrl 与 webSearch 同源） =====

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const MAX_HTML_BYTES = 2 * 1024 * 1024

/** 与 webSearch.assertSafeWebUrl 同规则；提前升级到 https 后再校验 */
function assertSafeWebUrl(raw: string): string {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('URL 非法，请提供完整链接（含 https://）') }
  if (u.protocol === 'http:') u.protocol = 'https:' // 教程站上下页常写 http（runoob 实测），自动升级不误伤
  if (u.protocol !== 'https:') throw new Error('仅支持 http(s) 网页')
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('不允许访问本机地址')
  if (host.includes(':')) throw new Error('不允许直接访问 IP 地址（IPv6）')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const seg = host.split('.').map(Number)
    const priv = seg[0] === 10 || seg[0] === 127 || (seg[0] === 172 && seg[1] >= 16 && seg[1] <= 31) || (seg[0] === 192 && seg[1] === 168) || (seg[0] === 169 && seg[1] === 254)
    if (priv) throw new Error('不允许访问内网/私网地址')
  }
  return u.href
}

export interface FetchedHtml { html: string; url: string; contentType: string }

/** 抓 HTML：SSRF 校验 + http→https 升级 + 2MB/超时护栏 + GBK 系编码探测 */
export async function fetchHtml(rawUrl: string, timeoutMs = 10000): Promise<FetchedHtml> {
  const url = assertSafeWebUrl(String(rawUrl ?? '').trim())
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', Accept: 'text/html,application/xhtml+xml' },
      signal: ctrl.signal, redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_HTML_BYTES) throw new Error('响应过大（>2MB）')
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw new Error(`非网页内容：${contentType.split(';')[0]}`)
    }
    const charset = (/charset=([\w-]+)/i.exec(contentType)?.[1]
      ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'))?.[1]
      ?? 'utf-8').toLowerCase()
    let html: string
    try {
      html = new TextDecoder(charset === 'gb2312' || charset === 'gbk' || charset === 'gb18030' ? 'gb18030' : charset, { fatal: false }).decode(buf)
    } catch { html = buf.toString('utf-8') } // 无该解码器 → UTF-8 兜底（乱码可见可修，不静默）
    return { html, url: res.url || url, contentType }
  } finally {
    clearTimeout(timer)
  }
}

// ===== 目录解析 =====

interface LinkInfo { title: string; url: string }

/** 收集元素内全部链接（绝对化 + 协议过滤） */
function collectLinks(root: { querySelectorAll(sel: string): Iterable<Element> }, base: string, itemSel: string): LinkInfo[] {
  const out: LinkInfo[] = []
  const bu = new URL(base)
  for (const a of root.querySelectorAll(itemSel)) {
    const href = a.getAttribute('href') || ''
    if (!href || href.startsWith('#') || /^\s*javascript:/i.test(href)) continue
    let abs: URL
    try { abs = new URL(href, bu) } catch { continue }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue
    const title = (a.getAttribute('title') || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!title || title.length > 80) continue
    out.push({ title, url: abs.href })
  }
  return out
}

/** 启发式容器候选：nav/aside/侧栏类容器 + 全文档兜底 */
const FALLBACK_CONTAINERS = ['nav', 'aside', '[class*="sidebar"]', '[class*="side-bar"]', '[class*="leftcolumn"]', '[id*="leftcolumn"]', '[class*="menu"]', '[class*="catalog"]', '[class*="toc"]', 'body']

/** 目录解析：画像命中 → 容器；否则按「链接数 × 同前缀率」评分选优。返回平铺章节清单（含分组名）。 */
export function parseToc(html: string, baseUrl: string, profile: SiteProfile | null): TocChapter[] {
  const { document } = parseHTML(html)
  const bu = new URL(baseUrl)
  const anchorDir = bu.pathname.slice(0, bu.pathname.lastIndexOf('/') + 1) // 锚点页所在目录（同教程域）
  const exclRe = profile?.excludePathRe ? new RegExp(profile.excludePathRe) : null

  const score = (links: LinkInfo[]) => {
    const sameHost = links.filter(l => { try { return new URL(l.url).hostname === bu.hostname } catch { return false } })
    const samePrefix = sameHost.filter(l => new URL(l.url).pathname.startsWith(anchorDir))
    if (sameHost.length === 0) return 0
    return samePrefix.length * (samePrefix.length / sameHost.length)
  }

  type Cand = { links: LinkInfo[]; el: Element | null; s: number }
  const cands: Cand[] = []
  const push = (el: Element | null) => {
    if (!el) return
    const links = collectLinks(el as unknown as { querySelectorAll(s: string): Iterable<Element> }, baseUrl, (profile?.tocItem ?? 'a'))
    const s = score(links)
    if (links.length >= 3 && s > 0) cands.push({ links, el, s })
  }
  if (profile?.tocSelector) push(document.querySelector(profile.tocSelector))
  if (!cands.length) for (const sel of FALLBACK_CONTAINERS) push(document.querySelector(sel))
  if (!cands.length) return []
  const best = cands.reduce((a, b) => (b.s > a.s ? b : a))

  // 分组名：按文档序扫描 groupBy 节点，链接出现时固化当前组
  const groupSel = profile?.groupBy
  const chapters: TocChapter[] = []
  const seen = new Set<string>()
  let group = ''
  if (groupSel && best.el) {
    const groupEls = new Set(best.el.querySelectorAll(groupSel))
    // 线性扫容器内所有节点（linkedom 无 TreeWalker 保证，用选择器近似：按包含关系判定先后）
    const ordered: Array<{ kind: 'g' | 'a'; node: Element; link?: LinkInfo }> = []
    for (const g of best.el.querySelectorAll(groupSel)) ordered.push({ kind: 'g', node: g })
    for (const l of best.links) {
      const a = [...best.el.querySelectorAll(profile?.tocItem ?? 'a')].find(x => x.getAttribute('href') && (new URL(x.getAttribute('href')!, bu).href === l.url))
      if (a) ordered.push({ kind: 'a', node: a, link: l })
    }
    void groupEls
    // 无可靠文档序时用简化策略：组标题文本包含在相邻链接文本中则归组；否则统一空组
    for (const it of ordered) {
      if (it.kind === 'g') { group = (it.node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40); continue }
      const l = it.link!
      if (seen.has(l.url)) continue
      seen.add(l.url)
      let path = '/'
      try { path = new URL(l.url).pathname } catch { continue }
      if (path.startsWith(anchorDir) === false && new URL(l.url).hostname === bu.hostname) continue // 同域但跳出教程目录的丢
      if (exclRe?.test(path)) continue
      chapters.push({ no: chapters.length + 1, title: l.title, url: l.url, group, defaultChecked: true })
    }
  }
  if (chapters.length === 0) {
    for (const l of best.links) {
      if (seen.has(l.url)) continue
      seen.add(l.url)
      let path = '/'
      try {
        const lu = new URL(l.url)
        if (lu.hostname === bu.hostname) {
          path = lu.pathname
          if (!path.startsWith(anchorDir)) continue
        }
      } catch { continue }
      if (exclRe?.test(path)) continue
      chapters.push({ no: chapters.length + 1, title: l.title, url: l.url, group: '', defaultChecked: true })
    }
  }
  return chapters
}

// ===== 正文清洗 =====

export interface CleanResult { title: string; markdown: string; wordCount: number; tooShort: boolean }

/** 单页清洗：画像预处理钩子 → extractArticle(Defuddle) → md；正文过少标 tooShort（不阻断） */
export async function cleanPage(html: string, url: string, profile: SiteProfile | null): Promise<CleanResult> {
  const pre = profile?.preprocessId ? (PREPROCESS[profile.preprocessId]?.(html) ?? html) : html
  const ex = await extractArticle(pre, url)
  return { title: ex.title, markdown: ex.markdown, wordCount: ex.wordCount, tooShort: ex.wordCount < 50 || !ex.markdown }
}

// ===== 探测（probe：portal 判定 + 锚点定位 / toc / article 三形态） =====

/** 判定并解析：url 素材「展开网页」第一步。keyword 传素材名/备注，用于门户锚点直达匹配。 */
export async function probeWeb(rawUrl: string, keyword = ''): Promise<ProbeResult> {
  try {
    const { html, url } = await fetchHtml(rawUrl)
    const profile = profileFor(url)
    // 锚点直达表优先（§4.3）：素材名命中画像 hint → 直接探教程入口，门户/根页不再自行 parseToc
    const kw = keyword.trim().toLowerCase()
    const hit = (kw && profile?.anchorHints?.find(h => h.kw.toLowerCase() === kw))
      ?? (kw ? profile?.anchorHints?.find(h => kw.includes(h.kw.toLowerCase()) || h.kw.toLowerCase().includes(kw)) : undefined)
    if (hit) {
      const sub = await probeAnchor(hit.url, profile)
      if (sub.ok) return sub
    }
    const { document } = parseHTML(html)
    const allLinks = collectLinks(document as unknown as { querySelectorAll(s: string): Iterable<Element> }, url, 'a')
    const bodyText = (document.body?.textContent ?? '').replace(/\s+/g, '')
    // 门户判定：链接极多 + 主正文极短（runoob 首页实测：数百链接、正文薄）
    if (allLinks.length > 100 && bodyText.length < 1500) {
      const title = (document.querySelector('title')?.textContent ?? '').trim().slice(0, 80)
      // 候选：页内标题含「教程/Tutorial」且同域的前排链接（去重、限 20）
      const cand: Array<{ title: string; url: string }> = []
      const cs = new Set<string>()
      for (const l of allLinks) {
        if (!/(教程|tutorial|入门|指南)/i.test(l.title)) continue
        try { if (new URL(l.url).hostname !== new URL(url).hostname) continue } catch { continue }
        if (cs.has(l.url)) continue
        cs.add(l.url)
        cand.push({ title: l.title, url: l.url })
        if (cand.length >= 20) break
      }
      return { ok: true, kind: 'portal', title, candidates: cand.length ? cand : (profile?.anchorHints ?? []).map(h => ({ title: h.title, url: h.url })) }
    }
    const sub = await probeAnchor(url, profile)
    if (sub.ok && sub.kind === 'toc') return sub
    const title = (document.querySelector('title')?.textContent ?? '').trim().slice(0, 80)
    return { ok: true, kind: 'article', title, anchor: url }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function probeAnchor(anchorUrl: string, profile: SiteProfile | null): Promise<ProbeResult> {
  const { html, url } = await fetchHtml(anchorUrl)
  const chapters = parseToc(html, url, profile ?? profileFor(url))
  if (chapters.length >= 3) {
    const { document } = parseHTML(html)
    const title = (document.querySelector('title')?.textContent ?? '').trim().slice(0, 80)
    return { ok: true, kind: 'toc', anchor: url, title, chapters }
  }
  return { ok: false }
}

// ===== 批量抓取队列 =====

export interface CrawlOpts {
  maxPages?: number
  delayMs?: number
  signal?: AbortSignal
  /** 文件名规划：{no,title,url} → NN-标题.md（不含目录前缀） */
  fileName: (ch: TocChapter) => string
  /** 已存在判定（断点续抓：true=跳过该页） */
  exists: (fileRel: string) => boolean
  /** 落盘（返回实际写入的相对文件名） */
  write: (ch: TocChapter, fileRel: string, markdown: string) => void
  onProgress?: (info: { done: number; total: number; current: string }) => void
}

/** 队列：并发 2、页间隔 delayMs、单页 10s 超时、失败不阻断、abort 即时响应 */
export async function crawlQueue(chapters: TocChapter[], opts: CrawlOpts): Promise<CrawlOutcome> {
  const max = Math.max(1, Math.min(opts.maxPages ?? 80, 200))
  const delay = Math.max(0, opts.delayMs ?? 300)
  const list = chapters.slice(0, max)
  const out: CrawlOutcome = { done: [], failed: [], skipped: [] }
  const queue = [...list]
  let active = 0
  let lastStart = 0
  await new Promise<void>((resolve) => {
    const pump = () => {
      if (opts.signal?.aborted) { out.failed.push(...queue.splice(0).map(c => ({ url: c.url, title: c.title, reason: '已取消' }))); resolve(); return }
      while (active < 2 && queue.length && !opts.signal?.aborted) {
        const ch = queue.shift()!
        const fileRel = opts.fileName(ch)
        if (opts.exists(fileRel)) { out.skipped.push(ch.no); progress(ch.title); continue }
        const wait = Math.max(0, lastStart + delay - Date.now())
        lastStart = Date.now() + wait
        active++
        setTimeout(() => {
          void (async () => {
            try {
              const { html, url } = await fetchHtml(ch.url, 10000)
              const clean = await cleanPage(html, url, profileFor(url))
              if (clean.tooShort) throw new Error('正文过少（疑似 CSR 空壳/反爬拦截）')
              const body = [
                `# ${clean.title || ch.title}`,
                '',
                `> 来源：${url} · 抓取于 ${new Date().toISOString().slice(0, 10)} · Defuddle 正文提取（AI教学网页素材）`,
                '> 本页**可直接编辑修正**，AI 后续按修正版引用。',
                '',
                clean.markdown,
                '',
              ].join('\n')
              opts.write(ch, fileRel, body)
              out.done.push({ no: ch.no, title: clean.title || ch.title, file: fileRel, url })
            } catch (e) {
              out.failed.push({ url: ch.url, title: ch.title, reason: (e as Error).message })
            } finally {
              active--
              progress(ch.title)
              pump()
            }
          })()
        }, wait)
      }
      if (active === 0 && queue.length === 0) resolve()
    }
    const progress = (current: string) => opts.onProgress?.({ done: out.done.length + out.skipped.length, total: list.length, current })
    pump()
  })
  if (chapters.length > max) out.failed.push({ url: '-', title: `超出上限未抓 ${chapters.length - max} 页`, reason: `webCrawlMaxPages=${max}` })
  return out
}
