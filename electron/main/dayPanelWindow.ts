import { BrowserWindow, ipcMain, screen, globalShortcut, shell } from 'electron'
import { join } from 'path'

/**
 * 日程与打卡小窗（主窗口的延伸，非主窗口内分栏）
 *
 * - 独立无边框 BrowserWindow：无标题栏、不进任务栏、禁止最大化（防表头拖拽区双击误放大）
 * - 加载渲染层 #/day-panel 路由（复用同一 bundle，App.tsx 按 hash 分流）
 * - 默认贴主窗口右缘吸附：主窗口 move/resize → 实时跟随
 * - 用户拖动表头自动解除吸附（程序化 setBounds 与实际位置比对判定）；⛶ 按钮 / daypanel:dock 回吸附
 * - 位置/大小/吸附状态持久化到 settings.json（经 initDayPanel 注入的回调，绕过渲染层设置白名单）
 * - 生命周期随主窗口：主窗口 closed → destroy；关闭面板默认 hide 保活
 * - 跨窗口数据同步：data:notify（任一窗口上报）→ 主进程转发 kb:data-changed 给其它窗口
 */

export interface DayPanelState {
  x: number | null
  y: number | null
  width: number
  height: number
  docked: boolean
}

const DEFAULT_WIDTH = 300
const DEFAULT_HEIGHT = 820
const MIN_WIDTH = 240
const MIN_HEIGHT = 420
const DOCK_GAP = 0
/** 用户拖离判定阈值：实际位置与吸附期望位置偏差超过该值 → 解除吸附 */
const DOCK_SLIP_THRESHOLD = 16
/** 磁吸范围：自由摆放状态下，左缘距主窗口右缘小于该值 → 出现吸附气泡提示 */
const MAGNET_RANGE = 160
/** 磁吸触发距离：小于该值 → 自动吸附（磁铁效果） */
const SNAP_DIST = 24
/** 磁吸所需的最小垂直重叠量（px），避免错位窗口被误吸 */
const MIN_OVERLAP = 40
/** snap-hint 广播节流（ms），move 事件高频触发，避免刷 IPC */
const HINT_THROTTLE_MS = 60

interface DayPanelDeps {
  getMainWindow: () => BrowserWindow | null
  /** 返回上次持久化的状态（可能是坏数据/undefined），内部会 normalize */
  loadState: () => unknown
  saveState: (s: DayPanelState) => void
}

let deps: DayPanelDeps | null = null
let panel: BrowserWindow | null = null
let state: DayPanelState = { x: null, y: null, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, docked: true }
let quitting = false
let attachedMain: BrowserWindow | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let lastHintAt = 0

function pad(n: number): string { return String(n).padStart(2, '0') }

function normalizeState(raw: unknown): DayPanelState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<DayPanelState>
  return {
    x: typeof s.x === 'number' ? s.x : null,
    y: typeof s.y === 'number' ? s.y : null,
    width: typeof s.width === 'number' && s.width >= MIN_WIDTH ? s.width : DEFAULT_WIDTH,
    height: typeof s.height === 'number' && s.height >= MIN_HEIGHT ? s.height : DEFAULT_HEIGHT,
    docked: s.docked !== false,
  }
}

function persist(): void {
  if (!deps) return
  deps.saveState({ ...state })
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { persistTimer = null; persist() }, 300)
}

function clampToWorkArea(x: number, y: number, w: number, h: number): { x: number; y: number } {
  let wa = screen.getPrimaryDisplay().workArea
  try { wa = screen.getDisplayNearestPoint({ x, y }).workArea } catch { /* 用主显示器兜底 */ }
  return {
    x: Math.min(Math.max(x, wa.x), Math.max(wa.x, wa.x + wa.width - w)),
    y: Math.min(Math.max(y, wa.y), Math.max(wa.y, wa.y + wa.height - h)),
  }
}

/** 吸附态期望位置：主窗口右缘外贴、等高 */
function dockedBounds(width: number): { x: number; y: number; width: number; height: number } | null {
  const main = deps?.getMainWindow() ?? null
  if (!main || main.isDestroyed()) return null
  const b = main.getBounds()
  return { x: b.x + b.width + DOCK_GAP, y: b.y, width, height: b.height }
}

