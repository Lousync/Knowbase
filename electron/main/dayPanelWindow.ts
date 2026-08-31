import { BrowserWindow, ipcMain, screen, globalShortcut, shell } from 'electron'
import { join } from 'path'

/**
 * 日程与打卡小窗（主窗口的延伸，非主窗口内分栏）
 *
 * - 独立无边框 BrowserWindow：无标题栏、不进任务栏、禁止最大化（防表头拖拽区双击误放大）
 * - 加载渲染层 #/day-panel 路由（复用同一 bundle，App.tsx 按 hash 分流）
 * - 默认贴主窗口右缘吸附：主窗口 move/resize → 实时跟随位置（不跟随尺寸）
 * - 用户拖动表头自动解除吸附（程序化 setBounds 与实际位置比对判定）；⛶ 按钮 / daypanel:dock 回吸附
 * - 位置/大小/吸附状态持久化到 settings.json（经 initDayPanel 注入的回调，绕过渲染层设置白名单）
 * - 生命周期随主窗口：主窗口 closed → destroy；关闭面板默认 hide 保活
 * - 跨窗口数据同步见 electron/main/windowBus.ts（data:notify → kb:data-changed）
 *
 * 几何规则（2026-08-31 重写，修四个硬伤）：
 * - 吸附态位置一律 clamp 回工作区；主窗口右缘外放不下时整窗贴工作区右缘（宽度不压缩），绝不跑出屏幕
 * - 吸附态尺寸由用户自由调整并持久化，不再被主窗口高度绑架（首次打开默认与主窗口等高）
 * - 调整大小期间不判「拖离」（Electron 无 resize 起止事件，用时间窗兜底），否则拖左缘调宽会误解除吸附
 * - 程序化 setBounds 记录目标矩形 + 时间窗双重保护，move 回声（含 Windows 忙时延迟到达）不误判脱附
 */

export interface DayPanelState {
  /** 持久化几何状态版本。v2 起与旧的失控尺寸/脱附状态隔离。 */
  version: 2
  x: number | null
  y: number | null
  width: number
  height: number
  docked: boolean
}

const DAY_PANEL_STATE_VERSION = 2
const DEFAULT_WIDTH = 300
const DEFAULT_HEIGHT = 820
const MIN_WIDTH = 240
const MIN_HEIGHT = 420
const DOCK_GAP = 0
/** 用户拖离判定阈值：实际位置与吸附期望位置偏差超过该值 → 解除吸附（调小到 8，拖动即脱离不再回弹） */
const DOCK_SLIP_THRESHOLD = 8
/** resize 事件后的静默窗口：期间 move 事件不判拖离，也不做磁吸 */
const RESIZE_GUARD_MS = 200
/** 程序化 setBounds 后的静默窗口：期间 move/moved 不做任何判定 */
const PROGRAMMATIC_GUARD_MS = 400
/** move 事件与最近一次程序化目标的位置容差：≤该值视为程序化回声（Windows 忙时事件延迟可能超保护窗） */
const PROGRAMMATIC_ECHO_PX = 3
/** 磁吸提示范围：自由摆放状态下，左缘距主窗口右缘小于该值 → 出现吸附气泡提示 */
const MAGNET_RANGE = 160
/** 磁吸触发距离：|距离| 小于该值 → 拖拽松手后自动吸附（磁铁效果） */
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
let state: DayPanelState = { version: DAY_PANEL_STATE_VERSION, x: null, y: null, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, docked: true }
let quitting = false
let attachedMain: BrowserWindow | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let lastHintAt = 0
let lastResizeAt = 0
let programmaticUntil = 0
/** 伴随最小化：主窗口最小化前小窗是否可见 */
let followMinimize = false
/** 伴随最小化：上一次观测到的主窗口最小化状态（轮询用） */
let lastMainMinimized = false
let minimizePollTimer: ReturnType<typeof setInterval> | null = null

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

