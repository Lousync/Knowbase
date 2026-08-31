import { BrowserWindow, ipcMain, screen, globalShortcut, shell } from 'electron'
import { join } from 'path'

/**
 * 日程与打卡侧边栏管理器（WeChat 模式 + 桌面互动模式）
 *
 * - 主窗口内嵌：<DayPanel mode="embedded" /> 由 src/App.tsx 在主窗口右侧作为 flex 面板渲染，
 *   拉伸主窗口自动跟随高度与位置。
 * - 独立窗口（脱离态）：createPopout() 创建 BrowserWindow 渲染 <DayPanel mode="popout" />。
 *   脱离态有三种桌面互动模式（mode，持久化）：
 *   - floating      自由漂浮：当前默认形态，独立可拖可调，不置顶
 *   - top-dock      顶部停靠：贴工作区顶缘，QQ 式收缩为 10px 触碰条，鼠标悬停自动展开，
 *                   移出 500ms grace 后自动收回；置顶（全屏时由系统独占覆盖）
 *   - desktop-widget 桌面小组件：透明窗口 + 鼠标穿透（默认），只读展示待办/打卡，
 *                   鼠标划过激活为可交互态（操作锚点）
 * - 关闭独立窗口 X = 自动回内嵌。数据同步见 windowBus.ts。
 * - 生命周期：主窗口隐藏到托盘时 popout 独立存活（托盘常驻方案）。
 *
 * 状态机：
 *   - detached=false：内嵌
 *   - detached=true：popout，mode 决定桌面形态
 */

export type PanelMode = 'floating' | 'top-dock' | 'desktop-widget'
const MODES: readonly PanelMode[] = ['floating', 'top-dock', 'desktop-widget']

const TOUCH_STRIP_H = 10          // 触碰条高度
const WIDGET_W = 264              // 桌面小组件尺寸（固定）
const WIDGET_H = 150
const EXPAND_MS = 200             // 展开/收回动画时长
const COLLAPSE_DELAY_MS = 500     // 鼠标移出后收回的 grace 窗口
const DEFAULT_W = 300
const DEFAULT_H = 520
const BOUNDS_SAVE_MS = 400        // 位置/尺寸落盘防抖

let popout: BrowserWindow | null = null
let getMainWindow: () => BrowserWindow | null = () => null
let getRendererUrl: () => string | null = () => null
let getSetting: (key: string) => unknown = () => undefined
let setSetting: (key: string, value: unknown) => void = () => {}

let mode: PanelMode = 'floating'
let windowMode: PanelMode | null = null   // popout 创建时的模式（transparent 等创建期选项）
let collapsed = false                      // top-dock 收缩态
let widgetInteractive = false              // desktop-widget 可交互态
let topDockAnimating = false
let collapseTimer: ReturnType<typeof setTimeout> | null = null
let animTimer: ReturnType<typeof setInterval> | null = null
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function broadcastState(): void {
  broadcast('daypanel:state-changed', { detached: isPopoutOpen(), mode, collapsed, widgetInteractive })
}

export function isPopoutOpen(): boolean {
  return !!popout && !popout.isDestroyed()
}

export function getPanelMode(): PanelMode {
  return mode
}

let onModeChangedCb: (() => void) | null = null
/** 主进程订阅模式变化（托盘菜单刷新 radio 状态） */
export function onPanelModeChanged(cb: () => void): void {
  onModeChangedCb = cb
}

/** 模式切换（托盘菜单 / 快捷键 / 窗口内按钮共用入口）；不兼容创建期选项时重建窗口 */
export function setPanelMode(m: PanelMode): void {
  if (!MODES.includes(m)) return
  mode = m
  setSetting('dayPanelMode', m)
  if (isPopoutOpen()) {
    if (windowMode !== m) {
      destroyPopout()
      createPopout()
    }
  }
  broadcast('daypanel:mode-changed', { mode: m })
  onModeChangedCb?.()
}

/** 主窗口内容区高度（脱离时的默认高度） */
function innerHeightOf(main: BrowserWindow): number {
  return Math.max(420, main.getContentSize()[1])
}

