// clipperServer 冒烟（设计文档 §7 安全矩阵）：真 http 往返 + 落盘断言 + 索引联动
import { createClipperServer, listenClipper } from '../../electron/lib/clipperServer/server'
import { setCurrentVault } from '../../electron/lib/kbStore/vaultContext'
import { getKnowledgeIndex } from '../../electron/lib/kbStore/knowledgeIndex'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const VAULT = path.join(os.tmpdir(), 'clipper-smoke-' + Date.now())
fs.mkdirSync(path.join(VAULT, '.knowbase'), { recursive: true })
const TOKEN = 'smoke-token-' + 'x'.repeat(24)
setCurrentVault({ rootId: 'smoke', name: 'smoke-vault', rootPath: VAULT })

let pass = 0, fail = 0
const ok = (c: unknown, n: string) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const ARTICLE = `<html><head><title>深度好文 · 测试</title><script>steal()</script></head><body>
<nav>导航噪声导航噪声导航噪声导航噪声</nav>
<article><h1>深度好文 · 测试</h1>
<p>${'这是文章的核心段落，包含足够长度的中文内容以通过 defuddle 的正文阈值判定。'.repeat(6)} <a href="/inner">内部链接</a></p>
<p><img src="pic.png" onerror="boom()" alt="配图"> ${'第二段继续展开论述，第二段继续展开论述，第二段继续展开论述。'.repeat(4)}</p>
</article>
<footer>页脚噪声页脚噪声</footer></body></html>`

