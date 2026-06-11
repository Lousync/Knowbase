import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { initDatabase, getDbPath, closeDatabase } from '../database/connection'
import { registerEntryHandlers } from '../database/repositories/entryRepo'
import { registerTagHandlers } from '../database/repositories/tagRepo'

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

// ===== 窗口控制 IPC =====
function registerWindowHandlers(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // 窗口最大化变化时通知渲染进程
  mainWindow?.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizeChange', true)
  })
  mainWindow?.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizeChange', false)
  })
}

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
  ipcMain.handle('db:getPath', () => getDbPath())
  await initDatabase()
  registerWindowHandlers()
  registerEntryHandlers()
  registerTagHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => closeDatabase())

// 安全：禁止 webview
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, _wp, _params) => _ev.preventDefault())
})
