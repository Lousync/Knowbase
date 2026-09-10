/**
 * 渲染层采集器（仅 DEV）。
 *
 * 职责：
 * - 劫持 console.log/info/warn/error，保留原输出的同时入队
 * - 捕获 window.onerror 与 unhandledrejection（React 未捕获异常的主要来源）
 * - 批量、节流地上报到主进程，避免高频日志拖垮 IPC
 *
 * 生产构建：App.tsx 以 import.meta.env.DEV 条件动态导入本模块，
 * DEV 被静态替换为 false 后整段被 tree-shake，不会进入产物。
 */

interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  stack?: string
}

const FLUSH_MS = 200
const MAX_BATCH = 50

// V-7（monaco 0.56 dispose 竞态，上游修复前）：HMR/重挂后旧实例 dispose 残留的渲染帧错误
// 会每帧抛一次连环刷屏。同类噪音只保留首条全量，后续按计数汇总——首现仍可见，刷屏被止血
const NOISE_PATTERNS: RegExp[] = [
  /InstantiationService has been disposed/,
  /Model is disposed/,
  /Cannot read properties of (undefined|null) \(reading '(setClassName|domNode|getWidgets|viewModel)'\)/,
]
const noiseCounts = new Map<RegExp, number>()

function dampenNoise(entry: LogEntry): LogEntry | null {
  if (entry.level !== 'error') return entry
  const hit = NOISE_PATTERNS.find((re) => re.test(entry.message))
  if (!hit) return entry
  const n = (noiseCounts.get(hit) ?? 0) + 1
  noiseCounts.set(hit, n)
  if (n <= 3) return entry // 前 3 条逐条保留，便于看清首现场景
  if (n % 25 !== 0) return null // 之后每 25 条汇总一条，防每帧刷屏拖垮 IPC
  return { ...entry, message: `[V-7 降噪 ×${n}] ${entry.message.slice(0, 150)}`, stack: undefined }
}

let queue: LogEntry[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let installed = false

type ReportFn = (payload: unknown) => Promise<unknown>

function report(): ReportFn | undefined {
  const w = window as unknown as { devbridgeApi?: { report?: ReportFn } }
  return w.devbridgeApi?.report
}

function push(entry: LogEntry): void {
  const damped = dampenNoise(entry)
  if (!damped) return
  if (queue.length >= MAX_BATCH * 5) queue.shift()
  queue.push(damped)
  if (timer) return
  timer = setTimeout(flush, FLUSH_MS)
}

export function flush(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (queue.length === 0) return
  const batch = queue
  queue = []
  try {
    void report()?.({ logs: batch })
  } catch {
    /* 桥未启动时静默丢弃 */
  }
}

function fmtOne(a: unknown): string {
  if (a instanceof Error) return a.message
  if (typeof a === 'string') return a
  // React 组件栈：单独取 componentStack，避免整段 JSON 刷屏
  if (a && typeof a === 'object' && typeof (a as { componentStack?: unknown }).componentStack === 'string') {
    return (a as { componentStack: string }).componentStack
  }
  try {
    return JSON.stringify(a) ?? String(a)
  } catch {
    return String(a)
  }
}

/**
 * 模拟 console 的 printf 风格替换（%s %d %i %f %o %O %j %c %%）。
 * 不这么做的话，React 的 `console.error('In HTML, %s cannot be a descendant of %s', 'button', 'button')`
 * 上报到日志里就只剩一串裸 %s + 铺开的参数，完全读不出原意（2026-09-10 修）。
 */
function formatArgs(args: unknown[]): string {
  const [first, ...rest] = args
  if (typeof first !== 'string' || !/%[sdifoOjc%]/.test(first)) {
    return args.map(fmtOne).join(' ')
  }
  let i = 0
  const head = first.replace(/%([sdifoOjc%])/g, (_m, spec: string) => {
    if (spec === '%') return '%'
    if (i >= rest.length) return _m
    const v = rest[i++]
    switch (spec) {
      case 's': return typeof v === 'string' ? v : fmtOne(v)
      case 'j': {
        try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
      }
      case 'c': return '' // 纯样式参数，丢弃
      case 'd':
      case 'i': return String(Number(v))
      case 'f': return String(Number(v))
      default: return fmtOne(v)
    }
  })
  const tail = rest.slice(i).map(fmtOne).join(' ')
  return tail ? `${head} ${tail}` : head
}

function stringify(args: unknown[]): string {
  return formatArgs(args)
}

export function installRendererCollector(): void {
  if (installed) return
  installed = true

  const levels: Array<{ key: 'log' | 'info' | 'warn' | 'error'; level: LogEntry['level'] }> = [
    { key: 'log', level: 'log' },
    { key: 'info', level: 'info' },
    { key: 'warn', level: 'warn' },
    { key: 'error', level: 'error' },
  ]

  for (const { key, level } of levels) {
    const orig = console[key].bind(console)
    console[key] = (...args: unknown[]) => {
      try {
        const stack = args.find((a) => a instanceof Error) as Error | undefined
        push({ level, message: stringify(args).slice(0, 2000), stack: stack?.stack })
      } catch {
        /* 采集失败不影响原调用 */
      }
      orig(...args)
    }
  }

  window.addEventListener('error', (e) => {
    push({
      level: 'error',
      message: e.message || 'window error',
      stack: e.error instanceof Error ? e.error.stack : undefined,
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    push({
      level: 'error',
      message: `unhandledrejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  window.addEventListener('beforeunload', flush)
}

/** 供 App.tsx 上报当前激活模块，使 GET /state 能反映真实路由 */
export function reportUiState(ui: { activeModule?: string; route?: string; detail?: Record<string, unknown> }): void {
  try {
    void report()?.({ ui })
  } catch {
    /* ignore */
  }
}