function savedBounds(): { x?: number; y?: number; width?: number; height?: number } {
  const raw = getSetting('dayPanelPopoutBounds')
  if (raw && typeof raw === 'object') return raw as { x?: number; y?: number; width?: number; height?: number }
  return {}
}

/** top-dock 展开目标高度（永远取持久化高度，收缩态不覆盖） */
function expandedHeightOf(): number {
  const h = savedBounds().height
  return h && h > 100 ? h : DEFAULT_H
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
  const saved = savedBounds()

  let x: number, y: number, w: number, h: number
  if (mode === 'top-dock') {
    w = saved.width ?? DEFAULT_W
    h = collapsed ? TOUCH_STRIP_H : expandedHeightOf()
    x = saved.x ?? wa.x + wa.width - w - 80
    y = wa.y
  } else if (mode === 'desktop-widget') {
    w = WIDGET_W
    h = WIDGET_H
    x = saved.x ?? wa.x + wa.width - w - 24
    y = saved.y ?? wa.y + 24
  } else {
    w = saved.width ?? DEFAULT_W
    h = saved.height ?? (main ? innerHeightOf(main) : DEFAULT_H)
    x = saved.x ?? (mb ? Math.min(mb.x + mb.width + 12, wa.x + wa.width - w) : wa.x + wa.width - w - 80)
    y = saved.y ?? (mb ? mb.y + 36 : wa.y + 60)
  }

  const isWidget = mode === 'desktop-widget'
  windowMode = mode

  popout = new BrowserWindow({
    x: Math.max(wa.x, Math.min(x, wa.x + wa.width - w)),
    y: Math.max(wa.y, Math.min(y, wa.y + wa.height - h)),
    width: w,
    height: h,
    minWidth: isWidget ? WIDGET_W : 240,
    minHeight: isWidget ? WIDGET_H : 60,
    maxWidth: isWidget ? WIDGET_W : undefined,
    maxHeight: isWidget ? WIDGET_H : undefined,
    frame: false,
    skipTaskbar: true,
    maximizable: false,
    fullscreenable: false,
    resizable: !isWidget && mode !== 'top-dock',
    show: false,
    title: '日程与打卡',
    transparent: isWidget,
    backgroundColor: isWidget ? '#00000000' : '#1e1e1e',
    alwaysOnTop: mode === 'top-dock' || isWidget,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--day-panel-window'],
    },
  })

  if (mode === 'top-dock') popout.setAlwaysOnTop(true, 'floating')

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
    if (!popout || popout.isDestroyed()) return
    popout.show()
    syncWindowBehavior()
    broadcastState()
  })

  // 位置/尺寸持久化（top-dock 收缩态、动画期间跳过，避免覆盖展开高度）
  popout.on('moved', scheduleSaveBounds)
  popout.on('resized', scheduleSaveBounds)

  // X 关闭 = 自动回内嵌
  popout.on('closed', () => {
    popout = null
    windowMode = null
    stopAnim()
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
    broadcastState()
  })
}

/** 按当前模式同步窗口行为（创建期选项之外的运行时行为） */
function syncWindowBehavior(): void {
  if (!popout || popout.isDestroyed()) return
  if (mode === 'desktop-widget') {
    widgetInteractive = false
    popout.setIgnoreMouseEvents(true, { forward: true })
    broadcast('daypanel:widget-interactive-changed', { interactive: false })
  }
}

function scheduleSaveBounds(): void {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null
    if (!popout || popout.isDestroyed()) return
    if (topDockAnimating) { scheduleSaveBounds(); return }
    if (mode === 'top-dock' && collapsed) return
    const b = popout.getBounds()
    if (b.width < 40 || b.height < 20) return
    setSetting('dayPanelPopoutBounds', { x: b.x, y: b.y, width: b.width, height: b.height })
  }, BOUNDS_SAVE_MS)
}

function destroyPopout(): void {
  stopAnim()
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
  if (popout && !popout.isDestroyed()) popout.destroy()
  popout = null
  windowMode = null
  broadcastState()
}

