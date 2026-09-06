// 必须最先引入：IPC 注册幂等包装（dev 下 repo 模块被打包两份时避免重复注册崩溃）
import './ipcSafe'
import { app, BrowserWindow, dialog, ipcMain, screen, shell, protocol, clipboard, nativeImage, Menu, net, Tray } from 'electron'
import { join, basename, resolve, sep } from 'path'
import { readFileSync, writeFileSync, existsSync, createReadStream, cpSync, mkdirSync, statSync, readdirSync, appendFileSync } from 'fs'
import { Readable } from 'stream'
import { initDatabase, getDatabase, getDbPath, closeDatabase, getAttachmentsDir, runMigrations, saveToDisk } from '../database/connection'
import { registerPomodoroBroadcast } from './pomodoroState'
import { registerEntryHandlers } from '../database/repositories/entryRepo'
import { bindDataSourceGetter } from '../database/dataSourceMode'
import { registerTagHandlers } from '../database/repositories/tagRepo'
import { registerScheduleHandlers } from '../database/repositories/scheduleRepo'
import { registerKnowledgeHandlers } from '../database/repositories/knowledgeRepo'
import { registerVaultMigrationHandlers } from '../database/repositories/vaultMigrationRepo'
import { registerExportHandlers } from '../database/repositories/exportRepo'
import { registerRecycleBinHandlers } from '../database/repositories/recycleBinRepo'
import { registerImportHandlers } from '../database/repositories/importRepo'
import { registerUserHandlers } from '../database/repositories/userRepo'
import { registerToolboxHandlers } from '../database/repositories/toolboxRepo'
import { registerPasswordHandlers } from '../database/repositories/passwordRepo'
import { registerMomentsHandlers } from '../database/repositories/momentsRepo'
import { registerAttachmentHandlers, getAttachmentFilePath } from '../database/repositories/attachmentRepo'
import { registerBackupHandlers } from '../database/repositories/backupRepo'
import { registerVaultBackupHandlers } from '../database/repositories/vaultBackupRepo'
import { registerRepoConfigHandlers } from '../database/repositories/repoConfigRepo'
import { registerWeightHandlers } from '../database/repositories/weightRepo'
import { registerCheckinHandlers } from '../database/repositories/checkinRepo'
import { registerBookmarkHandlers } from '../database/repositories/bookmarkRepo'
import { registerSuperviseHandlers } from '../database/repositories/superviseRepo'
import { registerSummaryHandlers } from '../database/repositories/summaryRepo'
import { registerBlogTemplateHandlers } from '../database/repositories/blogTemplateRepo'
import { registerQuizHandlers } from '../database/repositories/quizRepo'
import { startSuperviseScheduler, stopSuperviseScheduler } from '../lib/pushService'
import { initPasswordFiller, destroyPasswordFiller } from './passwordFiller'
import { initDayPanel, disposeDayPanel, getPanelMode, setPanelMode, onPanelModeChanged, isPopoutOpen } from './dayPanelWindow'
import { registerWindowBus } from './windowBus'
import { registerDevtoolsHandlers } from './devtools'
import { registerUpdateHandlers } from '../lib/updateService'
import { registerPluginHandlers, getPluginsRoot } from '../lib/pluginRegistry'
import { registerAiToolHandlers } from '../lib/aiTools'
import { registerBuiltinTools } from '../lib/builtinTools'
import { registerMcpHandlers, restoreMcpConnections } from '../lib/mcpService'
import { registerSkillHandlers } from '../lib/skillService'
import { registerLlmHandlers } from '../lib/llmService'
import { registerAgentHandlers } from '../lib/agentService'
import { registerAiTeachingFolderHandlers, migrateRootDir as migrateAiTeachRootDir } from '../lib/aiTeachingFolders'
import { registerAiTeachingWorkspaceHandlers } from '../lib/aiTeachingWorkspaces'
import { registerAiTeachingSourceHandlers } from '../lib/aiTeachingSources'
import { registerTranslateHandlers } from '../lib/translateService'
import { registerWordbookHandlers } from '../lib/wordbookService'
import { registerPdfHandlers } from '../lib/pdfService'
import { registerDocsReadHandlers } from '../lib/docsIpc'
import { registerLanShareHandlers } from '../lib/lanShare'
import { registerClipperHandlers, startClipperServer, stopClipperServer } from '../lib/clipperServer'
import { registerWorkspaceHandlers, trashAllRegisteredVaults } from '../lib/workspaceManager'
import { registerVaultArchiveHandlers } from '../lib/vaultArchive'
import { getCurrentVault, setCurrentVault } from '../lib/kbStore/vaultContext'
import { SETTINGS } from '../../src/lib/settings'

