import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { tokenMatches } from '../lanShare/auth'
import { sanitizeFileName } from '../workspaceManager'
import { extractArticle } from './extract'
import { stripDangerous } from './sanitize'

/**
 * 剪藏接收服务（docs/plugin-web-clipper-design.md §3.4）：仅监听 127.0.0.1 的常驻 Node http。
 *
 * 路由：
 *   GET  /api/ping       连接探测（免 token——扩展首次配对前就要能探测；仅回版本/仓库名等非敏感信息）
 *   POST /api/clip       {url,title,html} → defuddle 提取转 md → 原子写 <vault>/_inbox/clipper/
 *   POST /api/clip-link  {url,title} → 「仅存链接」轻量草稿（SPA 无正文时的 fallback 出口）
 *
 * 安全（对齐设计文档 §4）：
 *  1. 只绑 127.0.0.1（socket 层再校验 remoteAddress 兜底反代等异常路径）
 *  2. Origin 白名单：仅 chrome-extension:// / moz-extension:// 方案（浏览器禁止页面伪造该 Origin，
 *     扩展 id 无法预登记——unpacked 安装 id 随路径变，按方案放行 + token 双保险）
 *  3. 写路由需 Bearer token（不进 query，避免落入任何 URL 日志）
 *  4. 体积上限 5MB / JSON 体一次性读取；url 必须 http(s)；标题净化复用 sanitizeFileName；
 *     落盘路径完全服务端拼接（`_inbox/clipper/<date>-<净化标题>.md`），无用户可控路径成分
 *  5. 内容双端消毒（extract.stripDangerous 输入输出各一遍）
 */

export const CLIPPER_DEFAULT_PORT = 42817
export const CLIPPER_PORT_SPAN = 8 // 首选端口被占向后漂移 7 格（Windows winnat 保留段实测会抢口）
const MAX_BODY_BYTES = 5 * 1024 * 1024
const TITLE_MAX = 120

export interface ClipperServerOptions {
  /** 每次请求现取（多仓库切换后落点必须跟着变，禁止启动期缓存） */
  getVaultRoot: () => { rootPath: string; name: string } | null
  /** 读写配对 token（settings 持久化由上层管理；这里只在缺失时生成） */
  getToken: () => string
}

export interface ClipperOk { ok: true; path: string; mode: 'full' | 'link-only'; bytes: number; fallback?: boolean; title?: string }
type ClipperErr = { ok: false; error: string }

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}
const deny = (res: ServerResponse, status: number, error: string): void => void sendJson(res, status, { ok: false, error })

/** 安全读取整棵 body：超上限即停止累积、排空剩余字节后回调 null（让客户端拿到干净的 413 而非 socket 断裂） */
function readBody(req: IncomingMessage, cb: (body: string | null) => void): void {
  const chunks: Buffer[] = []
  let size = 0
  let overflow = false
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > MAX_BODY_BYTES) {
      overflow = true
      chunks.length = 0
      return
    }
    chunks.push(c)
  })
  req.on('end', () => cb(overflow ? null : Buffer.concat(chunks).toString('utf-8')))
  req.on('error', () => cb(null))
}

function safeTitle(raw: unknown, url: string): string {
  const t = sanitizeFileName(String(typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim()).slice(0, TITLE_MAX)
  if (t) return t
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return `untitled-${host}`
  } catch {
    return 'untitled'
  }
}

function isValidUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u || u.length > 2048) return false
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}

/** 落盘：唯一名（同日同题冲突加 -HHmmss），原子写（tmp+rename），返回仓库相对路径 */
function writeClip(rootPath: string, relDir: string, title: string, content: string): string {
  const day = new Date().toISOString().slice(0, 10)
  let fileName = `${day}-${title}.md`
  const dirAbs = join(rootPath, relDir)
  mkdirSync(dirAbs, { recursive: true })
  if (existsSync(join(dirAbs, fileName))) {
    fileName = `${day}-${title}-${String(Date.now()).slice(-6)}.md`
  }
  const abs = join(dirAbs, fileName)
  const tmp = join(dirAbs, `.${fileName}.${process.pid}.tmp`)
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, abs)
  return relDir + '/' + fileName
}

function frontmatter(o: Record<string, string | boolean>): string {
  // JSON 字符串引号是 YAML 双引号标量的合法子集，直接 stringify 值即可安全转义
  return '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'boolean' ? String(v) : JSON.stringify(v)}`).join('\n') + '\n---\n\n'
}