/** 主窗口矩形（不可用则 null） */
function mainBounds(): { x: number; y: number; width: number; height: number } | null {
  const main = deps?.getMainWindow() ?? null
  if (!main || main.isDestroyed()) return null
  return main.getBounds()
}

/** 参照点所在显示器的工作区（取不到则回落主显示器） */
function workAreaNear(ref: { x: number; y: number }): { x: number; y: number; width: number; height: number } {
  try {
    return screen.getDisplayNearestPoint({ x: ref.x, y: ref.y }).workArea
  } catch {
    return screen.getPrimaryDisplay().workArea
  }
}

function normalizeState(raw: unknown): DayPanelState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<DayPanelState>

  // v1 曾在主窗口跟随过程中把 resize 反馈写回 settings，可能留下全屏尺寸与 docked=false。
  // 此类状态无法区分“用户自由摆放”与“程序误脱附”，因此只迁移一次：重置为可靠的默认吸附态。
  if (s.version !== DAY_PANEL_STATE_VERSION) {
    return {
      version: DAY_PANEL_STATE_VERSION,
      x: null,
      y: null,
      width: DEFAULT_WIDTH,
      height: defaultHeight(),
      docked: true,
    }
  }

  const main = mainBounds()
  const ref = {
    x: typeof s.x === 'number' ? s.x : (main?.x ?? 0),
    y: typeof s.y === 'number' ? s.y : (main?.y ?? 0),
  }
  const wa = workAreaNear(ref)
  return {
    version: DAY_PANEL_STATE_VERSION,
    x: typeof s.x === 'number' ? s.x : null,
    y: typeof s.y === 'number' ? s.y : null,
    // 即使状态文件被外部改坏，单窗尺寸也不能超过当前显示器工作区。
    width: clamp(typeof s.width === 'number' && s.width >= MIN_WIDTH ? s.width : DEFAULT_WIDTH, MIN_WIDTH, wa.width),
    height: clamp(typeof s.height === 'number' && s.height >= MIN_HEIGHT ? s.height : defaultHeight(), MIN_HEIGHT, wa.height),
    docked: s.docked !== false,
  }
}

/** 首次打开时的默认高度：与主窗口等高，并限制在工作区内 */
function defaultHeight(): number {
  const b = mainBounds()
  if (!b) return DEFAULT_HEIGHT
  return clamp(b.height, MIN_HEIGHT, workAreaNear(b).height)
}

function persist(): void {
  if (!deps) return
  deps.saveState({ ...state })
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { persistTimer = null; persist() }, 300)
}

/**
 * 吸附态期望矩形：优先贴主窗口右缘外侧；放不下则整窗贴工作区右缘（宽度不变）；
 * 极端情况（小窗比工作区还宽）才压缩宽度。
 * 关键约束：宽度压缩是最后手段 —— 旧版曾按 rightSpace 提前压缩，导致主窗口最大化时
 * 用户宽度 300 被压成 240 且只 setPosition 不 setSize，出现「右侧出屏 + 宽度永久缩水」。
 */
function dockedBounds(width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  const b = mainBounds()
  if (!b) return null
  const wa = workAreaNear(b)
  // 极端兜底：工作区本身放不下期望宽高（超宽屏竖屏/极小分辨率）才压缩
  const w = Math.min(Math.max(width, MIN_WIDTH), wa.width)
  const h = Math.min(Math.max(height, MIN_HEIGHT), wa.height)
  let x = b.x + b.width + DOCK_GAP
  // 主窗口右缘外放不下（主窗口最大化/贴着屏幕右缘）→ 整窗贴工作区右缘，宽度保持不变。
  // 此时小窗与最大化的主窗口重叠属预期：独立窗口层级，点击主窗口即可把小窗压下去。
  if (x + w > wa.x + wa.width) x = wa.x + wa.width - w
  return {
    x: clamp(x, wa.x, wa.x + wa.width - w),
    y: clamp(b.y, wa.y, wa.y + wa.height - h),
    width: w,
    height: h,
  }
}