// 附件自定义协议：attachment://{id}/ 与 attachment://{id}/?thumb=1
// 插件自定义协议：plugin://{id}/{file} — UI 插件的沙箱页面(配合 iframe sandbox 使用)
protocol.registerSchemesAsPrivileged([
{ scheme: 'attachment', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
{ scheme: 'plugin', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// ===== 数据隔离：开发版（npm run dev）使用独立 userData 目录 =====
// 已安装版用默认 %APPDATA%/knowbase；开发版用 %APPDATA%/knowbase (dev <目录名>)。
// 按检出目录名隔离 → 主仓库与各 git worktree 的 dev 实例数据互不影响、单实例锁互不冲突。
// 必须在任何模块读取 userData 路径之前执行（下方 settingsPath 是第一个消费者），
// 且在 requestSingleInstanceLock 之前。
// 首次运行时从正式版目录快照一份现有数据（跳过易锁死的缓存目录）；
// 想重新迁移：删除对应「knowbase (dev ...)」目录即可。设置 KNOWBASE_SHARED_DATA=1 可强制共用。
if (!app.isPackaged && process.env.KNOWBASE_SHARED_DATA !== '1') {
  const sharedDir = app.getPath('userData')
  const devDir = `${sharedDir} (dev ${basename(app.getAppPath())})`
  const marker = join(devDir, '.dev-migrated')
  if (!existsSync(marker)) {
    try {
      if (!existsSync(devDir)) mkdirSync(devDir, { recursive: true })
      cpSync(sharedDir, devDir, {
        recursive: true,
        filter: src => !/[\\/](Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Crashpad|crashpad|blob_storage|Session Storage)([\\/]|$)/i.test(src),
      })
      console.log('[DataIsolation] 已从共享目录复制数据到开发目录:', devDir)
    } catch (e) {
      console.warn('[DataIsolation] 复制旧数据失败（可能为缓存文件占用），开发目录将使用已复制部分:', e)
    }
    try { writeFileSync(marker, new Date().toISOString()) } catch { /* ignore */ }
  }
  app.setPath('userData', devDir)
}

// ===== 崩溃/异常留痕（黑匣子）：写入 userData/crash-log.txt，供事后定位 =====
{
  const crashLog = () => {
    try { return join(app.getPath('userData'), 'crash-log.txt') } catch { return 'crash-log.txt' }
  }
  const logCrash = (tag: string, detail: string): void => {
    try {
      const line = `\n[${new Date().toISOString()}] ${tag} v${app.getVersion()}\n${detail}\n`
      appendFileSync(crashLog(), line)
    } catch { /* 留痕失败不影响主流程 */ }
  }
  process.on('uncaughtException', err => {
    logCrash('uncaughtException', err.stack ?? String(err))
    console.error('[crash] uncaughtException:', err)
  })
  process.on('unhandledRejection', reason => {
    const stack = (reason as Error)?.stack ?? String(reason)
    logCrash('unhandledRejection', stack)
    console.error('[crash] unhandledRejection:', reason)
  })
  app.on('child-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    logCrash(`child-process-gone(${details.type})`, `reason=${details.reason} exitCode=${details.exitCode}`)
  })
  ;(globalThis as any).__kbLogRendererGone = (details: { reason: string; exitCode: number }): void => {
    if (details.reason === 'clean-exit') return
    logCrash('render-process-gone', `reason=${details.reason} exitCode=${details.exitCode}`)
  }
}

// ===== Settings memory cache =====
// 禁用 Electron 默认应用菜单：其 View 角色绑定了 Ctrl+R / Ctrl+Shift+R（强制刷新）
// / F11 等全局加速键，会在用户操作时整页重载回启动模块。应用自定义快捷键见各模块。
Menu.setApplicationMenu(null)
const settingsPath = join(app.getPath('userData'), 'settings.json')
let settingsCache: Record<string, unknown> = {}
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadSettingsFromDisk(): Record<string, unknown> {
  let raw: Record<string, unknown> = {}
  try { raw = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : {} } catch { raw = {} }
  // 数据源默认值兜底（对齐渲染层 settings.ts default）：旧 settings.json 缺失键时
  // 主进程曾判定为 sqlite（undefined !== 'vault'）→ 知识包导入/写通道误走 sqlite。
  // 2026-09-03 修复：storageData / storageKnowledge / storageBlog 缺省一律 vault（仓库文件）。
  for (const k of ['storageData', 'storageKnowledge', 'storageBlog'] as const) {
    if (raw[k] === undefined) raw[k] = 'vault'
  }
  // 仓库状态键唯一属主是 vaultContext（直写文件）：主进程缓存绝不能持有其快照，
  // 否则任何一次 flush（含退出前）都会把 currentVaultId/recentVaults 覆盖回启动时
  // 的旧值——用户表现为「切换仓库重启后被打回原仓库」。
  delete raw['currentVaultId']
  delete raw['recentVaults']
  return raw
}

function flushSettingsToDisk(): void {
  saveTimer = null
  try {
    // 合并写回：保留文件中 settingsCache 没有的键（如 kbStore 的 currentVaultId），
    // 避免整体覆盖把其它模块写入 settings.json 的字段抹掉
    const existing = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : {}
    const merged = { ...existing, ...settingsCache }
    writeFileSync(settingsPath, JSON.stringify(merged, null, 2))
  } catch (err) { console.error('Failed to persist settings:', err) }
}

// 允许打包后 file:// 环境下加载本地 module worker（pdf.js 阅读器需要）
app.commandLine.appendSwitch('allow-file-access-from-files')

// 单实例锁 — 防止多窗口数据不同步（sql.js 内存数据库无跨进程共享能力）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例在运行：本实例立即终止，不得执行任何后续初始化。
  // 注意不能用 app.quit()（异步，不阻断同步代码）：whenReady 回调仍会
  // initDatabase + 注册 232 个 IPC + createWindow()，导致窗口闪现后进程
  // 退出，表现为「关闭后再次启动窗口闪烁闪退」。app.exit() 直接终止，
  // 非主实例无任何资源可清理（数据库/窗口尚未创建），安全。
  app.exit(0)
}

let mainWindow: BrowserWindow | null = null

// ===== 托盘常驻：主窗口 X = 隐藏，任务栏独立存活（用户决策 2026-08-31）=====
let isQuitting = false
let tray: Tray | null = null

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  try {
    const candidates = [
      join(app.getAppPath(), 'build', 'icon.png'),
      join(process.resourcesPath ?? '', 'build', 'icon.png'),
    ]
    let img = nativeImage.createEmpty()
    for (const p of candidates) {
      const cand = nativeImage.createFromPath(p)
      if (!cand.isEmpty()) { img = cand; break }
    }
    if (process.platform === 'win32') img = img.resize({ width: 16, height: 16 })
    tray = new Tray(img)
    tray.setToolTip('Knowbase · 日程打卡')
    const rebuildMenu = () => {
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: '显示主窗口', click: showMainWindow },
        { type: 'separator' },
        { label: '任务栏模式', submenu: [
          { label: '自由漂浮', type: 'radio', checked: getPanelMode() === 'floating', click: () => setPanelMode('floating') },
          { label: '顶部停靠', type: 'radio', checked: getPanelMode() === 'top-dock', click: () => setPanelMode('top-dock') },
          { label: '桌面小组件', type: 'radio', checked: getPanelMode() === 'desktop-widget', click: () => setPanelMode('desktop-widget') },
        ]},
        { type: 'separator' },
        { label: '退出 Knowbase', click: () => { isQuitting = true; app.quit() } },
      ]))
    }
    rebuildMenu()
    // 模式变化时刷新托盘单选状态
    onPanelModeChanged(rebuildMenu)
    tray.on('click', showMainWindow)
    console.log('[Tray] 托盘已创建')
  } catch (e) {
    console.warn('[Tray] 创建失败（不影响使用）:', e)
  }
}

