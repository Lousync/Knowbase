import { BrowserWindow, globalShortcut, screen, clipboard, app, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { spawn } from 'child_process'
import { getDatabase } from '../database/connection'

let fillWindow: BrowserWindow | null = null

// --------------- helpers ---------------

function getSettingsJSON(): Record<string, unknown> {
  try {
    const sp = join(app.getPath('userData'), 'settings.json')
    if (existsSync(sp)) return JSON.parse(readFileSync(sp, 'utf-8'))
  } catch { /* */ }
  return {}
}

function getTheme(): string {
  return String(getSettingsJSON().theme || 'dark')
}

// --------------- auto-fill (single PowerShell spawn with -STA) ---------------

async function doFill(data: { account?: string; username?: string; password: string; mode: 'all' | 'passwordOnly' }) {
  const saved = clipboard.readText()
  const account = (data.mode === 'all' && (data.account || data.username))
    ? (data.account || data.username || '')
    : ''

  // Hide popup immediately
  if (fillWindow && !fillWindow.isDestroyed()) fillWindow.hide()

  // Escape single quotes and SendKeys special chars for PowerShell string
  const esc = (s: string): string => {
    return s.replace(/'/g, "''").replace(/[+^%~(){}]/g, '{$&}')
  }

  // Single PowerShell script: -STA enables clipboard API
  let script = 'Add-Type -AssemblyName System.Windows.Forms; '
  if (account) {
    script += `[System.Windows.Forms.Clipboard]::SetText('${esc(account)}'); `
    script += "[System.Windows.Forms.SendKeys]::SendWait('^v'); "
    script += 'Start-Sleep -Milliseconds 50; '
    script += "[System.Windows.Forms.SendKeys]::SendWait('{TAB}'); "
    script += 'Start-Sleep -Milliseconds 40; '
    script += `[System.Windows.Forms.Clipboard]::SetText('${esc(data.password)}'); `
    script += "[System.Windows.Forms.SendKeys]::SendWait('^v')"
  } else {
    script += `[System.Windows.Forms.Clipboard]::SetText('${esc(data.password)}'); `
    script += "[System.Windows.Forms.SendKeys]::SendWait('^v')"
  }

  await new Promise<void>((resolve) => {
    const child = spawn('powershell', [
      '-STA',              // STA threading → clipboard API works
      '-WindowStyle', 'Hidden',
      '-NoProfile',
      '-Command', script
    ], { windowsHide: true, stdio: 'ignore' })
    child.on('close', resolve)
    child.on('error', (err) => { console.error('[fillPopup] spawn error:', err.message); resolve() })
  })

  // Restore clipboard
  await new Promise(r => setTimeout(r, 400))
  const current = clipboard.readText()
  if (current === data.password || current === account) clipboard.writeText(saved)
}

// --------------- floating window ---------------

function createFillWindow(): BrowserWindow {
  const theme = getTheme()
  const bgColor = theme === 'light' ? '#f3f3f3' : '#1e1e1e'

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
    backgroundColor: bgColor,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--fill-popup-window', `--theme=${theme}`],
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/fill-popup`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Use 'alwaysOnTop' blur timer to debounce — single clicks inside shouldn't hide
  let blurTimer: ReturnType<typeof setTimeout> | null = null
  win.on('blur', () => {
    blurTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) win.hide()
    }, 150) // short delay so internal clicks don't trigger blur-hide
  })
  win.on('focus', () => {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
  })

  return win
}

function showFillPopup() {
  if (!fillWindow || fillWindow.isDestroyed()) {
    fillWindow = createFillWindow()
  }

  const cursor = screen.getCursorScreenPoint()
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

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

  ipcMain.handle('fillPopup:fill', async (_e, data: any) => {
    await doFill(data)
  })

  ipcMain.handle('fillPopup:hide', () => {
    if (fillWindow && !fillWindow.isDestroyed()) fillWindow.hide()
  })

  const settings = getSettingsJSON()
  let shortcutKey = (settings.fillPopupShortcut as string) || 'Ctrl+Alt+P'

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
