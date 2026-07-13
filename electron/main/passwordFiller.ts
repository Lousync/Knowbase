import { BrowserWindow, globalShortcut, screen, clipboard, app, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { exec } from 'child_process'
import { getDatabase } from '../database/connection'

let fillWindow: BrowserWindow | null = null

function getPasswordEntries(): unknown[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM toolbox_passwords ORDER BY sort_order, updated_at DESC')
  const rows: unknown[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows.map((r: any) => ({
    id: r.id, title: r.title, url: r.url || '', account: r.account || '',
    username: r.username || '', password: r.password, notes: r.notes || '',
    sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at
  }))
}

// --------------- auto-fill via clipboard + PowerShell SendKeys ---------------

function powershellSendKeys(keys: string): Promise<void> {
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')"`,
      (err: Error | null) => { if (err) console.error('[fillPopup] SendKeys error:', err.message); resolve() }
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function doFill(data: { account?: string; username?: string; password: string; mode: 'all' | 'passwordOnly' }) {
  const saved = clipboard.readText()

  // Hide the popup first so focus returns to target app
  if (fillWindow) fillWindow.hide()

  // Wait for focus transition
  await sleep(200)

  if (data.mode === 'all' && (data.account || data.username)) {
    // Fill account/username
    const text = data.account || data.username || ''
    clipboard.writeText(text)
    await powershellSendKeys('^v') // Ctrl+V
    await sleep(80)
    await powershellSendKeys('{TAB}') // Tab to password field
    await sleep(80)
  }

  // Fill password
  clipboard.writeText(data.password)
  await powershellSendKeys('^v')

  // Restore clipboard after a delay
  await sleep(500)
  // Only restore if clipboard still contains our password (user hasn't copied something else)
  const current = clipboard.readText()
  if (current === data.password) {
    clipboard.writeText(saved)
  }
}

// --------------- floating window ---------------

function createFillWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 420,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    transparent: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      additionalArguments: ['--fill-popup-window'],
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/fill-popup`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/fill-popup' })
  }

  // Hide on blur (user clicked outside)
  win.on('blur', () => {
    if (win && !win.isDestroyed()) win.hide()
  })

  return win
}

function showFillPopup() {
  if (!fillWindow || fillWindow.isDestroyed()) {
    fillWindow = createFillWindow()
  }

  const cursor = screen.getCursorScreenPoint()
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  // Position near cursor, clamped to screen edges
  let x = cursor.x + 10
  let y = cursor.y + 10
  if (x + 340 > width) x = width - 350
  if (y + 420 > height) y = cursor.y - 430

  fillWindow.setPosition(x, y)
  fillWindow.show()
  fillWindow.focus()
  fillWindow.webContents.send('fillPopup:refresh')
}

// --------------- export ---------------

export function initPasswordFiller() {
  // IPC: get entries for popup
  ipcMain.handle('fillPopup:getEntries', () => getPasswordEntries())

  // IPC: fill
  ipcMain.handle('fillPopup:fill', async (_e, data: { account?: string; username?: string; password: string; mode: 'all' | 'passwordOnly' }) => {
    await doFill(data)
  })

  // IPC: hide
  ipcMain.handle('fillPopup:hide', () => {
    if (fillWindow && !fillWindow.isDestroyed()) fillWindow.hide()
  })

  // Global shortcut

  // Load custom shortcut from settings or use default
  let shortcutKey = 'Ctrl+Alt+P'
  try {
    const sp = join(app.getPath('userData'), 'settings.json')
    if (existsSync(sp)) {
      const s = JSON.parse(readFileSync(sp, 'utf-8'))
      if (s.fillPopupShortcut) shortcutKey = s.fillPopupShortcut
    }
  } catch { /* use default */ }

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
  if (fillWindow && !fillWindow.isDestroyed()) {
    fillWindow.close()
    fillWindow = null
  }
}