export function createClipperServer(opts: ClipperServerOptions): Server {
  const server = createServer((req, res) => {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    if (ip !== '127.0.0.1' && ip !== '::1') return deny(res, 403, '仅允许本机访问')
    const origin = req.headers.origin
    if (origin && !/^(chrome|moz)-extension:\/\//.test(origin)) return deny(res, 403, '来源不在白名单')
    const url = (req.url || '').split('?')[0]

    if (req.method === 'GET' && url === '/api/ping') {
      const vault = opts.getVaultRoot()
      return sendJson(res, 200, { ok: true, app: 'knowbase', clipper: 1, vault: vault?.name ?? null, hasVault: !!vault, needsPairing: !getTokenOrNull(opts) })
    }

    // 配对校验：带 token 的空操作（扩展粘贴令牌后即时验证，无任何副作用/写盘）
    if (req.method === 'GET' && url === '/api/pair-check') {
      const auth = req.headers.authorization
      const provided = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      if (!tokenMatches(opts.getToken(), provided)) return deny(res, 401, '无效的配对令牌')
      return sendJson(res, 200, { ok: true, paired: true })
    }

    if (req.method === 'POST' && (url === '/api/clip' || url === '/api/clip-link')) {
      const auth = req.headers.authorization
      const provided = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      if (!tokenMatches(opts.getToken(), provided)) return deny(res, 401, '无效的配对令牌')
      const vault = opts.getVaultRoot()
      if (!vault) return deny(res, 422, 'NO_VAULT：请先在 Knowbase 中打开一个仓库')
      const CLIP_REL_DIR = '_inbox/clipper' // 回执/展示统一正斜杠（win32 join 会混入反斜杠）
      readBody(req, async (raw) => {
        if (raw === null) return deny(res, 413, '请求体超过 5MB 上限')
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(raw) as Record<string, unknown>
        } catch {
          return deny(res, 400, '请求体不是合法 JSON')
        }
        if (!isValidUrl(payload.url)) return deny(res, 400, '缺少或非法的 url（仅支持 http/https）')
        const title = safeTitle(payload.title, payload.url)
        const stamp = new Date().toISOString()
        const head = frontmatter({ source: payload.url, title, clipped: stamp, clipper: true })
        if (url === '/api/clip-link') {
          const rel = writeClip(vault.rootPath, CLIP_REL_DIR, title, head + `> 🔗 仅存链接 · [${title}](${payload.url})\n\n\`\`\`\n${payload.url}\n\`\`\`\n`)
          return sendJson(res, 200, { ok: true, path: rel, mode: 'link-only', bytes: Buffer.byteLength(head) + 64, title } satisfies ClipperOk)
        }
        if (typeof payload.html !== 'string' || !payload.html.trim()) return deny(res, 400, 'clip 需要非空 html 字段')
        let markdown = ''
        try {
          markdown = (await extractArticle(payload.html, payload.url)).markdown
        } catch (e) {
          console.warn('[clipper] 提取失败，转仅存链接:', (e as Error).message?.slice(0, 120))
        }
        if (!markdown || markdown.length < 80) {
          // 无可提取正文（SPA/登录墙/极简页）→ 自动降级「仅存链接」，回执标 fallback 供扩展提示
          const rel = writeClip(vault.rootPath, CLIP_REL_DIR, title, head + `> 🔗 未能提取正文，仅存链接 · [${title}](${payload.url})\n\n\`\`\`\n${payload.url}\n\`\`\`\n`)
          return sendJson(res, 200, { ok: true, path: rel, mode: 'link-only', bytes: 0, fallback: true, title } satisfies ClipperOk)
        }
        const doc = head + stripDangerous(`# ${title}\n\n` + markdown) + `\n\n<!-- 剪藏草稿：无 frontmatter.id 不进知识索引/图谱；整理后补 id 并移入库内即转正 -->\n`
        const rel = writeClip(vault.rootPath, CLIP_REL_DIR, title, doc)
        return sendJson(res, 200, { ok: true, path: rel, mode: 'full', bytes: Buffer.byteLength(doc), title } satisfies ClipperOk)
      })
      return
    }

    deny(res, 404, '未知路由')
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 16_000
  return server
}

function getTokenOrNull(opts: ClipperServerOptions): string {
  try { return opts.getToken() } catch { return '' }
}

/** 端口漂移监听：首选 42817 起向后试 CLIPPER_PORT_SPAN 个（winnat 保留段抢占实测存在） */
export function listenClipper(server: Server, startPort = CLIPPER_DEFAULT_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = startPort
    const onError = (err: NodeJS.ErrnoException): void => {
      const canDrift = (err.code === 'EADDRINUSE' || err.code === 'EACCES') && attempt - startPort < CLIPPER_PORT_SPAN - 1
      if (canDrift) {
        attempt++
        tryListen()
      } else {
        reject(err)
      }
    }
    const tryListen = (): void => {
      server.once('error', onError)
      server.once('listening', () => {
        server.removeListener('error', onError)
        resolve(attempt)
      })
      server.listen(attempt, '127.0.0.1')
    }
    tryListen()
  })
}