function createWindow(): void {
  console.log('[Window] ELECTRON_RENDERER_URL =', process.env.ELECTRON_RENDERER_URL || '(empty)')
  // 透明窗口 + 渲染层自绘大圆角（用户决策 2026-09-05）：系统 DWM 圆角半径固定 ~8px 不可调，
  // 且与 acrylic 材质互斥；改为透明窗口后磨砂感由应用内分层半透明模拟，旧系统无兼容性差异
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Knowbase',
    frame: false,                          // 无边框 → 自定义标题栏
    titleBarStyle: 'hidden',              // macOS 隐藏原生标题栏
    transparent: true,                     // 透明底 → 根容器 18px 自绘圆角（最大化时渲染层自动切直角）
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,                         // preload 仅用 contextBridge/ipcRenderer/webUtils,完全兼容沙箱
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 安全：主窗口自身永不导航(应用为单页,任何导航请求均为异常/注入行为)。
  // 例外：同 URL 的 reload——Electron 把 location.reload() 也当导航触发本事件，
  // 无差别 preventDefault 会静默吞掉它（P8 仓库切换整窗重载失效、UI 卡旧仓库的根因）。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const win = mainWindow
    if (win && url === win.webContents.getURL()) return
    event.preventDefault()
  })

  console.log('[Boot] Knowbase main ready · net-v2 ·', app.getVersion())

  // 开发模式：F12 切换 DevTools（默认菜单已禁用）
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (!app.isPackaged && input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 一律不在应用内开新窗口;网页链接转交系统浏览器,其余(file:// 等)直接拒绝
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Window] did-fail-load:', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Window] render-process-gone:', details)
    ;(globalThis as any).__kbLogRendererGone?.(details)
  })
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error('[Renderer]', message, `(${sourceId}:${line})`)
    }
  })

  // 加载页面
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    // 主窗口真正关闭（托盘「退出」路径）→ 销毁任务栏窗口，让退出流程收尾
    disposeDayPanel()
  })

  // 托盘常驻：点 X = 隐藏到托盘（任务栏独立存活），不退出应用；真正退出走托盘菜单
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

