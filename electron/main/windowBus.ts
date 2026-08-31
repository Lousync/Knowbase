import { ipcMain, BrowserWindow } from 'electron'

/**
 * 跨窗口数据变更总线（与任何具体窗口解耦）
 *
 * 任一窗口写操作完成后调用 data:notify({ scope }) → 主进程转发 kb:data-changed
 * 给除发送方外的所有窗口（发送方自身已在渲染层本地广播，无需回传）。
 *
 * 2026-08-31 从 dayPanelWindow.ts 挪出：它是全应用级能力（schedule ↔ habit ↔
 * 小窗 ↔ 未来任何新窗口），不该寄生在小窗模块里，否则小窗一拆同步就断。
 */
export function registerWindowBus(): void {
  ipcMain.on('data:notify', (event, payload) => {
    if (!payload || typeof payload !== 'object' || typeof (payload as { scope?: unknown }).scope !== 'string') return
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents !== event.sender && !w.isDestroyed()) {
        w.webContents.send('kb:data-changed', payload)
      }
    }
  })
}
