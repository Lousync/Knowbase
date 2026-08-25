import { app, BrowserWindow, dialog, ipcMain, shell, protocol, clipboard, nativeImage, Menu, net } from 'electron'
import { join, basename, resolve, sep } from 'path'
import { readFileSync, writeFileSync, existsSync, createReadStream, cpSync, mkdirSync, statSync, readdirSync, appendFileSync } from 'fs'
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
import { registerUpdateHandlers } from '../lib/updateService'
import { registerPluginHandlers, getPluginsRoot } from '../lib/pluginRegistry'
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

// ===== Settings memory cache =====
// 禁用 Electron 默认应用菜单：其 View 角色绑定了 Ctrl+R / Ctrl+Shift+R（强制刷新）
// / F11 等全局加速键，会在用户操作时整页重载回启动模块。应用自定义快捷键见各模块。
Menu.setApplicationMenu(null)
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
      sandbox: true,                         // preload 仅用 contextBridge/ipcRenderer/webUtils,完全兼容沙箱
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 安全：主窗口自身永不导航(应用为单页,任何导航请求均为异常/注入行为)
  mainWindow.webContents.on('will-navigate', (event) => {
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
    // 键白名单 + 值类型校验:防止渲染层被注入后覆写任意配置(如 trashExportDir 指向系统目录)
    if (typeof key !== 'string' || !(key in SETTINGS)) return false
    const expected = typeof (SETTINGS as unknown as Record<string, { default: unknown }>)[key].default
    if (typeof value !== expected) return false
    settingsCache[key] = value
    // Debounce write to disk — coalesce rapid setSetting calls into one write
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSettingsToDisk, 500)
    return true
  })

  // 清空所有数据 + 恢复默认设置
  ipcMain.handle('db:clearAllData', () => {
    try {
      const db = getDatabase()

      // Drop all user data tables
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
          // 插件页面专用 CSP:允许内联脚本/样式与同源自取,断网、禁嵌套、禁表单提交
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline' plugin:; style-src 'unsafe-inline' plugin:; img-src data: plugin:; font-src data: plugin:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
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
  registerUpdateHandlers()
  registerPluginHandlers()

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

// dev-watch tick 180146

// dev-watch tick 180459
