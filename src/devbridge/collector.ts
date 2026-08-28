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

let queue: LogEntry[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let installed = false

type ReportFn = (payload: unknown) => Promise<unknown>

function report(): ReportFn | undefined {
  const w = window as unknown as { devbridgeApi?: { report?: ReportFn } }
  return w.devbridgeApi?.report
}

function push(entry: LogEntry): void {
  if (queue.length >= MAX_BATCH * 5) queue.shift()
  queue.push(entry)
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

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a) ?? String(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
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
