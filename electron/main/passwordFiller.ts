import { BrowserWindow, globalShortcut, screen, clipboard, app, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { getDatabase } from '../database/connection'
import { decryptPassword } from '../database/repositories/passwordRepo'

let fillWindow: BrowserWindow | null = null

function getSettingsJSON(): Record<string, unknown> {
  try {
    const sp = join(app.getPath('userData'), 'settings.json')
    if (existsSync(sp)) return JSON.parse(readFileSync(sp, 'utf-8'))
  } catch { /* */ }
  return {}
}

// --------------- floating window ---------------

function createFillWindow(): BrowserWindow {
  const theme = String(getSettingsJSON().theme || 'dark')
  const bgColor = theme === 'light' ? '#f3f3f3' : '#1e1e1e'

  const win = new BrowserWindow({
    width: 340, height: 420,
    frame: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    resizable: false, maximizable: false, minimizable: false,
    backgroundColor: bgColor,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      additionalArguments: ['--fill-popup-window', `--theme=${theme}`],
    },
  })

  // Never steal focus — user stays in their target app
  win.setAlwaysOnTop(true, 'floating')

  // 与主窗口同级的导航防护:悬浮窗自身永不导航、永不开新窗口
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/fill-popup`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function showFillPopup() {
  if (!fillWindow || fillWindow.isDestroyed()) {
    fillWindow = createFillWindow()
  }

  const cursor = screen.getCursorScreenPoint()
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  let x = cursor.x + 10, y = cursor.y + 10
  if (x + 340 > width) x = width - 350
  if (y + 420 > height) y = cursor.y - 430

  fillWindow.setPosition(x, y)
  fillWindow.showInactive() // show but don't steal focus
  fillWindow.webContents.send('fillPopup:refresh')
}

// --------------- export ---------------

export function initPasswordFiller() {
  ipcMain.handle('fillPopup:getEntries', () => {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM toolbox_passwords ORDER BY sort_order, updated_at DESC')
    const rows: any[] = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows.map((r: any) => ({
      id: r.id, title: r.title, url: r.url || '', account: r.account || '',
      username: r.username || '', password: decryptPassword(r.password), notes: r.notes || '',
      sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at
    }))
  })

  // Copy to clipboard — 30 秒后若剪贴板仍是所复制的密码则自动清空(不覆盖用户后续复制的内容)
  let clipboardClearTimer: NodeJS.Timeout | null = null
  ipcMain.handle('fillPopup:copy', (_e, field: string, value: string) => {
    clipboard.writeText(value)
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer)
    clipboardClearTimer = setTimeout(() => {
      clipboardClearTimer = null
      try { if (clipboard.readText() === value) clipboard.writeText('') } catch { /* ignore */ }
    }, 30_000)
    console.log(`[PasswordFiller] copied ${field}`)
  })

  ipcMain.handle('fillPopup:hide', () => {
    if (fillWindow && !fillWindow.isDestroyed()) fillWindow.hide()
  })

  const settings = getSettingsJSON()
  const shortcutKey = (settings.fillPopupShortcut as string) || 'Ctrl+Alt+P'

  try {
    globalShortcut.register(shortcutKey, () => {
      if (fillWindow && fillWindow.isVisible() && !fillWindow.isDestroyed()) {
        fillWindow.hide()
      } else {
        showFillPopup()
      }
    })
    console.log(`[PasswordFiller] Global shortcut registered: ${shortcutKey}`)
  } catch (e) {
    console.error(`[PasswordFiller] Failed to register shortcut "${shortcutKey}":`, e)
  }
}

export function destroyPasswordFiller() {
  globalShortcut.unregisterAll()
  if (fillWindow && !fillWindow.isDestroyed()) { fillWindow.close(); fillWindow = null }
}