function broadcastVisible(): void {
  const visible = isPanelVisible()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('daypanel:visible-changed', visible)
  }
}

function isPanelVisible(): boolean {
  return !!panel && !panel.isDestroyed() && panel.isVisible()
}

/** 主窗口 move/resize → 吸附态下小窗跟随 */
function attachMainListeners(): void {
  const main = deps?.getMainWindow() ?? null
  if (!main || main.isDestroyed() || main === attachedMain) return
  attachedMain = main
  const follow = () => {
    if (!panel || panel.isDestroyed() || !panel.isVisible() || !state.docked || quitting) return
    const expect = dockedBounds(state.width)
    if (!expect) return
    panel.setBounds(expect)
  }
  main.on('move', follow)
  main.on('resize', follow)
  main.on('maximize', follow)
  main.on('unmaximize', follow)
  // 注：伴随最小化由「子窗口」系统行为保证（createPanel 设置 parent），无需手动监听
}

/** 向所有窗口广播（小窗为接收方：吸附气泡 / 吸附完成提示） */
function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** 小窗 move → 吸附态下检测用户拖离；自由态下检测磁吸接近并持久化位置 */
function onPanelMove(): void {
  if (!panel || panel.isDestroyed() || quitting) return
  if (state.docked) {
    const expect = dockedBounds(state.width)
    if (!expect) return
    const b = panel.getBounds()
    if (Math.abs(b.x - expect.x) > DOCK_SLIP_THRESHOLD || Math.abs(b.y - expect.y) > DOCK_SLIP_THRESHOLD) {
      // 用户拖离 → 解除吸附，从当前位置转为自由摆放
      state.docked = false
      state.x = b.x
      state.y = b.y
      persist()
      broadcast('daypanel:snap-changed', { docked: false })
    }
    return
  }

  // ---- 自由摆放态：磁吸检测（拖近主窗口右缘 → 气泡提示 → 自动吸附） ----
  const b = panel.getBounds()
  state.x = b.x
  state.y = b.y
  schedulePersist()

  const main = deps?.getMainWindow() ?? null
  if (!main || main.isDestroyed()) return
  const mb = main.getBounds()
  const dist = b.x - (mb.x + mb.width)          // 小窗左缘到主窗口右缘的水平距离
  const overlap = Math.min(b.y + b.height, mb.y + mb.height) - Math.max(b.y, mb.y)
  const now = Date.now()

  if (dist >= -SNAP_DIST && dist <= MAGNET_RANGE && overlap >= MIN_OVERLAP) {
    if (dist <= SNAP_DIST) {
      // 磁铁吸附：吸附到主窗口右缘
      state.docked = true
      state.x = null
      state.y = null
      const expect = dockedBounds(state.width)
      if (expect) panel.setBounds(expect)
      persist()
      broadcast('daypanel:snap-changed', { docked: true })
      return
    }
    // 接近但未触发 → 气泡提示（带距离，供小窗做渐进反馈）
    if (now - lastHintAt >= HINT_THROTTLE_MS) {
      lastHintAt = now
      broadcast('daypanel:snap-hint', { near: true, dist: Math.max(0, dist) })
    }
  } else if (now - lastHintAt >= HINT_THROTTLE_MS) {
    lastHintAt = now
    broadcast('daypanel:snap-hint', { near: false })
  }
}