/** 程序化 setBounds：打静默标记并记录目标矩形，避免随后的 move/moved 事件被误判成用户操作 */
function applyBounds(r: { x: number; y: number; width: number; height: number }): void {
  if (!panel || panel.isDestroyed()) return
  programmaticUntil = Date.now() + PROGRAMMATIC_GUARD_MS
  lastProgrammaticTarget = r
  panel.setBounds(r)
}
let lastProgrammaticTarget: { x: number; y: number; width: number; height: number } | null = null

/** move 事件位置与最近一次程序化目标几乎一致 → 程序化回声（不是用户拖动），忽略 */
function isProgrammaticEcho(b: { x: number; y: number }): boolean {
  const t = lastProgrammaticTarget
  return !!t && Math.abs(b.x - t.x) <= PROGRAMMATIC_ECHO_PX && Math.abs(b.y - t.y) <= PROGRAMMATIC_ECHO_PX
}

/** 归一化吸附尺寸；主窗口移动时不应通过 setBounds 反复设置子窗口尺寸。 */
function normalizeDockedSize(expect: { width: number; height: number }): void {
  // 工作区变化（显示器/分辨率/最大化）可能让旧尺寸超出当前屏幕，回写归一化后的尺寸。
  state.width = expect.width
  state.height = expect.height
}

/** 吸附态下同时应用位置和尺寸（首次显示、手动回吸附、显示器边界变化）。 */
function applyDocked(): void {
  const expect = dockedBounds(state.width, state.height)
  if (!expect) return
  normalizeDockedSize(expect)
  applyBounds(expect)
}

/** 吸附态跟随主窗口：位置+尺寸整体 setBounds。
 *  旧版只 setPosition：dockedBounds 归一化出的尺寸（如换显示器/分辨率变化后）从未被应用，
 *  造成「state 尺寸 ≠ 实际尺寸」漂移，并在下次 applyDocked 时突然跳变。统一走 applyBounds
 *  （带 programmaticUntil 保护，触发的 resize/move 回声会被忽略）。 */