void (async () => {
  const server = createClipperServer({
    getVaultRoot: () => ({ rootPath: VAULT, name: 'smoke-vault' }),
    getToken: () => TOKEN,
  })
  const port = await listenClipper(server, 42899)
  const base = `http://127.0.0.1:${port}`
  const req = (m: string, p: string, body?: unknown, headers?: Record<string, string>) =>
    fetch(base + p, { method: m, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), headers: { 'content-type': 'application/json', ...(headers || {}) } })
  const EXT = { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }

  console.log('== 1. 连通与发现 ==')
  let r = await req('GET', '/api/ping', undefined, EXT)
  let j = await r.json() as Record<string, unknown>
  ok(r.status === 200 && j.ok === true && j.clipper === 1 && j.vault === 'smoke-vault', `ping（扩展 Origin）→ vault 名回显`)
  r = await req('GET', '/api/ping')
  ok(r.status === 200, 'ping 无 Origin（本机 CLI）也允许（无敏感数据）')
  r = await req('GET', '/api/ping', undefined, { origin: 'https://evil.example' })
  ok(r.status === 403, '恶意网页 Origin → 403')

  console.log('== 2. 鉴权矩阵 ==')
  r = await req('POST', '/api/clip', { url: 'https://a.b', title: 't', html: ARTICLE })
  ok(r.status === 401, '无 token clip → 401')
  r = await req('POST', '/api/clip', { url: 'https://a.b', title: 't', html: ARTICLE }, { ...EXT, authorization: 'Bearer wrong-token' })
  ok(r.status === 401, '错 token → 401')
  r = await req('GET', '/api/pair-check', undefined, { ...EXT, authorization: 'Bearer ' + TOKEN })
  ok(r.status === 200, 'pair-check 正确 token → 200（配对校验无副作用）')
  ok(!fs.existsSync(path.join(VAULT, '.knowbase', '_draft', 'clipper')) || fs.readdirSync(path.join(VAULT, '.knowbase', '_draft', 'clipper')).length === 0, 'pair-check 不落盘')

  console.log('== 3. 输入校验 ==')
  r = await req('POST', '/api/clip', { url: 'file:///etc/passwd', title: 't', html: ARTICLE }, { ...EXT, authorization: 'Bearer ' + TOKEN })
  ok(r.status === 400, '非 http(s) url → 400')
  r = await req('POST', '/api/clip', { url: 'https://a.b', title: 't', html: '' }, { ...EXT, authorization: 'Bearer ' + TOKEN })
  ok(r.status === 400, '空 html → 400')
  let oversizeStatus = 0
  try {
    const or = await req('POST', '/api/clip', { url: 'https://a.b', title: 't', html: 'x'.repeat(6 * 1024 * 1024) }, { ...EXT, authorization: 'Bearer ' + TOKEN })
    oversizeStatus = or.status
  } catch { oversizeStatus = -1 }
  ok(oversizeStatus === 413, `超 5MB → 413（实得 ${oversizeStatus}）`)

  console.log('== 4. 正链：clip → 提取 → 落盘 ==')
  r = await req('POST', '/api/clip', { url: 'https://news.example/deep-dive?q=1', title: ARTICLE ? '深度好文 · 测试 <bad>/\\:*?"<>|' : '', html: ARTICLE }, { ...EXT, authorization: 'Bearer ' + TOKEN })
  j = await r.json() as Record<string, unknown>
  ok(r.status === 200 && j.ok === true && j.mode === 'full', `clip 200 回执 ${JSON.stringify(j.path)}`)
  const rel = j.path as string
  const abs = path.join(VAULT, rel)
  ok(rel.startsWith('.knowbase/_draft/clipper/') && /^\d{4}-\d{2}-\d{2}/.test(rel.split('/')[3]), '路径 = .knowbase/_draft/clipper/<date>-<净化标题>.md')
  ok(!/[\\:*?"<>|]/.test(rel.split('/')[3]), '标题净化：非法字符全消（' + rel.split('/')[3] + '）')
  const mdText = fs.readFileSync(abs, 'utf-8')
  ok(mdText.startsWith('---\n') && mdText.includes('clipper: true'), 'frontmatter 契约（source/clipped/clipper:true）')
  ok(mdText.includes('"https://news.example/deep-dive?q=1"'), 'source 引号安全转义')
  ok(mdText.includes('核心段落'), '正文提取到位')
  ok(!/steal\(\)|boom\(\)|导航噪声|页脚噪声/.test(mdText), 'script/onerror/导航/页脚 全未泄漏')
  ok(mdText.includes('https://news.example/inner'), '内部相对链接已绝对化')
  const r2 = await req('POST', '/api/clip', { url: 'https://news.example/deep-dive', title: '深度好文 · 测试 ', html: ARTICLE }, { ...EXT, authorization: 'Bearer ' + TOKEN })
  const j2 = await r2.json() as { path?: string }
  ok(!!j2.path && j2.path !== rel, '同日同题重名 → 唯一化（' + (j2.path || '').split('/')[3] + '）')

  console.log('== 5. SPA 无正文 → fallback 仅链接 ==')
  r = await req('POST', '/api/clip', { url: 'https://spa.example/app', title: '空壳SPA', html: '<html><body><div id="root"></div></body></html>' }, { ...EXT, authorization: 'Bearer ' + TOKEN })
  j = await r.json() as Record<string, unknown>
  ok(r.status === 200 && j.mode === 'link-only' && j.fallback === true, 'clip 无正文自动降级 link-only + fallback 标记')
  r = await req('POST', '/api/clip-link', { url: 'https://x.y/z', title: '只存这条/带非法字符<>:' }, { ...EXT, authorization: 'Bearer ' + TOKEN })
  j = await r.json() as Record<string, unknown>
  ok(r.status === 200 && j.mode === 'link-only' && !!j.path, 'clip-link 直存')
  const linkDoc = fs.readFileSync(path.join(VAULT, j.path as string), 'utf-8')
  ok(linkDoc.includes('https://x.y/z') && linkDoc.includes('clipper: true'), '链接草稿含 URL + frontmatter')

  console.log('== 6. 索引联动：.knowbase/_draft 剪藏永不入知识索引 ==')
  const idx = getKnowledgeIndex(true)
  ok(idx.pages.length === 0, `知识索引 0 页（剪藏草稿 ${fs.readdirSync(path.join(VAULT, '.knowbase', '_draft', 'clipper')).length} 个 .md 全不可见）`)
  ok(idx.warnings.length === 0, '零 warning（.knowbase 内仅 _inbox 入扫，_draft 随 dot 规则跳过）')

  console.log('== 7. 未知路由 ==')
  r = await req('GET', '/api/whatever', undefined, EXT)
  ok(r.status === 404, '未知路由 404')

  server.close()
  fs.rmSync(VAULT, { recursive: true, force: true })
  console.log(`\n${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
})()
