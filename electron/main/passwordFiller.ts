import { BrowserWindow, globalShortcut, screen, clipboard, app, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { spawn } from 'child_process'
import { getDatabase } from '../database/connection'

let fillWindow: BrowserWindow | null = null
let fillInProgress = false // guard against blur during programmatic hide

function getSettingsJSON(): Record<string, unknown> {
  try {
    const sp = join(app.getPath('userData'), 'settings.json')
    if (existsSync(sp)) return JSON.parse(readFileSync(sp, 'utf-8'))
  } catch { /* */ }
  return {}
}

// --------------- auto-fill ---------------

function spawnPS(script: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('powershell', [
      '-WindowStyle', 'Hidden', '-NoProfile', '-Command', script
    ], { windowsHide: true, stdio: 'ignore' })
    child.on('close', resolve)
    child.on('error', (err) => { console.error('[fillPopup] spawn error:', err.message); resolve() })
  })
}

async function doFill(data: { account?: string; username?: string; password: string; mode: 'all' | 'passwordOnly' }) {
  const saved = clipboard.readText()
  const account = (data.mode === 'all' && (data.account || data.username))
    ? (data.account || data.username || '')
    : ''

  // Hide window immediately so focus returns to target app
  fillInProgress = true
  if (fillWindow && !fillWindow.isDestroyed()) fillWindow.hide()

  if (account) {
    // Pre-write account to clipboard, spawn PS that sleeps then types
    clipboard.writeText(account)
    const p1 = spawnPS(
      'Start-Sleep -Milliseconds 250;' +
      'Add-Type -AssemblyName System.Windows.Forms;' +
      "[System.Windows.Forms.SendKeys]::SendWait('^v');" +
      'Start-Sleep -Milliseconds 60;' +
      "[System.Windows.Forms.SendKeys]::SendWait('{TAB}')"
    )
    // While PS is sleeping, immediately swap clipboard to password
    await new Promise(r => setTimeout(r, 50))
    clipboard.writeText(data.password)
    await p1
    // Type password
    await spawnPS(
      'Add-Type -AssemblyName System.Windows.Forms;' +
      "[System.Windows.Forms.SendKeys]::SendWait('^v')"
    )
  } else {
    clipboard.writeText(data.password)
    await spawnPS(
      'Start-Sleep -Milliseconds 250;' +
      'Add-Type -AssemblyName System.Windows.Forms;' +
      "[System.Windows.Forms.SendKeys]::SendWait('^v')"
    )
  }

  // Restore clipboard
  await new Promise(r => setTimeout(r, 500))
  const current = clipboard.readText()
  if (current === data.password || current === account) clipboard.writeText(saved)
  fillInProgress = false
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
      sandbox: false, contextIsolation: true, nodeIntegration: false,
      additionalArguments: ['--fill-popup-window', `--theme=${theme}`],
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/fill-popup`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Blur = user clicked outside → hide (unless fill is in progress)
  win.on('blur', () => {
    if (!fillInProgress && win && !win.isDestroyed()) win.hide()
  })

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
  fillWindow.show()
  fillWindow.focus()
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
      username: r.username || '', password: r.password, notes: r.notes || '',
      sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at
    }))
  })

  ipcMain.handle('fillPopup:fill', async (_e, data: any) => { await doFill(data) })
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
