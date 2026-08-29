import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { app, type BrowserWindow } from 'electron'
import { guard, ok, fail, throwErr, BRIDGE_BOOT_AT } from './response'
import { query, schema, migrations, dbInfo } from './db'
import { logRing, netRing, ipcRing, aggregateErrors, getUiState } from './capture'
import { parseListOptions } from './ring'
import { runAction, listActions } from './actions'
import { runSelfTest, listChecks, coverage } from './selftest'
import { createSnapshot, listSnapshots, deleteSnapshot, diffSnapshots } from './dbdiff'
import { buildReport } from './report'
import { listVersions } from './compat'

/**
 * HTTP 调试桥 —— AI 用 curl 即可观测与驱动，无需冷启动应用、无需手写 CDP 协议。
 *
 * 安全：仅监听 127.0.0.1；SQL 只读；动作白名单；端口被占用时自动顺延。
 */

export const DEFAULT_PORT = 7465
const HOST = '127.0.0.1'
const MAX_BODY = 1024 * 1024

export interface BridgeDeps {
  getMainWindow?: () => BrowserWindow | null
  getSettingValue?: (key: string) => unknown
}

let deps: BridgeDeps = {}

export function configureBridge(next: BridgeDeps): void {
  deps = next
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function parseJson(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') throwErr('E_BAD_REQUEST', '请求体需为 JSON 对象')
    return parsed as Record<string, unknown>
  } catch (e) {
    if (e instanceof SyntaxError) throwErr('E_BAD_REQUEST', 'JSON 解析失败', { raw: raw.slice(0, 200) })
    throw e
  }
}

/** 端点自描述：AI 调一次即可知道有哪些能力 */
function indexDoc() {
  return {
    name: 'knowbase-dev-bridge',
    note: '仅开发/测试环境启用；生产构建不包含本模块',
    endpoints: [
      { method: 'GET', path: '/', desc: '端点清单' },
      { method: 'GET', path: '/health', desc: '存活、版本、数据库路径、运行时长' },
      { method: 'GET', path: '/state', desc: '应用状态：窗口、UI 状态、设置摘要' },
      { method: 'GET', path: '/db/schema', desc: '全部表名与行数' },
      { method: 'POST', path: '/db/query', desc: '只读 SQL，body: { sql, params?, maxRows? }' },
      { method: 'GET', path: '/logs', desc: '日志，query: since / limit / level / scope' },
      { method: 'GET', path: '/errors', desc: '聚合后的报错，query: warn=1 含警告' },
      { method: 'GET', path: '/net', desc: '网络请求，query: since / limit' },
      { method: 'GET', path: '/ipc', desc: 'IPC 调用，query: since / limit' },
      { method: 'POST', path: '/action', desc: '执行动作，body: { name, params }' },
      { method: 'GET', path: '/selftest', desc: '自检，query: only=<name>' },
      { method: 'POST', path: '/db/snapshot', desc: '对当前库拍快照（内存上限 3 份）' },
      { method: 'GET', path: '/db/snapshots', desc: '快照列表' },
      { method: 'POST', path: '/db/snapshot/delete', desc: '删除快照，body: { id }' },
      { method: 'GET', path: '/db/diff', desc: '两快照差异，query: from / to' },
      { method: 'GET', path: '/report', desc: 'AI 体检报告（selftest+errors+慢IPC+schema）' },
      { method: 'GET', path: '/coverage', desc: '需求↔断言覆盖率地图' },
    ],
    actions: listActions(),
    checks: listChecks(),
  }
}

function health() {
  return {
    ok: true,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    node: process.version,
    uptimeMs: Date.now() - BRIDGE_BOOT_AT,
    db: dbInfo(),
  }
}

