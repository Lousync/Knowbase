import { BrowserWindow, globalShortcut, screen, clipboard, app, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { spawn } from 'child_process'
import { getDatabase } from '../database/connection'

let fillWindow: BrowserWindow | null = null

function getSettingsValue(key: string, fallback: string): string {
  try {
    const sp = join(app.getPath('userData'), 'settings.json')
    if (existsSync(sp)) {
      const s = JSON.parse(readFileSync(sp, 'utf-8'))
      if (s[key] !== undefined) return String(s[key])
    }
  } catch { /* */ }
  return fallback
}

// --------------- auto-fill ---------------

function sendKeys(keys: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('powershell', [
      '-WindowStyle', 'Hidden', '-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`
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

  if (fillWindow && !fillWindow.isDestroyed()) fillWindow.hide()
  await new Promise(r => setTimeout(r, 350))

  if (account) {
    clipboard.writeText(account)
    await sendKeys('^v')
    await new Promise(r => setTimeout(r, 120))
    clipboard.writeText(data.password)
    await sendKeys('{TAB}')
    await new Promise(r => setTimeout(r, 80))
    await sendKeys('^v')
  } else {
    clipboard.writeText(data.password)
    await sendKeys('^v')
  }

  await new Promise(r => setTimeout(r, 500))
  const current = clipboard.readText()
  if (current === data.password || current === account) clipboard.writeText(saved)
}

// --------------- inline HTML popup ---------------

function popupHtml(theme: string): string {
  const isLight = theme === 'light'
  const css = `
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;overflow:hidden;
      background:${isLight ? '#fff' : '#1e1e1e'};color:${isLight ? '#333' : '#ccc'};
      user-select:none;-webkit-user-select:none}
    .hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;
      background:${isLight ? '#f3f3f3' : '#252526'};border-bottom:1px solid ${isLight ? '#e0e0e0' : '#3e3e3e'};
      -webkit-app-region:drag}
    .hdr span{font-weight:600;font-size:12px}
    .hdr button{-webkit-app-region:no-drag;background:none;border:none;color:inherit;
      cursor:pointer;padding:2px 4px;border-radius:3px;font-size:14px;line-height:1}
    .hdr button:hover{background:${isLight ? '#e0e0e0' : '#3e3e3e'}}
    .search{padding:6px 10px}
    .search input{width:100%;padding:5px 8px;font-size:11px;border-radius:4px;
      border:1px solid ${isLight ? '#d0d0d0' : '#3e3e3e'};
      background:${isLight ? '#f5f5f5' : '#2d2d2d'};color:inherit;outline:none}
    .search input:focus{border-color:#007acc}
    .list{overflow-y:auto;flex:1}
    .item{padding:6px 10px;cursor:pointer;border-left:3px solid transparent;
      border-bottom:1px solid ${isLight ? '#f0f0f0' : '#2a2a2a'}}
    .item:hover{background:${isLight ? '#f0f0f0' : '#2a2d2e'}}
    .item.sel{background:${isLight ? '#e4edf5' : '#1e2a38'};border-left-color:#007acc}
    .item .t{font-weight:500;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .item .s{font-size:10px;opacity:0.6;margin-top:1px}
    .item .m{font-size:9px;opacity:0.4;font-family:monospace;letter-spacing:0.1em;margin-top:1px}
    .bar{display:flex;align-items:center;gap:6px;padding:6px 10px;
      background:${isLight ? '#f3f3f3' : '#252526'};border-top:1px solid ${isLight ? '#e0e0e0' : '#3e3e3e'};
      -webkit-app-region:no-drag}
    .bar .info{flex:1;font-size:10px;opacity:0.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bar button{padding:4px 10px;border-radius:3px;font-size:11px;cursor:pointer;border:1px solid ${isLight ? '#ccc' : '#555'};
      background:transparent;color:inherit}
    .bar button:hover{background:${isLight ? '#e0e0e0' : '#3e3e3e'}}
    .bar button.prim{background:#007acc;color:#fff;border-color:#007acc}
    .bar button.prim:hover{background:#005a9e}
    .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;opacity:0.4;gap:4px}
    .empty .icon{font-size:24px}
    .empty p{font-size:11px}
  `.replace(/\n\s*/g, '')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head>
<body style="display:flex;flex-direction:column;height:100vh">
<div class="hdr"><span>Knowbase 填充</span><button onclick="hide()">✕</button></div>
<div class="search"><input id="q" placeholder="搜索..." oninput="render()"></div>
<div class="list" id="list"></div>
<div class="bar" id="bar" style="display:none">
  <div class="info" id="info"></div>
  <button onclick="fill('passwordOnly')">密码</button>
  <button class="prim" onclick="fill('all')">填充</button>
</div>
<script>
let entries=[],sel=null,q=''
async function load(){entries=await window.api.fillPopupGetEntries();render()}
function render(){
  q=document.getElementById('q').value.toLowerCase()
  const f=q?entries.filter(e=>(e.title||'').toLowerCase().includes(q)||(e.account||'').toLowerCase().includes(q)||(e.username||'').toLowerCase().includes(q)||(e.url||'').toLowerCase().includes(q)):entries
  document.getElementById('list').innerHTML=f.length?f.map(e=>'<div class="item'+(sel&&sel.id===e.id?' sel':'')+'" onclick="select(\''+e.id+'\')" ondblclick="select(\''+e.id+'\');fill(\'all\')"><div class="t">'+(e.title||'未命名')+'</div><div class="s">'+(e.account?'@'+e.account+' ':'')+(e.username?'👤'+e.username:'')+'</div><div class="m">••••••••</div></div>').join(''):'<div class="empty"><div class="icon">🔑</div><p>'+(entries.length?'无匹配结果':'密码本为空')+'</p></div>'
  updateBar()
}
function select(id){sel=entries.find(e=>e.id===id)||null;render();document.getElementById('q').focus()}
function updateBar(){
  const b=document.getElementById('bar'),i=document.getElementById('info')
  if(sel){b.style.display='flex';i.textContent=(sel.title||'未命名')+(sel.account?' · '+sel.account:'')}
  else{b.style.display='none'}
}
function fill(mode){if(!sel)return;window.api.fillPopupFill({account:sel.account,username:sel.username,password:sel.password,mode})}
function hide(){window.api.fillPopupHide()}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(q){document.getElementById('q').value='';render()}else hide()}
  if(e.key==='Enter'&&sel){e.preventDefault();fill('all')}
  if(e.key==='ArrowDown'){e.preventDefault();const f=document.querySelectorAll('.item');const idx=Array.from(f).findIndex(el=>el.classList.contains('sel'));if(idx<f.length-1){const next=f[idx+1];next.click()}}
  if(e.key==='ArrowUp'){e.preventDefault();const f=document.querySelectorAll('.item');const idx=Array.from(f).findIndex(el=>el.classList.contains('sel'));if(idx>0){const prev=f[idx-1];prev.click()}}
})
window.api.onFillPopupRefresh(()=>{sel=null;document.getElementById('q').value='';load()})
window.api.onFillPopupFeedback(s=>{if(s==='filling')document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;gap:8px"><span style="font-size:12px;opacity:0.6">正在填充...</span></div>';if(s==='done'){document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;gap:6px"><span style="font-size:20px">✓</span><span style="font-size:12px">已填充</span></div>';setTimeout(()=>hide(),800)}})
load()
</script></body></html>`
}

// --------------- floating window ---------------

function createFillWindow(): BrowserWindow {
  const theme = getSettingsValue('theme', 'dark')

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
    backgroundColor: theme === 'light' ? '#ffffff' : '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(popupHtml(theme))}`)

  win.on('blur', () => { if (win && !win.isDestroyed()) win.hide() })

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

  let shortcutKey = 'Ctrl+Alt+P'
  try {
    const sp = join(app.getPath('userData'), 'settings.json')
    if (existsSync(sp)) {
      const s = JSON.parse(readFileSync(sp, 'utf-8'))
      if (s.fillPopupShortcut) shortcutKey = s.fillPopupShortcut
    }
  } catch { /* */ }

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
