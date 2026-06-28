import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { initDatabase, getDatabase, getDbPath, closeDatabase, getAttachmentsDir, runMigrations, saveToDisk } from '../database/connection'
import { registerEntryHandlers } from '../database/repositories/entryRepo'
import { registerTagHandlers } from '../database/repositories/tagRepo'
import { registerScheduleHandlers } from '../database/repositories/scheduleRepo'
import { registerKnowledgeHandlers } from '../database/repositories/knowledgeRepo'
import { registerExportHandlers } from '../database/repositories/exportRepo'
import { registerRecycleBinHandlers } from '../database/repositories/recycleBinRepo'
import { registerImportHandlers } from '../database/repositories/importRepo'
import { registerUserHandlers } from '../database/repositories/userRepo'
import { registerToolboxHandlers } from '../database/repositories/toolboxRepo'
import { registerAIHandlers } from '../ai/aiHandler'

// ===== Settings memory cache =====
const settingsPath = join(app.getPath('userData'), 'settings.json')
let settingsCache: Record<string, unknown> = {}
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadSettingsFromDisk(): Record<string, unknown> {
  try { return existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : {} }
  catch { return {} }
}

function flushSettingsToDisk(): void {
  saveTimer = null
  try { writeFileSync(settingsPath, JSON.stringify(settingsCache, null, 2)) }
  catch (err) { console.error('Failed to persist settings:', err) }
}

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
    title: 'Knowbase',
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
    settingsCache[key] = value
    // Debounce write to disk — coalesce rapid setSetting calls into one write
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSettingsToDisk, 500)
  })

  // 清空所有数据 + 恢复默认设置
  ipcMain.handle('db:clearAllData', () => {
    try {
      const db = getDatabase()

      // Drop all user data tables
      const tables = [
        'entries', 'tags', 'entry_tags',
        'schedule_todos', 'schedule_tags',
        'knowledge_categories', 'knowledge_pages', 'knowledge_links', 'knowledge_tags', 'knowledge_page_tags',
        'recycle_bin', 'user_profile', 'toolbox_scripts',
      ]
      for (const t of tables) {
        db.run(`DROP TABLE IF EXISTS ${t}`)
      }
      // Clear migration records so schema is re-created fresh
      db.run('DELETE FROM _migrations')

      // Wipe settings to defaults
      settingsCache = {}
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      flushSettingsToDisk()

      // Re-create all tables from scratch
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

  ipcMain.handle('db:getPath', () => getDbPath())
  ipcMain.handle('app:getAttachmentsPath', () => getAttachmentsDir())
  ipcMain.handle('app:openExternal', async (_e, filePath: string) => {
    await shell.openPath(filePath)
  })
  await initDatabase()
  registerWindowHandlers()
  registerEntryHandlers()
  registerTagHandlers()
  registerScheduleHandlers()
  registerKnowledgeHandlers()
  registerExportHandlers()
  registerRecycleBinHandlers()
  registerImportHandlers()
  registerUserHandlers()
  registerToolboxHandlers()
  registerAIHandlers()

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

app.on('before-quit', () => {
  // Flush pending settings writes
  if (saveTimer) { clearTimeout(saveTimer); flushSettingsToDisk() }
  closeDatabase()
})

// 安全：禁止 webview
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, _wp, _params) => _ev.preventDefault())
})