function createPanel(): void {
  if (!deps) return
  state = normalizeState(deps.loadState())
  let bounds: { x: number; y: number; width: number; height: number }
  if (state.docked || state.x == null || state.y == null) {
    bounds = dockedBounds(state.width) ?? { x: 120, y: 120, width: state.width, height: state.height }
  } else {
    const c = clampToWorkArea(state.x, state.y, state.width, state.height)
    bounds = { x: c.x, y: c.y, width: state.width, height: state.height }
  }

  panel = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // 子窗口：系统级保证「伴随最小化」——主窗口最小化/还原时小窗自动跟随（Windows 原生行为），
    // 不依赖 minimize/restore 事件（frameless 窗口事件触发不可靠）；主窗口关闭时小窗自动关闭
    parent: deps?.getMainWindow() ?? undefined,
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

  // 安全：与主窗口同款策略——永不导航、不在应用内开新窗口
  panel.webContents.on('will-navigate', (e) => e.preventDefault())
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  panel.webContents.on('render-process-gone', (_e, details) => {
    console.error('[DayPanel] render-process-gone:', details)
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void panel.loadURL(`${devUrl}#/day-panel`)
  } else {
    void panel.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'day-panel' })
  }

  panel.once('ready-to-show', () => panel?.show())
  panel.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      hidePanel()
    }
  })
  panel.on('move', onPanelMove)
  panel.on('resize', () => {
    if (!panel || panel.isDestroyed() || state.docked) return
    const b = panel.getBounds()
    state.width = b.width
    state.height = b.height
    schedulePersist()
  })
  panel.on('closed', () => { panel = null })
  attachMainListeners()
}

function showPanel(): void {
  if (!deps) return
  if (!panel || panel.isDestroyed()) {
    createPanel()
  } else {
    if (state.docked) {
      const expect = dockedBounds(state.width)
      if (expect) panel.setBounds(expect)
    }
    panel.show()
    panel.focus()
  }
  broadcastVisible()
}

function hidePanel(): void {
  if (!panel || panel.isDestroyed()) return
  const b = panel.getBounds()
  if (!state.docked) {
    state.x = b.x
    state.y = b.y
    state.width = b.width
    state.height = b.height
  }
  persist()
  panel.hide()
  broadcastVisible()
}

function toggleDayPanel(): void {
  if (isPanelVisible()) hidePanel()
  else showPanel()
}

function dockDayPanel(): void {
  if (!panel || panel.isDestroyed()) { showPanel(); return }
  state.docked = true
  state.x = null
  state.y = null
  const expect = dockedBounds(state.width)
  if (expect) panel.setBounds(expect)
  if (!panel.isVisible()) panel.show()
  persist()
  broadcastVisible()
}

/** 主窗口关闭 / 应用退出时销毁小窗（生命周期随主窗口） */
function destroyPanelForQuit(): void {
  quitting = true
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  if (panel && !panel.isDestroyed()) panel.destroy()
  panel = null
}

function unregisterShortcut(): void {
  try { globalShortcut.unregister('Control+Alt+S') } catch { /* ignore */ }
}

/** 注册 IPC（在 app.whenReady 内调用一次） */
function registerDayPanelHandlers(): void {
  ipcMain.handle('daypanel:toggle', () => { toggleDayPanel(); return isPanelVisible() })
  ipcMain.handle('daypanel:close', () => { hidePanel(); return true })
  ipcMain.handle('daypanel:dock', () => { dockDayPanel(); return true })
  ipcMain.handle('daypanel:get-state', () => ({ visible: isPanelVisible(), docked: state.docked }))

  // 小窗「打开任务模块」→ 唤起主窗口并切 Tab
  ipcMain.on('daypanel:open-in-main', (_e, tab: string) => {
    const main = deps?.getMainWindow() ?? null
    if (!main || main.isDestroyed() || typeof tab !== 'string') return
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    main.webContents.send('main:command', { type: 'switch-tab', tab })
  })

  // 跨窗口数据同步：任一窗口上报 → 转发给其它窗口（排除发送方，发送方自身已本地广播）
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
 * 初始化小窗模块：注册 IPC + 全局快捷键 Ctrl+Alt+S。
 * 在 app.whenReady 内调用；不自动打开窗口（启动不自动展开）。
 */
export function initDayPanel(d: DayPanelDeps): void {
  deps = d
  registerDayPanelHandlers()
  try {
    globalShortcut.register('Control+Alt+S', () => { toggleDayPanel() })
  } catch (e) {
    console.warn('[DayPanel] 全局快捷键注册失败:', e)
  }
}

/** before-quit 清理：注销快捷键 + 销毁小窗 */
export function disposeDayPanel(): void {
  unregisterShortcut()
  destroyPanelForQuit()
}
