import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'

/**
 * 全局（userData 域）JSON 存取辅助 —— R6 去库化新增。
 *
 * 适用范围：与具体知识仓库无关、属于应用全局的数据（如 AI 会话）。
 * 存储目录与原 knowledge.db 同级：%APPDATA%/knowbase/data/。
 * 仅限主进程使用（依赖 electron app）。
 */

/** 数据根注入点：agentMessageStore 等按文件分片的存储沿用同一目录 */
export function globalDataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 读取 userData/data/<fileName>；文件不存在或解析失败返回 fallback */
export function globalReadJson<T>(fileName: string, fallback: T): T {
  try {
    const p = join(globalDataDir(), fileName)
    if (!existsSync(p)) return fallback
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch (err) {
    console.error(`[globalJsonStore] Failed to read: ${fileName}`, err)
    return fallback
  }
}

/** 原子写入 userData/data/<fileName>（tmp + rename，同库内 jsonStore 策略；Windows 需先删旧文件） */
export function globalWriteJson<T>(fileName: string, data: T): void {
  try {
    const dir = globalDataDir()
    const p = join(dir, fileName)
    const tmp = join(dir, `${fileName}.tmp`)
    writeFileSync(tmp, JSON.stringify(data), 'utf-8')
    try { renameSync(tmp, p) } catch { if (existsSync(p)) unlinkSync(p); renameSync(tmp, p) }
  } catch (err) {
    console.error(`[globalJsonStore] Failed to write: ${fileName}`, err)
  }
}
