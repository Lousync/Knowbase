import { BrowserWindow, ipcMain, screen, globalShortcut, shell } from 'electron'
import { join } from 'path'

/**
 * 日程与打卡侧边栏管理器（WeChat 模式）
 *
 * - 主窗口内嵌：<DayPanel mode="embedded" /> 由 src/App.tsx 在主窗口右侧作为 flex 面板渲染，
 *   拉伸主窗口自动跟随高度与位置（消除子窗口方案的全部坑：z-order 锁死、几何漂移、
 *   最小化跟随、面板不出现在主窗口内容区）。
 * - 独立窗口（脱离态）：createPopout() 创建 BrowserWindow 渲染 <DayPanel mode="popout" />，
 *   高度初始 = 主窗口内容区，独立可调；带「吸附」按钮 → 销毁 + 内嵌面板重连。
 * - 关闭独立窗口 X = 自动回内嵌（用户决策 2026-08-31）。
 * - 数据同步见 electron/main/windowBus.ts（data:notify → kb:data-changed）。
 *
 * 状态机：
 *   - detached=false：内嵌（主窗口 React 状态 dayPanelVisible 控制显示）
 *   - detached=true：独立窗口显示，内嵌不渲染
 *   启动默认 detached=false 且可见性由渲染层管理（启动不自动打开）。
 */

let popout: BrowserWindow | null = null
let getMainWindow: () => BrowserWindow | null = () => null
let getRendererUrl: () => string | null = () => null

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function broadcastState(): void {
  broadcast('daypanel:state-changed', { detached: isPopoutOpen() })
}

/** 主窗口内容区高度（用于脱离时初始高度） */
function innerHeightOf(main: BrowserWindow): number {
  const h = main.getContentSize()[1]
  return Math.max(420, h)
}

export function isPopoutOpen(): boolean {
  return !!popout && !popout.isDestroyed()
}

function createPopout(): void {
  if (popout && !popout.isDestroyed()) {
    popout.show()
    popout.focus()
    return
  }
  const main = getMainWindow()
  const mb = main && !main.isDestroyed() ? main.getBounds() : null
  const wa = screen.getPrimaryDisplay().workArea
  // 脱离位置：默认贴主窗口右缘外 12px；放不下则贴工作区右缘；高度 = 主窗口内容区
  const defW = 300
  const defH = main ? innerHeightOf(main) : 820
  const x = mb ? Math.min(mb.x + mb.width + 12, wa.x + wa.width - defW) : wa.x + wa.width - defW - 80
  const y = mb ? mb.y + 36 : wa.y + 60

  popout = new BrowserWindow({
    x: Math.max(wa.x, x),
    y: Math.max(wa.y, Math.min(y, wa.y + wa.height - defH)),
    width: defW,
    height: defH,
    minWidth: 240,
    minHeight: 420,
    frame: false,
    skipTaskbar: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '日程与打卡',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--day-panel-window'],
    },
  })

  // 安全策略与主窗口一致
  popout.webContents.on('will-navigate', (e) => e.preventDefault())
  popout.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  popout.webContents.on('render-process-gone', (_e, details) => {
    console.error('[DayPanel popout] render-process-gone:', details)
  })

  const devUrl = getRendererUrl()
  if (devUrl) void popout.loadURL(`${devUrl}#/day-panel`)
  else void popout.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'day-panel' })

  popout.once('ready-to-show', () => {
    popout?.show()
    broadcastState()
  })

  // X 关闭 = 自动回内嵌（仅通知主进程重置 detached 状态，窗口销毁由 Electron 'closed' 处理）
  popout.on('closed', () => {
    popout = null
    broadcastState()
  })
}

function destroyPopout(): void {
  if (popout && !popout.isDestroyed()) popout.destroy()
  popout = null
  broadcastState()
}

export function initDayPanel(opts: {
  getMainWindow: () => BrowserWindow | null
  rendererUrl: () => string | null
}): void {
  getMainWindow = opts.getMainWindow
  getRendererUrl = opts.rendererUrl
  registerHandlers()
  try {
    globalShortcut.register('Control+Alt+S', () => { togglePanel() })
  } catch (e) {
    console.warn('[DayPanel] 全局快捷键注册失败:', e)
  }
}

/** 快捷键：若独立窗口开 → 吸附；否则通知主窗口切换可见性 */
function togglePanel(): void {
  if (isPopoutOpen()) destroyPopout()
  else broadcast('daypanel:toggle-visibility')
}

function registerHandlers(): void {
  ipcMain.handle('daypanel:popout', () => { createPopout(); return isPopoutOpen() })
  ipcMain.handle('daypanel:dock-back', () => { destroyPopout(); return isPopoutOpen() })
  ipcMain.handle('daypanel:get-state', () => ({ detached: isPopoutOpen() }))
  ipcMain.handle('daypanel:toggle', () => {
    togglePanel()
    return isPopoutOpen()
  })

  // 小窗「打开任务模块」→ 唤起主窗口并切 Tab
  ipcMain.on('daypanel:open-in-main', (_e, tab: string) => {
    const main = getMainWindow()
    if (!main || main.isDestroyed() || typeof tab !== 'string') return
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    main.webContents.send('main:command', { type: 'switch-tab', tab })
  })
}

export function disposeDayPanel(): void {
  try { globalShortcut.unregister('Control+Alt+S') } catch { /* ignore */ }
  destroyPopout()
}