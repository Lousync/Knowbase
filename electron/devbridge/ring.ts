/**
 * 环形缓冲 —— 日志、网络请求、IPC 记录共用。
 *
 * 每条记录带自增 seq，客户端可用 `?since=<seq>` 增量拉取，避免重复读取。
 * 容量固定，超出后丢弃最旧的记录，长时间挂机也不会占满内存。
 */

export interface RingItem {
  seq: number
  ts: string
}

export interface ListOptions {
  /** 只返回 seq 大于该值的记录 */
  since?: number
  /** 最多返回条数（取最新的） */
  limit?: number
}

export class Ring<T extends RingItem> {
  private items: T[] = []
  private counter = 0

  constructor(private readonly capacity = 500) {}

  push(item: Omit<T, 'seq' | 'ts'>): T {
    const full = { ...item, seq: ++this.counter, ts: new Date().toISOString() } as T
    this.items.push(full)
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity)
    }
    return full
  }

  list(opts: ListOptions = {}): T[] {
    let out = this.items
    if (typeof opts.since === 'number' && opts.since > 0) {
      out = out.filter((i) => i.seq > opts.since!)
    }
    if (typeof opts.limit === 'number' && opts.limit > 0) {
      out = out.slice(-opts.limit)
    }
    return out
  }

  clear(): void {
    this.items = []
  }

  get size(): number {
    return this.items.length
  }

  get lastSeq(): number {
    return this.counter
  }
}

/** 解析查询串中的 since / limit 参数 */
export function parseListOptions(params: URLSearchParams): ListOptions {
  const since = Number(params.get('since'))
  const limit = Number(params.get('limit'))
  const opts: ListOptions = {}
  if (Number.isFinite(since) && since > 0) opts.since = since
  if (Number.isFinite(limit) && limit > 0) opts.limit = Math.min(limit, 1000)
  return opts
}
