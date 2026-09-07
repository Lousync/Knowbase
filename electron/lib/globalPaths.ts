import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

/**
 * 全局 userData 附件根目录（%APPDATA%/knowbase/attachments）。
 *
 * 原 database/paths.ts——R6 去库化（D9）后 database/ 整目录退役，
 * 本函数是它唯一幸存的导出（历史附件目录仍被主进程与旧数据读取路径引用）。
 */
export function getAttachmentsDir(): string {
  const userDataPath = app.getPath('userData')
  const attachmentsDir = join(userDataPath, 'attachments')
  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true })
  }
  return attachmentsDir
}