// ===== 窗口控制 + 缩放 + 设置 IPC =====
function registerWindowHandlers(): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
    // WeChat 模式下小窗要么内嵌在主窗口、要么是独立顶层窗口；最小化主窗口时：
    //   - 内嵌态：随主窗口最小化（同一 BrowserWindow）
    //   - 独立态：保持可见（用户可能想让小窗单独常驻），不联动
  })
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // OS 级全屏（禅模式 Z2+）：覆盖系统任务栏，比最大化更彻底的沉浸。
  // 进入前记录窗口状态，退出时还原（最大化态 → 重新最大化，普通态 → 还原 bounds）
  let preFsMaximized = false
  let preFsBounds: Electron.Rectangle | null = null
  ipcMain.handle('window:set-fullscreen', (_e, flag: boolean) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (flag && !win.isFullScreen()) {
      preFsMaximized = win.isMaximized()
      preFsBounds = preFsMaximized ? null : win.getBounds()
      win.setFullScreen(true)
    } else if (!flag && win.isFullScreen()) {
      win.setFullScreen(false)
      if (preFsMaximized) {
        if (!win.isMaximized()) win.maximize()
      } else if (preFsBounds) {
        win.setBounds(preFsBounds)
      }
      preFsBounds = null
    }
  })
  mainWindow?.on('enter-full-screen', () => mainWindow?.webContents.send('window:fullscreenChange', true))
  mainWindow?.on('leave-full-screen', () => mainWindow?.webContents.send('window:fullscreenChange', false))

  // 抽屉式日程面板：renderer 发送「面板期望宽度」（0 = 收回），主进程以抽屉打开时刻的
  // 基准宽度为锚点计算窗口宽度。绝对值协议 —— 重复/乱序/HMR 重挂载的消息不会累积漂移。
  // 最大化/全屏时窗口由系统管理，自动跳过；右缘越界则整体左移夹回工作区。
  // animate = true 时窗口宽度缓动过渡（开合平滑展开/收回），拖拽调宽传 false 即时跟随。
  let drawerBaseWidth = 0 // 0 = 抽屉未开（收回动画 settle 时才清零，中途重开复用原基准）
  let drawerAnimTimer: ReturnType<typeof setInterval> | null = null
  const stopDrawerAnim = () => {
    if (drawerAnimTimer) { clearInterval(drawerAnimTimer); drawerAnimTimer = null }
  }
  /** 窗口 bounds 缓动过渡（easeOutCubic，约 200ms）；新请求到来或异常时中断，latest-wins */
  const animateWindowTo = (win: Electron.BrowserWindow, target: Electron.Rectangle, onSettle?: () => void) => {
    stopDrawerAnim()
    const start = win.getBounds()
    const t0 = performance.now()
    const duration = 200
    drawerAnimTimer = setInterval(() => {
      if (win.isDestroyed()) { stopDrawerAnim(); return }
      if (win.isMaximized() || win.isFullScreen()) { stopDrawerAnim(); onSettle?.(); return }
      const p = Math.min(1, (performance.now() - t0) / duration)
      const e = 1 - Math.pow(1 - p, 3)
      const w = Math.round(start.width + (target.width - start.width) * e)
      const x = Math.round(start.x + (target.x - start.x) * e)
      if (p >= 1) {
        stopDrawerAnim()
        win.setBounds({ x: target.x, y: target.y, width: target.width, height: target.height })
        onSettle?.()
        return
      }
      win.setBounds({ x, y: start.y, width: w, height: start.height })
    }, 16)
  }
  ipcMain.handle('window:resizeForSidebar', (_e, width: number, animate = false) => {
    const win = mainWindow
    if (!win || win.isDestroyed() || typeof width !== 'number' || !Number.isFinite(width)) {
      return { applied: false }
    }
    if (win.isMaximized() || win.isFullScreen()) return { applied: false, reason: 'maximized' }
    stopDrawerAnim()
    const b = win.getBounds()
    const { workArea } = screen.getDisplayMatching(b)

    // 收回：回到打开时刻的基准宽度
    if (width <= 0) {
      if (drawerBaseWidth === 0) return { applied: false }
      const base = drawerBaseWidth
      const w = Math.max(900, Math.min(workArea.width, base))
      if (w === b.width) {
        drawerBaseWidth = 0
        return { applied: false }
      }
      const target = { ...b, width: w }
      if (animate) animateWindowTo(win, target, () => { drawerBaseWidth = 0 })
      else { win.setBounds(target); drawerBaseWidth = 0 }
      return { applied: true, width: w }
    }

    // 打开/拖拽：基准 + 面板宽（首次打开时锁定基准，并夹回工作区防膨胀）。
    // 收回动画中途再次打开（HMR 重挂载/快速切换）：基准尚未清零，自动复用原基准重新锚定。
    if (drawerBaseWidth === 0) drawerBaseWidth = Math.min(b.width, workArea.width)
    const w = Math.max(900, Math.min(workArea.width, drawerBaseWidth + Math.round(width)))
    let x = b.x
    if (w > b.width && x + w > workArea.x + workArea.width) {
      x = Math.max(workArea.x, workArea.x + workArea.width - w)
    }
    const target = { x, y: b.y, width: w, height: b.height }
    if (target.width === b.width && target.x === b.x) return { applied: true, width: w }
    if (animate) animateWindowTo(win, target)
    else win.setBounds(target)
    return { applied: true, width: w }
  })

  // 窗口置顶（锁定）
  ipcMain.handle('window:setAlwaysOnTop', (_e, onTop: boolean) => {
    mainWindow?.setAlwaysOnTop(onTop)
    return mainWindow?.isAlwaysOnTop() ?? false
  })
  ipcMain.handle('window:isAlwaysOnTop', () => mainWindow?.isAlwaysOnTop() ?? false)
  ipcMain.handle('window:reload', () => { mainWindow?.webContents.reload() })

  mainWindow?.on('maximize', () => mainWindow?.webContents.send('window:maximizeChange', true))
  mainWindow?.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChange', false))

  // 缩放 — 仅缩放内容区（不缩放 chrome）


  // 设置持久化（内存缓存 + 防抖写盘）
  ipcMain.handle('settings:get', (_e, key: string) => {
    return settingsCache[key] ?? null
  })
  ipcMain.handle('settings:getAll', () => {
    return { ...settingsCache }
  })
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    // 键白名单 + 值类型校验:防止渲染层被注入后覆写任意配置(如 trashExportDir 指向系统目录)
    if (typeof key !== 'string' || !(key in SETTINGS)) return false
    const expected = typeof (SETTINGS as unknown as Record<string, { default: unknown }>)[key].default
    if (typeof value !== expected) return false
    // AI教学 P1（3-15）：aiTeachRootDir 改名 → 当前仓库旧根目录重命名迁移；
    // 失败（占用/权限）保留原文件夹并广播提示不阻塞，仅新名非法时回滚设置值
    if (key === 'aiTeachRootDir' && typeof value === 'string') {
      const raw = settingsCache[key]
      const prev = typeof raw === 'string' && raw ? raw : String((SETTINGS as unknown as Record<string, { default: unknown }>).aiTeachRootDir.default)
      if (prev !== value) {
        settingsCache[key] = value
        const r = migrateAiTeachRootDir(prev, value)
        if (!r.ok && r.error === '目录名不合法') { settingsCache[key] = prev; return false }
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(flushSettingsToDisk, 500)
        return true
      }
    }
    settingsCache[key] = value
    // Debounce write to disk — coalesce rapid setSetting calls into one write
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSettingsToDisk, 500)
    return true
  })

  // 清空所有数据（P7 对齐 D6）：已登记仓库整体进 OS 回收站（可还原，替代旧 rmSync 直删）+ 全局重置 → 回首启引导
  ipcMain.handle('db:clearAllData', async () => {
    try {
      const db = getDatabase()

      // 1) 全部已登记仓库 → 回收站并移除注册（护栏校验失败的仓库跳过并中止，绝不半途强删）
      const { trashed, errors } = await trashAllRegisteredVaults()
      console.log(`[clearAllData] 已送回收站 ${trashed} 个仓库${errors.length ? '；异常：' + errors.join('；') : ''}`)
      if (errors.length > 0 && trashed === 0) {
        return { success: false, error: errors[0] }
      }

      // 2) 回退 sqlite 残留表（老模块兜底）+ vault 注册清空（回首启引导重新选/建仓库）
      const tables = [
        'entries', 'tags', 'entry_tags',
        'schedule_todos', 'schedule_tags',
        'knowledge_categories', 'knowledge_pages', 'knowledge_links', 'knowledge_tags', 'knowledge_page_tags', 'knowledge_manual_links', 'knowledge_pack_imports',
        'recycle_bin', 'user_profile', 'toolbox_scripts', 'moments_posts', 'moments_albums', 'attachments',
        'blog_templates',
        'toolbox_passwords', 'toolbox_weight_records', 'pomodoro_sessions',
        'habits', 'habit_records',
        'bookmark_categories', 'bookmarks',
        'supervise_log', 'supervise_config',
        'plugin_audit_log', 'mcp_servers', 'agent_sessions', 'agent_messages',
      ]
      for (const t of tables) {
        db.run(`DROP TABLE IF EXISTS ${t}`)
      }
      // 仓库注册清空（回首启引导）+ 当前仓库内存态/持久化一并清
      try { db.run('DELETE FROM vaults'); saveToDisk() } catch { /* 旧库无 vaults 表 */ }
      setCurrentVault(null)

      // 3) settings 恢复默认
      settingsCache = {}
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      flushSettingsToDisk()

      // 4) 重建 sqlite schema（残留表结构，数据为空）
      //    必须先清 _migrations 记账：否则所有迁移被视为「已应用」而全部跳过，表建不回来（历史回归）
      try { db.run('DELETE FROM _migrations') } catch { /* 记账表可能不存在 */ }
      runMigrations()
      saveToDisk()
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message || String(err) }
    }
  })

  // 选择目录对话框
  ipcMain.handle('dialog:openDir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择回收站文件导出目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
  // Initialize settings cache once at startup
  settingsCache = loadSettingsFromDisk()

  // UI 插件页面协议:plugin://{id}/{file}
  // 安全:CSP 锁死网络(none),只允许插件自身源的内联资源;配合渲染层 iframe sandbox 使用
  const pluginDebugLog = (line: string) => {
    try { appendFileSync(join(app.getPath('userData'), 'plugin-debug.log'), new Date().toISOString().slice(11, 23) + ' ' + line + '\n') } catch { /* ignore */ }
  }
  protocol.handle('plugin', async (request) => {
    pluginDebugLog(`request: ${request.url}`)
    try {
      const url = new URL(request.url)
      const id = url.hostname
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '')
      if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || !rel) {
        pluginDebugLog(`400 校验失败 — hostname=${JSON.stringify(id)} rel=${JSON.stringify(rel)}`)
        return new Response('Bad Request', { status: 400 })
      }
      const dir = join(getPluginsRoot(), id)
      const resolved = resolve(dir, rel)
      if (!resolved.startsWith(dir.endsWith(sep) ? dir : dir + sep)) {
        pluginDebugLog(`403 越界 — resolved=${resolved}`)
        return new Response('Forbidden', { status: 403 })
      }
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        pluginDebugLog(`404 不存在 — resolved=${resolved}`)
        return new Response('Not Found', { status: 404 })
      }
      const ext = (resolved.match(/\.(\w+)$/)?.[1] || '').toLowerCase()
      const mimeMap: Record<string, string> = {
        html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
        json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
        jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', woff2: 'font/woff2', woff: 'font/woff',
      }
      return new Response(Readable.toWeb(createReadStream(resolved)) as unknown as BodyInit, {
        headers: {
          'Content-Type': mimeMap[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          // 插件页面专用 CSP:允许内联脚本/样式与同源自取,断网、禁嵌套、禁表单提交。
          // anims/(内容包分步动画播放器)额外放行 unsafe-eval —— manim-web/MathJax 运行时需要
          'Content-Security-Policy': (rel.startsWith('anims/')
            ? "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' plugin:; style-src 'unsafe-inline' plugin:; img-src data: plugin: blob:; font-src data: plugin:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
            : "default-src 'none'; script-src 'unsafe-inline' plugin:; style-src 'unsafe-inline' plugin:; img-src data: plugin:; font-src data: plugin:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"),
        },
      })
    } catch (e) {
      pluginDebugLog(`handler 异常: ${e}`)
      console.error('[plugin://] handler 异常:', request.url, e)
      return new Response('Bad Request', { status: 400 })
    }
  })

  protocol.handle('attachment', async (request) => {
    try {
      const url = new URL(request.url)
      // vault 分支：attachment://vault/<pageId>/<file> —— 页面/仓库移动均不断链
      // （主进程每次按「当前仓库」动态定位，新落盘 .attachments/knowledge_page/<pageId>/<file>，
      //   旧包兼容读取 .knowbase/_attachments/knowledge_page/<pageId>/<file>）
      if (url.hostname === 'vault') {
        const { getCurrentVault } = await import('../lib/kbStore/vaultContext')
        const cur = getCurrentVault()
        if (!cur) return new Response('Not Found', { status: 404 })
        const segs = url.pathname.split('/').filter(Boolean)
        if (segs.length !== 2) return new Response('Not Found', { status: 404 })
        const [pageId, rawFile] = segs
        const file = decodeURIComponent(rawFile)
        // 严格白名单防路径穿越：pageId=UUID；file=文件名（无分隔符、无 ..）
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId)) return new Response('Not Found', { status: 404 })
        if (!/^[A-Za-z0-9._\u4e00-\u9fa5-]{1,160}$/.test(file)) return new Response('Not Found', { status: 404 })
        const candidates = [
          join(cur.rootPath, '.attachments', 'knowledge_page', pageId, file),
          join(cur.rootPath, '.knowbase', '_attachments', 'knowledge_page', pageId, file),
        ]
        const p = candidates.find((c) => existsSync(c))
        if (!p) return new Response('Not Found', { status: 404 })
        const ext = (file.match(/\.(\w+)$/)?.[1] || '').toLowerCase()
        const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json' }
        return new Response(Readable.toWeb(createReadStream(p)) as unknown as BodyInit, {
          headers: { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
        })
      }
      const id = url.hostname
      const thumb = url.searchParams.get('thumb') === '1'
      const p = getAttachmentFilePath(id, thumb)
      if (!p) return new Response('Not Found', { status: 404 })
      const ext = (p.match(/\.(\w+)$/)?.[1] || '').toLowerCase()
        const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json' }
      return new Response(Readable.toWeb(createReadStream(p)) as unknown as BodyInit, {
        headers: { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
      })
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
  })

  ipcMain.handle('db:getPath', () => getDbPath())
  ipcMain.handle('app:getAttachmentsPath', () => getAttachmentsDir())
  // 复制图片到系统剪贴板（path 或 dataUrl），供粘贴到其他程序
  // 剪贴板条件清空:仅当剪贴板内容仍为所复制的密码时才清空,不覆盖用户后续复制的内容
  ipcMain.handle('clipboard:clearIfEqual', (_e, text: string) => {
    try { if (typeof text === 'string' && text && clipboard.readText() === text) clipboard.writeText('') } catch { /* ignore */ }
    return true
  })
  // 通用文本复制（AI 消息复制等）；限制单次 1MB 防滥用
  ipcMain.handle('clipboard:writeText', (_e, text: string) => {
    try {
      if (typeof text !== 'string' || text.length > 1024 * 1024) return false
      clipboard.writeText(text)
      return true
    } catch { return false }
  })
  ipcMain.handle('clipboard:copyImage', (_e, src: { path?: string; dataUrl?: string }) => {
    try {
      let img: Electron.NativeImage | null = null
      if (src?.dataUrl) {
        img = nativeImage.createFromDataURL(src.dataUrl)
      } else if (src?.path && existsSync(src.path)) {
        // 用 Node fs 读字节再转 data URL：nativeImage.createFromPath 对含中文路径可能失败
        const buf = readFileSync(src.path)
        const ext = (src.path.match(/\.(\w+)$/)?.[1] || '').toLowerCase()
        const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' }
        img = nativeImage.createFromDataURL(`data:${mimeMap[ext] || 'image/png'};base64,${buf.toString('base64')}`)
      }
      if (!img || img.isEmpty()) return false
      clipboard.writeImage(img)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('app:openExternal', async (_e, target: string) => {
    if (typeof target !== 'string' || !target) return
    // 网页链接 → 系统浏览器(仅 http/https,拒绝 file:/自定义协议)
    if (/^https?:\/\//i.test(target)) {
      await shell.openExternal(target)
      return
    }
    // 本地路径 → 仅允许打开应用数据目录内的文件(附件等);UNC/任意盘符路径一律拒绝
    const resolved = resolve(target)
    const userDataRoot = resolve(app.getPath('userData'))
    const rootWithSep = userDataRoot.endsWith(sep) ? userDataRoot : userDataRoot + sep
    if (resolved.startsWith(rootWithSep) && existsSync(resolved)) {
      await shell.openPath(resolved)
    } else {
      console.warn('[Security] 拒绝打开数据目录外的路径:', target)
    }
  })
  await initDatabase()
  // 番茄钟状态跨窗口中转：主进程维护快照，渲染层上报 + 接收广播（让 popout 独立窗口也能显示番茄钟状态）
  registerPomodoroBroadcast()
  // AI 测试桥(构建期由 __DEV_BRIDGE__ 消除, 运行期再以 app.isPackaged 兜底)。
  // installCapture 同步安装采集, 必须早于下方各 Repository 注册 handler,
  // 否则 IPC 追踪一个通道都覆盖不到; HTTP 服务改为异步启动, 不阻塞启动流程。
  if (__DEV_BRIDGE__ && !app.isPackaged) {
    const bridge = await import('../devbridge')
    bridge.installCapture()
    void bridge.startBridge({
      getMainWindow: () => mainWindow,
      getSettingValue: (key) => settingsCache[key],
    })
  }
  registerWindowHandlers()
  registerRepoConfigHandlers()
  // 去库化数据源（storageData）：结构化 repo 每次调用按当前设置动态判定
  bindDataSourceGetter((key) => settingsCache[key])
  registerEntryHandlers((key) => settingsCache[key])
  registerTagHandlers((key) => settingsCache[key])
  registerScheduleHandlers()
  registerKnowledgeHandlers((key) => settingsCache[key])
  registerVaultMigrationHandlers()
  registerExportHandlers()
  registerRecycleBinHandlers()
  registerImportHandlers((key) => settingsCache[key])
  registerUserHandlers()
  registerToolboxHandlers()
  registerPasswordHandlers()
  registerMomentsHandlers()
  registerAttachmentHandlers()
  registerBackupHandlers()
  registerVaultBackupHandlers()
  registerWeightHandlers()
  registerCheckinHandlers()
  registerBookmarkHandlers((key) => settingsCache[key])
  registerSuperviseHandlers()
  registerSummaryHandlers()
  registerBlogTemplateHandlers((key) => settingsCache[key])
  registerQuizHandlers({ getSettingValue: (key) => settingsCache[key] })
  // 开发者工具(内部对 app.isPackaged 自行守卫,打包版不注册任何 handler)
  registerDevtoolsHandlers()
  registerUpdateHandlers({ getSettingValue: (key) => settingsCache[key] })
  // 设备传输：局域网短时双向互传（工具箱）
  registerLanShareHandlers()
  // 编辑器工作区（Vault 仓库）：文件服务 + 授权根管理
  registerWorkspaceHandlers()
  // 整仓归档：导出 zip / 导入（剥壳→校验→冲突逐条决策→登记重建，P6）
  registerVaultArchiveHandlers()
  registerPluginHandlers({ getSettingValue: (key) => settingsCache[key] })
  // AI 工具注册表（M1 地基）：内置只读工具 + 审计 + 月度调用上限
  registerAiToolHandlers({ getSettingValue: (key) => settingsCache[key] })
  registerBuiltinTools()
  // MCP 外部服务器管理面（M2）
  registerMcpHandlers()
  // Skill 提示词资产（M3）：聚合插件贡献并登记进注册表（停用状态读写走设置）
  {
    const getSettingValue = (key: string) => settingsCache[key]
    const setSettingValue = (key: string, value: unknown) => {
      if (typeof key !== 'string' || !(key in SETTINGS)) return false
      if (typeof value !== typeof (SETTINGS as unknown as Record<string, { default: unknown }>)[key].default) return false
      settingsCache[key] = value
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(flushSettingsToDisk, 500)
      return true
    }
    registerSkillHandlers({ getSettingValue, setSettingValue })
  }
  // 模型网关 + 最小 Agent 循环
  {
    const getSettingValue = (key: string) => settingsCache[key]
    const setSettingValue = (key: string, value: unknown) => {
      if (typeof key !== 'string' || !(key in SETTINGS)) return false
      if (typeof value !== typeof (SETTINGS as unknown as Record<string, { default: unknown }>)[key].default) return false
      settingsCache[key] = value
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(flushSettingsToDisk, 500)
      return true
    }
    registerLlmHandlers({ getSettingValue, setSettingValue })
    registerAgentHandlers()
    // AI教学 P1：会话 ⇄ 文件夹绑定（aiTeach:* IPC，总纲 §二）
    registerAiTeachingFolderHandlers((key) => settingsCache[key])
    // AI教学 P5：工作区两层（元数据 .knowbase/modules/aiTeaching/workspaces.json，§3.2-6/3-6）
    registerAiTeachingWorkspaceHandlers((key) => settingsCache[key])
    // AI教学 P6：素材库（SOURCES/{对话夹}/SOURCE.md 登记+区间提取，§3.13 结构 v3）
    registerAiTeachingSourceHandlers((key) => settingsCache[key])
    // 划词翻译:离线词典 + LLM 翻译/AI 精讲
    registerTranslateHandlers()
    // 单词本:生词本 + 每日队列 SRS + 词书
    registerWordbookHandlers({ getSettingValue: (key) => settingsCache[key], setSettingValue })
    // PDF 工具箱:合并/页面重组/导出
    registerPdfHandlers()
    // 文档读取（界面阅读 PPT 等）
    registerDocsReadHandlers()
  }

  ipcMain.handle('app:getVersion', () => app.getVersion())

  // 启动自测:验证 plugin:// 管线(仅内置插件存在时),结果写 userData/plugin-debug.log
  {
    const builtinDirDev = join(app.getAppPath(), 'resources', 'builtin-plugins')
    const builtinDir = app.isPackaged ? join(process.resourcesPath, 'builtin-plugins') : builtinDirDev
    try {
      if (existsSync(builtinDir)) {
        const first = readdirSync(builtinDir, { withFileTypes: true }).find(d => d.isDirectory())
        if (first) {
          // 注意:插件 id 以 manifest 为准,可能与目录名不同
          let manifestId = first.name
          try {
            const mf = JSON.parse(readFileSync(join(builtinDir, first.name, 'plugin.json'), 'utf-8'))
            if (typeof mf.id === 'string' && mf.id) manifestId = mf.id
          } catch { /* 用目录名兜底 */ }
          const testUrl = `plugin://${manifestId}/index.html`
          pluginDebugLog(`自测开始: ${testUrl}`)
          net.fetch(testUrl)
            .then(async r => {
              const body = r.ok ? await r.text() : ''
              pluginDebugLog(`自测结果: HTTP ${r.status}${r.ok ? `, body ${body.length} bytes, head=${JSON.stringify(body.slice(0, 50))}` : ''}`)
              console.log(`[plugin://] 自测: ${manifestId}/index.html → HTTP ${r.status}`)
            })
            .catch(e => { pluginDebugLog(`自测失败: ${e}`); console.error('[plugin://] 自测失败:', e) })
        }
      } else {
        pluginDebugLog(`自测跳过: builtin 目录不存在 ${builtinDir}`)
      }
    } catch (e) { pluginDebugLog(`自测初始化异常: ${e}`) }
  }

  createWindow()

  // 远程监督：每日汇总定时器 + 免打扰补发
  startSuperviseScheduler()

  // MCP：恢复上次启用状态的外部服务器连接（异步，不阻断首帧）
  void restoreMcpConnections().catch((e) => console.warn('[MCP] 启动恢复连接异常（不阻断）:', (e as Error)?.message || e))

  // Init password auto-fill popup (global shortcut)
  initPasswordFiller()

  // 跨窗口数据变更总线（data:notify → kb:data-changed），先于任何窗口能力注册
  registerWindowBus()

  // 日程与打卡侧边栏（WeChat 模式：内嵌 + 可脱离；桌面互动模式见 dayPanelWindow.ts）
  initDayPanel({
    getMainWindow: () => mainWindow,
    rendererUrl: () => process.env.ELECTRON_RENDERER_URL ?? null,
    getSetting: (key) => settingsCache[key],
    setSetting: (key, value) => {
      settingsCache[key] = value
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(flushSettingsToDisk, 500)
    },
  })

  createTray()

  // Web 剪藏服务（工具箱「网页剪藏」入口的数据面；127.0.0.1 常驻，随应用启停）
  registerClipperHandlers({
    getSetting: (key) => settingsCache[key],
    setSetting: (key, value) => {
      settingsCache[key] = value
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(flushSettingsToDisk, 500)
      return true
    },
  })
  startClipperServer()

  app.on('activate', () => {
    // macOS: 点击 dock 图标时重建窗口
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 用户尝试打开第二个实例 → 激活已有窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    // 托盘常驻下窗口可能处于 hide() 状态：focus() 对隐藏窗口无效，必须 show()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  // 托盘常驻：主窗口隐藏（未销毁）时不会走到这里；真到全窗口关闭时，
  // 若还在托盘常驻期（未触发退出）则保持后台（任务栏 popout 可能存活），否则退出
  if (isQuitting) {
    if (process.platform !== 'darwin') app.quit()
  } else if (!tray && !isPopoutOpen()) {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  tray?.destroy()
  tray = null
  destroyPasswordFiller()
  stopSuperviseScheduler()
  disposeDayPanel()
  stopClipperServer()
  // Flush pending settings writes
  if (saveTimer) { clearTimeout(saveTimer); flushSettingsToDisk() }
  closeDatabase()
})

// 安全：禁止 webview
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, _wp, _params) => _ev.preventDefault())
})

// dev-watch tick 180146

// dev-watch tick 180459
