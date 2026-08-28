import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

/**
 * 附件根目录（%APPDATA%/knowbase/attachments）。
 *
 * 独立成文件的原因：迁移脚本需要访问它，而迁移又被 connection.ts 驱动——
 * 若迁移反过来 import connection 会形成循环依赖。connection.ts 原样 re-export
 * 本函数，历史调用方的 import 路径无需改动。
 */
export function getAttachmentsDir(): string {
  const userDataPath = app.getPath('userData')
  const attachmentsDir = join(userDataPath, 'attachments')
  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true })
  }
  return attachmentsDir
}
