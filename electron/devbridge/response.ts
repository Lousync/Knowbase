/**
 * 统一响应封装 —— 所有端点返回同一结构，便于 AI 断言。
 *
 * 约定：
 * - 成功必有 `ok: true` 与 `data`
 * - 失败必有 `ok: false` 与 `error.code`，code 为稳定枚举，AI 应据此分支而非匹配文案
 */

export type BridgeErrorCode =
  | 'E_NOT_FOUND'
  | 'E_BAD_REQUEST'
  | 'E_SQL_READONLY'
  | 'E_SQL_ERROR'
  | 'E_ACTION_UNKNOWN'
  | 'E_ACTION_FAILED'
  | 'E_NEED_CONFIRM'
  | 'E_DISABLED'
  | 'E_INTERNAL'

export interface BridgeError {
  code: BridgeErrorCode
  message: string
  detail?: unknown
}

export interface BridgeResponse<T = unknown> {
  ok: boolean
  ts: string
  durationMs: number
  data?: T
  error?: BridgeError
}

/** 应用启动时刻，供 /health 计算运行时长 */
export const BRIDGE_BOOT_AT = Date.now()

export class BridgeErrorWithCode extends Error {
  constructor(public code: BridgeErrorCode, message: string, public detail?: unknown) {
    super(message)
    this.name = 'BridgeErrorWithCode'
  }
}

export function ok<T>(data: T, startedAt: number): BridgeResponse<T> {
  return {
    ok: true,
    ts: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    data,
  }
}

export function fail(
  code: BridgeErrorCode,
  message: string,
  startedAt: number,
  detail?: unknown
): BridgeResponse<never> {
  return {
    ok: false,
    ts: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    error: { code, message, detail },
  }
}

/** 包装处理函数：统一计时，并把抛出的错误转成结构化响应 */
export async function guard<T>(
  fn: () => T | Promise<T>,
  startedAt = Date.now()
): Promise<BridgeResponse<T>> {
  try {
    return ok(await fn(), startedAt)
  } catch (err) {
    if (err instanceof BridgeErrorWithCode) {
      return fail(err.code, err.message, startedAt, err.detail)
    }
    const message = err instanceof Error ? err.message : String(err)
    return fail('E_INTERNAL', message, startedAt)
  }
}

/** 主动抛出带错误码的异常，交给 guard 统一捕获 */
export function throwErr(code: BridgeErrorCode, message: string, detail?: unknown): never {
  throw new BridgeErrorWithCode(code, message, detail)
}
