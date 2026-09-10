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

/**
 * 主进程侧主动广播数据变更（2026-09-10 补）。
 *
 * 与 data:notify 的区别：后者由**渲染层**发起、且刻意排除发送方（发送方自己已本地广播过）；
 * 这里由**主进程内部**发起（AI 工具写盘、后台任务等），没有"发送方窗口"这个概念，
 * 因此发给**所有**窗口 —— 否则主窗口永远收不到，AI 写完数据后界面不会刷新
 * （表现为：AI 说创建成功了，日程/打卡页面却看不到，必须切月份或重启）。
 *
 * scope 取值与 src/lib/dataChanged.ts 的 DataChangeScope 对齐。
 */
export function broadcastDataChanged(scope: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('kb:data-changed', { scope })
  }
}
