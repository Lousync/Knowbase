import { app, BrowserWindow, dialog, ipcMain, shell, protocol, clipboard, nativeImage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, createReadStream, cpSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
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
import { registerPasswordHandlers } from '../database/repositories/passwordRepo'
import { registerMomentsHandlers } from '../database/repositories/momentsRepo'
import { registerAttachmentHandlers, getAttachmentFilePath } from '../database/repositories/attachmentRepo'
import { registerBackupHandlers } from '../database/repositories/backupRepo'
import { registerWeightHandlers } from '../database/repositories/weightRepo'
import { registerCheckinHandlers } from '../database/repositories/checkinRepo'
import { registerBookmarkHandlers } from '../database/repositories/bookmarkRepo'
import { registerSuperviseHandlers } from '../database/repositories/superviseRepo'
import { registerSummaryHandlers } from '../database/repositories/summaryRepo'
import { registerBlogTemplateHandlers } from '../database/repositories/blogTemplateRepo'
import { startSuperviseScheduler, stopSuperviseScheduler } from '../lib/pushService'
import { initPasswordFiller, destroyPasswordFiller } from './passwordFiller'

// 附件自定义协议：attachment://{id}/ 与 attachment://{id}/?thumb=1
protocol.registerSchemesAsPrivileged([
  { scheme: 'attachment', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// ===== 数据隔离：开发版（npm run dev）使用独立 userData 目录 =====
// 已安装版用默认 %APPDATA%/knowbase，开发版用 %APPDATA%/knowbase (dev)。
// 必须在任何模块读取 userData 路径之前执行（下方 settingsPath 是第一个消费者），
// 且在 requestSingleInstanceLock 之前——这样开发版与已安装版可同时运行互不抢锁。
// 首次运行开发版时从共享目录快照一份现有数据（跳过易锁死的缓存目录）；
// 迁移失败或想重新迁移：删除「xxx (dev)」目录即可。设置 KNOWBASE_SHARED_DATA=1 可强制共用数据。
if (!app.isPackaged && process.env.KNOWBASE_SHARED_DATA !== '1') {
  const sharedDir = app.getPath('userData')
  const devDir = `${sharedDir} (dev)`
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

// 允许打包后 file:// 环境下加载本地 module worker（pdf.js 阅读器需要）
app.commandLine.appendSwitch('allow-file-access-from-files')

// 单实例锁 — 防止多窗口数据不同步（sql.js 内存数据库无跨进程共享能力）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  console.log('[Window] ELECTRON_RENDERER_URL =', process.env.ELECTRON_RENDERER_URL || '(empty)')
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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Window] did-fail-load:', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Window] render-process-gone:', details)
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
        'recycle_bin', 'user_profile', 'toolbox_scripts', 'moments_posts', 'moments_albums', 'attachments',
        'blog_templates',
        'toolbox_passwords', 'toolbox_weight_records', 'pomodoro_sessions',
        'habits', 'habit_records',
        'bookmark_categories', 'bookmarks',
        'supervise_log', 'supervise_config',
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

  protocol.handle('attachment', async (request) => {
    try {
      const url = new URL(request.url)
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
  registerPasswordHandlers()
  registerMomentsHandlers()
  registerAttachmentHandlers()
  registerBackupHandlers()
  registerWeightHandlers()
  registerCheckinHandlers()
  registerBookmarkHandlers()
  registerSuperviseHandlers()
  registerSummaryHandlers()
  registerBlogTemplateHandlers()

  createWindow()

  // 远程监督：每日汇总定时器 + 免打扰补发
  startSuperviseScheduler()

  // Init password auto-fill popup (global shortcut)
  initPasswordFiller()

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
  destroyPasswordFiller()
  stopSuperviseScheduler()
  // Flush pending settings writes
  if (saveTimer) { clearTimeout(saveTimer); flushSettingsToDisk() }
  closeDatabase()
})

// 安全：禁止 webview
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, _wp, _params) => _ev.preventDefault())
})