/** top-dock 展开/收回动画（主进程逐帧 setBounds，仅动高度，顶部边缘不动） */
function animateHeight(target: number): void {
  if (!popout || popout.isDestroyed()) return
  const b = popout.getBounds()
  const start = b.height
  if (Math.abs(start - target) < 2) return
  const t0 = Date.now()
  topDockAnimating = true
  stopAnim()
  animTimer = setInterval(() => {
    if (!popout || popout.isDestroyed()) { stopAnim(); topDockAnimating = false; return }
    const p = Math.min(1, (Date.now() - t0) / EXPAND_MS)
    const ease = 1 - Math.pow(1 - p, 3)
    const h = Math.round(start + (target - start) * ease)
    const cur = popout.getBounds()
    popout.setBounds({ ...cur, height: h })
    if (p >= 1) { stopAnim(); topDockAnimating = false }
  }, 16)
}

function stopAnim(): void {
  if (animTimer) { clearInterval(animTimer); animTimer = null }
}

export function initDayPanel(opts: {
  getMainWindow: () => BrowserWindow | null
  rendererUrl: () => string | null
  getSetting: (key: string) => unknown
  setSetting: (key: string, value: unknown) => void
}): void {
  getMainWindow = opts.getMainWindow
  getRendererUrl = opts.rendererUrl
  getSetting = opts.getSetting
  setSetting = opts.setSetting
  const savedMode = opts.getSetting('dayPanelMode') as PanelMode | undefined
  if (savedMode && MODES.includes(savedMode)) mode = savedMode
  registerHandlers()
  try {
    globalShortcut.register('Control+Alt+S', () => { togglePanel() })
    globalShortcut.register('Control+Alt+Up', () => { setPanelMode('top-dock') })
    globalShortcut.register('Control+Alt+Down', () => { setPanelMode('desktop-widget') })
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
  ipcMain.handle('daypanel:get-state', () => ({ detached: isPopoutOpen(), mode, collapsed, widgetInteractive }))
  ipcMain.handle('daypanel:toggle', () => {
    togglePanel()
    return isPopoutOpen()
  })
  ipcMain.handle('daypanel:mode-set', (_e, m: PanelMode) => { setPanelMode(m); return mode })
  ipcMain.handle('daypanel:mode-get', () => mode)

  // ---- top-dock：展开 / 收回意图（500ms grace）/ 取消收回 ----
  ipcMain.handle('daypanel:topdock-expand', () => {
    if (mode !== 'top-dock' || !isPopoutOpen()) return
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
    if (collapsed && !topDockAnimating) {
      collapsed = false
      animateHeight(expandedHeightOf())
      broadcast('daypanel:collapsed-changed', { collapsed: false })
    }
  })
  ipcMain.handle('daypanel:topdock-collapse-intent', () => {
    if (mode !== 'top-dock' || !isPopoutOpen() || topDockAnimating || collapsed) return
    if (collapseTimer) return
    collapseTimer = setTimeout(() => {
      collapseTimer = null
      if (!isPopoutOpen() || topDockAnimating || collapsed) return
      collapsed = true
      animateHeight(TOUCH_STRIP_H)
      broadcast('daypanel:collapsed-changed', { collapsed: true })
    }, COLLAPSE_DELAY_MS)
  })
  ipcMain.handle('daypanel:topdock-cancel-collapse', () => {
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
  })

  // ---- desktop-widget：可交互态切换（穿透 ⇄ 可点）----
  ipcMain.handle('daypanel:widget-interactive', (_e, active: boolean) => {
    if (mode !== 'desktop-widget' || !isPopoutOpen()) return
    widgetInteractive = !!active
    popout?.setIgnoreMouseEvents(!widgetInteractive, { forward: true })
    broadcast('daypanel:widget-interactive-changed', { interactive: widgetInteractive })
    return widgetInteractive
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
  try { globalShortcut.unregister('Control+Alt+Up') } catch { /* ignore */ }
  try { globalShortcut.unregister('Control+Alt+Down') } catch { /* ignore */ }
  destroyPopout()
}
