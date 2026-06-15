import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { initDatabase, getDbPath, closeDatabase } from '../database/connection'
import { registerEntryHandlers } from '../database/repositories/entryRepo'
import { registerTagHandlers } from '../database/repositories/tagRepo'
import { registerScheduleHandlers } from '../database/repositories/scheduleRepo'
import { registerKnowledgeHandlers } from '../database/repositories/knowledgeRepo'
import { registerExportHandlers } from '../database/repositories/exportRepo'
import { registerRecycleBinHandlers } from '../database/repositories/recycleBinRepo'
import { registerImportHandlers } from '../database/repositories/importRepo'

// 单实例锁 — 防止多窗口数据不同步（sql.js 内存数据库无跨进程共享能力）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'KnowledgeRecorder',
    frame: false,                          // 无边框 → 自定义标题栏
    titleBarStyle: 'hidden',              // macOS 隐藏原生标题栏
    backgroundColor: '#1e1e1e',           // 深色背景，防启动白屏
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 安全：限制导航为本地文件
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 加载页面
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ===== 窗口控制 + 缩放 + 设置 IPC =====
function registerWindowHandlers(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // 窗口置顶（锁定）
  ipcMain.handle('window:setAlwaysOnTop', (_e, onTop: boolean) => {
    mainWindow?.setAlwaysOnTop(onTop)
    return mainWindow?.isAlwaysOnTop() ?? false
  })
  ipcMain.handle('window:isAlwaysOnTop', () => mainWindow?.isAlwaysOnTop() ?? false)

  mainWindow?.on('maximize', () => mainWindow?.webContents.send('window:maximizeChange', true))
  mainWindow?.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChange', false))

  // 缩放 — 仅缩放内容区（不缩放 chrome）


  // 设置持久化（存 JSON 文件）
  const { readFileSync, writeFileSync, existsSync } = require('fs')
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  function loadSettings(): Record<string, unknown> {
    try { return existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : {} }
    catch { return {} }
  }
  function saveSettings(s: Record<string, unknown>) { writeFileSync(settingsPath, JSON.stringify(s, null, 2)) }

  ipcMain.handle('settings:get', (_e, key: string) => {
    const s = loadSettings(); return s[key] ?? null
  })
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    const s = loadSettings(); s[key] = value; saveSettings(s)
  })
}

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
  ipcMain.handle('db:getPath', () => getDbPath())
  await initDatabase()
  registerWindowHandlers()
  registerEntryHandlers()
  registerTagHandlers()
  registerScheduleHandlers()
  registerKnowledgeHandlers()
  registerExportHandlers()
  registerRecycleBinHandlers()
  registerImportHandlers()
  createWindow()

  app.on('activate', () => {
    // macOS: 点击 dock 图标时重建窗口
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 用户尝试打开第二个实例 → 激活已有窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => closeDatabase())

// 安全：禁止 webview
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, _wp, _params) => _ev.preventDefault())
})
