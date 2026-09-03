import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

/**
 * 设备传输交换目录（%APPDATA%/knowbase/sync）。
 *
 * 结构约定（与 WebDAV 二期共用，勿轻易变动）：
 *   sync/inbox/   平板 → 电脑：收到的文件，归档成功后从 inbox 移走
 *   sync/outbox/  电脑 → 平板：待发送文件，关闭服务时清空
 *
 * 独立成文件的原因与 database/paths.ts 相同：避免模块间循环依赖。
 */
export function getSyncRootDir(): string {
  const dir = join(app.getPath('userData'), 'sync')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getInboxDir(): string {
  const dir = join(getSyncRootDir(), 'inbox')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getOutboxDir(): string {
  const dir = join(getSyncRootDir(), 'outbox')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