function followDocked(): void {
  if (!panel || panel.isDestroyed()) return
  const expect = dockedBounds(state.width, state.height)
  if (!expect) return
  normalizeDockedSize(expect)
  applyBounds(expect)
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function broadcastVisible(): void {
  broadcast('daypanel:visible-changed', isPanelVisible())
}

function isPanelVisible(): boolean {
  return !!panel && !panel.isDestroyed() && panel.isVisible()
}

/** 主窗口 move/resize → 吸附态下小窗跟随（位置+尺寸）；最大化/还原时 Windows 上
 *  事件触发瞬间 getBounds() 可能仍是旧矩形（平台时序），故额外延迟二次校正。 */
function attachMainListeners(): void {
  const main = deps?.getMainWindow() ?? null
  if (!main || main.isDestroyed() || main === attachedMain) return
  attachedMain = main
  const follow = () => {
    if (!panel || panel.isDestroyed() || !panel.isVisible() || !state.docked || quitting) return
    followDocked()
  }
  main.on('move', follow)
  main.on('resize', follow)
  // 最大化/还原：事件时 getBounds 可能未更新 → 立即跟随一次 + 120ms 后按最终矩形再校正一次
  main.on('maximize', () => { follow(); setTimeout(follow, 120) })
  main.on('unmaximize', () => { follow(); setTimeout(follow, 120) })
  // 伴随最小化路径①：平台事件（快速响应）
  main.on('minimize', () => { lastMainMinimized = true; dayPanelOnMainMinimized() })
  main.on('restore', () => { lastMainMinimized = false; restoreFollowMinimize() })
}

// ===== 伴随最小化 =====
// 需求：主窗口最小化 → 小窗一起消失；还原 → 按原可见状态回来。
// 实现不赌单一事件，三路并存（任意一路命中即生效，天然幂等）：
//   ① 平台事件 minimize/restore（attachMainListeners 内绑定，最快）
//   ② IPC 联动：主窗口标题栏最小化按钮 → dayPanelOnMainMinimized()（用户最常用入口）
//   ③ 500ms 低频轮询主窗口 isMinimized() 状态变化（兜底，Windows 上最可靠）

/**
 * 主窗口最小化时的联动入口，导出给 index.ts 的 window:minimize handler 调用。
 * 幂等：小窗不可见时直接返回。
 */
export function dayPanelOnMainMinimized(): void {
  if (quitting) return
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return
  followMinimize = true
  hidePanel()
}

/** 主窗口还原：恢复最小化前可见的小窗 */
function restoreFollowMinimize(): void {
  if (quitting || !followMinimize) return
  followMinimize = false
  showPanel()
}

/** 路径③：低频轮询，检测主窗口最小化状态变化（不依赖任何事件） */
function startMinimizePolling(): void {
  if (minimizePollTimer) return
  minimizePollTimer = setInterval(() => {
    if (quitting) return
    const main = deps?.getMainWindow() ?? null
    if (!main || main.isDestroyed()) return
    const minimized = main.isMinimized()
    if (minimized === lastMainMinimized) return
    lastMainMinimized = minimized
    if (minimized) dayPanelOnMainMinimized()
    else restoreFollowMinimize()
  }, 500)
}

/** 拖拽中：吸附态判「拖离」，自由态出磁吸气泡并持久化位置 */
function onPanelMove(): void {
  if (!panel || panel.isDestroyed() || quitting) return
  const b = panel.getBounds()
  if (Date.now() < programmaticUntil) return
  // 保护窗已过但位置仍停在程序化目标上 → 是延迟到达的程序化回声，不是用户拖动
  // （Windows 卡顿时 move 事件可能晚于保护窗到达，此前会被误判脱附）
  if (isProgrammaticEcho(b)) return

  if (state.docked) {
    // 调整大小期间不判拖离：拖左缘/顶缘改尺寸会同时改 x/y，若按位置判定会误解除吸附
    if (Date.now() - lastResizeAt < RESIZE_GUARD_MS) {
      state.width = b.width
      state.height = b.height
      schedulePersist()
      return
    }
    const expect = dockedBounds(state.width, state.height)
    if (!expect) return
    if (Math.abs(b.x - expect.x) > DOCK_SLIP_THRESHOLD || Math.abs(b.y - expect.y) > DOCK_SLIP_THRESHOLD) {
      // 用户拖离 → 解除吸附，从当前位置转为自由摆放
      state.docked = false
      state.x = b.x
      state.y = b.y
      state.width = b.width
      state.height = b.height
      persist()
      broadcast('daypanel:snap-changed', { docked: false })
    }
    return
  }

  // ---- 自由摆放态：记位置 + 磁吸接近提示（真正的吸附等拖拽结束再做，避免抢窗口） ----
  state.x = b.x
  state.y = b.y
  state.width = b.width
  state.height = b.height
  schedulePersist()

  const mb = mainBounds()
  if (!mb) return
  const dist = b.x - (mb.x + mb.width)          // 小窗左缘到主窗口右缘的水平距离
  const overlap = Math.min(b.y + b.height, mb.y + mb.height) - Math.max(b.y, mb.y)
  const now = Date.now()
  if (dist >= -SNAP_DIST && dist <= MAGNET_RANGE && overlap >= MIN_OVERLAP) {
    if (now - lastHintAt >= HINT_THROTTLE_MS) {
      lastHintAt = now
      broadcast('daypanel:snap-hint', { near: true, dist: Math.max(0, dist) })
    }
  } else if (now - lastHintAt >= HINT_THROTTLE_MS) {
    lastHintAt = now
    broadcast('daypanel:snap-hint', { near: false })
  }
}

/** 拖拽结束（moved）→ 自由态下判定磁吸吸附。松手才吸，中途不抢窗口 */
function onPanelMoveEnd(): void {
  if (!panel || panel.isDestroyed() || quitting) return
  if (state.docked || Date.now() < programmaticUntil) return
  if (Date.now() - lastResizeAt < RESIZE_GUARD_MS) return
  const b = panel.getBounds()
  if (isProgrammaticEcho(b)) return
  const mb = mainBounds()
  if (!mb) return
  const dist = b.x - (mb.x + mb.width)
  const overlap = Math.min(b.y + b.height, mb.y + mb.height) - Math.max(b.y, mb.y)
  if (dist >= -SNAP_DIST && dist <= SNAP_DIST && overlap >= MIN_OVERLAP) {
    state.docked = true
    state.x = null
    state.y = null
    state.width = b.width
    state.height = b.height
    applyDocked()
    persist()
    broadcast('daypanel:snap-changed', { docked: true })
  }
}

function createPanel(): void {
  if (!deps) return
  state = normalizeState(deps.loadState())
  // 立即落盘 v2 状态：避免下一次启动再次读取旧的失控尺寸/误脱附状态。
  persist()
  let bounds: { x: number; y: number; width: number; height: number }
  if (state.docked || state.x == null || state.y == null) {
    bounds = dockedBounds(state.width, state.height) ?? { x: 120, y: 120, width: state.width, height: state.height }
  } else {
    const wa = workAreaNear({ x: state.x, y: state.y })
    const width = Math.min(state.width, wa.width)
    const height = Math.min(state.height, wa.height)
    bounds = {
      x: clamp(state.x, wa.x, wa.x + wa.width - width),
      y: clamp(state.y, wa.y, wa.y + wa.height - height),
      width,
      height,
    }
    state.width = width
    state.height = height
  }
  state.width = bounds.width
  state.height = bounds.height

  panel = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // 注意：这里**不要**设 parent。子窗口会被 Windows 强制置于父窗口之上（z-order 锁死），
    // 导致小窗永久遮挡主窗口内容、点主窗口也调不上来；伴随最小化改由 followMinimize 三路机制保证。
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

  // 首次打开：show 之后再广播一次可见状态 —— 此前只 show 不广播，导致标题栏按钮首次点击不高亮
  panel.once('ready-to-show', () => {
    panel?.show()
    broadcastVisible()
  })
  panel.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      hidePanel()
    }
  })
  panel.on('move', onPanelMove)
  panel.on('moved', onPanelMoveEnd)
  panel.on('resize', () => {
    if (!panel || panel.isDestroyed() || quitting) return
    if (Date.now() >= programmaticUntil) lastResizeAt = Date.now()
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
  // 主窗口处于最小化时唤出小窗 → 先恢复主窗口（伴随语义：快捷键唤出的是整套）。
  // 恢复后主窗口已非最小化，不会与 restoreFollowMinimize 形成递归。
  const main = deps.getMainWindow()
  if (main && !main.isDestroyed() && main.isMinimized()) {
    followMinimize = false
    main.restore()
    main.show()
  }
  if (!panel || panel.isDestroyed()) {
    createPanel()
  } else {
    if (state.docked) applyDocked()
    panel.show()
    panel.focus()
  }
  broadcastVisible()
}

function hidePanel(): void {
  if (!panel || panel.isDestroyed()) return
  const b = panel.getBounds()
  state.width = b.width
  state.height = b.height
  if (!state.docked) {
    state.x = b.x
    state.y = b.y
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
  applyDocked()
  if (!panel.isVisible()) panel.show()
  persist()
  broadcastVisible()
  broadcast('daypanel:snap-changed', { docked: true })
}

/** 主窗口关闭 / 应用退出时销毁小窗（生命周期随主窗口） */
function destroyPanelForQuit(): void {
  quitting = true
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  if (minimizePollTimer) { clearInterval(minimizePollTimer); minimizePollTimer = null }
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
}

/**
 * 初始化小窗模块：注册 IPC + 全局快捷键 Ctrl+Alt+S。
 * 在 app.whenReady 内调用；不自动打开窗口（启动不自动展开）。
 */
export function initDayPanel(d: DayPanelDeps): void {
  deps = d
  registerDayPanelHandlers()
  startMinimizePolling()
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