function state() {
  const win = deps.getMainWindow?.() ?? null
  const bounds = win && !win.isDestroyed() ? win.getBounds() : null
  return {
    app: { version: app.getVersion(), isPackaged: app.isPackaged },
    window: {
      exists: !!win && !win.isDestroyed(),
      focused: win && !win.isDestroyed() ? win.isFocused() : false,
      minimized: win && !win.isDestroyed() ? win.isMinimized() : false,
      bounds,
    },
    ui: getUiState(),
    db: { tables: schema().tableCount, migrations: migrations().count },
    settingsSummary: {
      theme: deps.getSettingValue?.('theme') ?? null,
      startupTab: deps.getSettingValue?.('startupTab') ?? null,
    },
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startedAt = Date.now()
  const url = new URL(req.url ?? '/', `http://${HOST}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = (req.method ?? 'GET').toUpperCase()

  // 只接受本机回环地址，防止同网段其他机器探测
  const remote = req.socket.remoteAddress ?? ''
  if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
    send(res, 403, fail('E_DISABLED', '仅允许本机访问', startedAt, { remote }))
    return
  }

  try {
    if (path === '/' && method === 'GET') {
      send(res, 200, ok(indexDoc(), startedAt))
      return
    }
    if (path === '/health' && method === 'GET') {
      send(res, 200, ok(health(), startedAt))
      return
    }
    if (path === '/state' && method === 'GET') {
      send(res, 200, ok(state(), startedAt))
      return
    }
    if (path === '/db/schema' && method === 'GET') {
      send(res, 200, ok(schema(), startedAt))
      return
    }
    if (path === '/db/query' && method === 'POST') {
      const body = parseJson(await readBody(req))
      const sql = String(body.sql ?? '')
      const params = Array.isArray(body.params) ? body.params : []
      const maxRows = Number(body.maxRows ?? 500)
      send(res, 200, ok(query(sql, params, maxRows), startedAt))
      return
    }
    if (path === '/logs' && method === 'GET') {
      const opts = parseListOptions(url.searchParams)
      const level = url.searchParams.get('level')
      const scope = url.searchParams.get('scope')
      let items = logRing.list(opts)
      if (level) items = items.filter((i) => i.level === level)
      if (scope) items = items.filter((i) => i.scope === scope)
      send(res, 200, ok({ items, total: logRing.size, lastSeq: logRing.lastSeq }, startedAt))
      return
    }
    if (path === '/errors' && method === 'GET') {
      const includeWarn = url.searchParams.get('warn') === '1'
      send(res, 200, ok({ items: aggregateErrors(includeWarn) }, startedAt))
      return
    }
    if (path === '/net' && method === 'GET') {
      const opts = parseListOptions(url.searchParams)
      send(res, 200, ok({ items: netRing.list(opts), total: netRing.size, lastSeq: netRing.lastSeq }, startedAt))
      return
    }
    if (path === '/ipc' && method === 'GET') {
      const opts = parseListOptions(url.searchParams)
      send(res, 200, ok({ items: ipcRing.list(opts), total: ipcRing.size, lastSeq: ipcRing.lastSeq }, startedAt))
      return
    }
    if (path === '/action' && method === 'POST') {
      const body = parseJson(await readBody(req))
      const result = await runAction(String(body.name ?? ''), (body.params ?? {}) as Record<string, unknown>)
      send(res, 200, ok(result, startedAt))
      return
    }
    if (path === '/selftest' && method === 'GET') {
      const only = url.searchParams.get('only') ?? undefined
      const report = await runSelfTest(only)
      // 整体失败时仍返回 200：HTTP 状态码表示「接口可达」，业务成败看 body 的 ok/failed
      send(res, 200, ok(report, startedAt))
      return
    }
    if (path === '/db/snapshot' && method === 'POST') {
      send(res, 200, ok(createSnapshot(), startedAt))
      return
    }
    if (path === '/db/snapshots' && method === 'GET') {
      send(res, 200, ok(listSnapshots(), startedAt))
      return
    }
    if (path === '/db/snapshot/delete' && method === 'POST') {
      const body = parseJson(await readBody(req))
      send(res, 200, ok({ deleted: deleteSnapshot(String(body.id ?? '')) }, startedAt))
      return
    }
    if (path === '/db/diff' && method === 'GET') {
      const from = url.searchParams.get('from') ?? ''
      const to = url.searchParams.get('to') ?? ''
      if (!from || !to) throwErr('E_BAD_REQUEST', '缺少 from / to 参数')
      send(res, 200, ok(diffSnapshots(from, to), startedAt))
      return
    }
    if (path === '/report' && method === 'GET') {
      send(res, 200, ok(await buildReport(), startedAt))
      return
    }
    if (path === '/coverage' && method === 'GET') {
      send(res, 200, ok(coverage(), startedAt))
      return
    }
    if (path === '/compat/versions' && method === 'GET') {
      send(res, 200, ok({ total: listVersions().length, versions: listVersions() }, startedAt))
      return
    }

    send(res, 404, fail('E_NOT_FOUND', `未知端点 ${method} ${path}`, startedAt))
  } catch (err) {
    const resp = await guard(
      () => {
        throw err
      },
      startedAt
    )
    const status =
      resp.error?.code === 'E_NOT_FOUND' ? 404 : resp.error?.code?.startsWith('E_BAD') ? 400 : 500
    send(res, status, resp)
  }
}

export interface StartedServer {
  port: number
  url: string
}

/** 启动服务；端口被占用时自动顺延，最多尝试 10 次 */
export function startServer(preferredPort = DEFAULT_PORT): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    let attempt = 0
    const server = createServer((req, res) => {
      void route(req, res).catch((e) => {
        try {
          send(res, 500, { ok: false, error: { code: 'E_INTERNAL', message: String(e) } })
        } catch {
          /* 连接已断开 */
        }
      })
    })

    const tryListen = (port: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < 10) {
          attempt++
          tryListen(port + 1)
          return
        }
        reject(err)
      })
      server.listen(port, HOST, () => {
        resolve({ port, url: `http://${HOST}:${port}` })
      })
    }

    tryListen(preferredPort)
  })
}
