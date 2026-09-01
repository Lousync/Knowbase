import { ipcMain } from 'electron'

/**
 * IPC 注册幂等保护
 *
 * 背景：dev 构建下部分 repo 模块（如 importRepo）被打包进同一 bundle 两份
 *（同一文件经不同引入路径解析成两个模块 ID），而各 repo 的 ipcMain.handle
 * 写在模块顶层 —— 模块被执行两次即注册两次，Electron 直接抛：
 *   "Attempted to register a second handler for 'xxx'" → 应用无法启动。
 * ipcMain.on 重复注册不报错，但会让同一事件的处理函数执行两次（更隐蔽）。
 *
 * 对策：统一包装 ipcMain.handle / ipcMain.on ——
 *   - handle 重复 → 先 removeHandler 再注册（覆盖为最后一份实现，功能等价）
 *   - on    重复 → 先 removeAllListeners 再注册（避免处理函数叠加执行两次）
 *
 * 必须在任何 repo 模块加载之前执行，因此由 index.ts 的第一个 import 引入。
 */

const seenHandle = new Set<string>()
const seenOn = new Set<string>()
const origHandle = ipcMain.handle.bind(ipcMain)
const origOn = ipcMain.on.bind(ipcMain)

;(ipcMain as unknown as { handle: typeof ipcMain.handle }).handle = (channel, listener) => {
  if (seenHandle.has(channel)) {
    console.warn(`[ipcSafe] 重复注册 handler，已覆盖为最后一份实现: ${channel}`)
    ipcMain.removeHandler(channel)
  }
  seenHandle.add(channel)
  origHandle(channel, listener)
}

;(ipcMain as unknown as { on: typeof ipcMain.on }).on = (channel, listener) => {
  if (seenOn.has(channel)) {
    console.warn(`[ipcSafe] 重复注册 listener，已替换（防叠加执行两次）: ${channel}`)
    ipcMain.removeAllListeners(channel)
  }
  seenOn.add(channel)
  origOn(channel, listener)
}
