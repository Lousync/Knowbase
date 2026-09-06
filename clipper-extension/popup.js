// Knowbase Web Clipper — 薄扩展（docs/plugin-web-clipper-design.md §3.3）
// 职责：抓当前页 DOM → 发给本机 clipperServer 提取转 md → 落仓库 `.knowbase/_draft/clipper/`。
// 桌面端端口会漂移（默认段被占时），故探测 [42817, 42817+7]。token 存 chrome.storage.local。

const DEFAULT_PORT = 42817
const PORT_SPAN = 8

const $ = (id) => document.getElementById(id)
const setDot = (cls) => { $('dot').className = 'dot ' + cls }
const setStatus = (t) => { $('status').textContent = t }
const setErr = (t) => { const e = $('errline'); if (t) { e.textContent = t; e.style.display = 'block' } else { e.style.display = 'none' } }
const showReceipt = (path, mode, fallback) => {
  const r = $('receipt')
  r.style.display = 'block'
  r.textContent = (fallback ? '⚠️ 未提取到正文，已降级仅存链接 · ' : mode === 'link-only' ? '🔗 已存链接 · ' : '✓ 已剪藏 · ') + path
}

async function getToken() {
  const { clipperToken } = await chrome.storage.local.get('clipperToken')
  return clipperToken || ''
}
async function setToken(t) { await chrome.storage.local.set({ clipperToken: t }) }

/** 探测活着的桌面端口（GET /api/ping），记住命中端口复用 */
async function discoverPort() {
  const { clipperPort } = await chrome.storage.local.get('clipperPort')
  const candidates = clipperPort ? [clipperPort, ...range()] : range()
  for (const port of candidates) {
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 700)
      const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: ctrl.signal })
      clearTimeout(to)
      const j = await res.json()
      if (j && j.ok && j.clipper) {
        await chrome.storage.local.set({ clipperPort: port })
        return { port, vault: j.vault, hasVault: j.hasVault, needsPairing: j.needsPairing }
      }
    } catch { /* 试下一个 */ }
  }
  return null
}
const range = () => Array.from({ length: PORT_SPAN }, (_, i) => DEFAULT_PORT + i)

async function post(port, path, body) {
  const token = await getToken()
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({ ok: false, error: '响应解析失败' }))
  if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`)
  return j
}

let livePort = 0

async function boot() {
  setErr('')
  setDot('')
  setStatus('连接桌面端…')
  $('actions').classList.add('hidden')
  $('pair').style.display = 'none'
  $('retryBtn').classList.add('hidden')
  const found = await discoverPort()
  if (!found) {
    setDot('err')
    setStatus('未连接：请先在 Knowbase 桌面端打开应用（工具箱 → 网页剪藏）')
    $('retryBtn').classList.remove('hidden')
    return
  }
  livePort = found.port
  $('portline').textContent = `127.0.0.1:${found.port}`
  $('vault').textContent = found.hasVault ? `仓库：${found.vault || ''}` : '⚠ 桌面端未打开仓库'
  if (!found.hasVault) { setDot('err'); setStatus('桌面端未选择仓库'); return }
  const token = await getToken()
  if (!token) {
    setDot('on')
    setStatus('已连接 · 需要配对')
    $('pair').style.display = 'block'
    return
  }
  setDot('on')
  setStatus('已连接 · 就绪')
  $('actions').classList.remove('hidden')
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.title) $('pagetitle').textContent = tab.title
  } catch { /* 忽略 */ }
}

async function currentPageData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('无活动标签页')
  if (!/^https?:/.test(tab.url || '')) throw new Error('仅支持 http/https 页面')
  const [inj] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ html: '<!DOCTYPE html>' + document.documentElement.outerHTML, title: document.title, url: location.href }),
  })
  if (!inj?.result) throw new Error('读取页面失败')
  return inj.result
}

$('clipBtn').addEventListener('click', async () => {
  setErr('')
  const btn = $('clipBtn')
  btn.disabled = true; btn.textContent = '提取正文中…'
  try {
    const data = await currentPageData()
    const j = await post(livePort, '/api/clip', { url: data.url, title: data.title, html: data.html })
    showReceipt(j.path, j.mode, j.fallback)
    setStatus(j.fallback ? '已存为链接（正文提取失败）' : '✓ 已剪藏')
  } catch (e) {
    setErr(e.message)
    setStatus('剪藏失败')
  } finally {
    btn.disabled = false; btn.textContent = '✂️ 剪藏整页'
  }
})

$('linkBtn').addEventListener('click', async () => {
  setErr('')
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url || !/^https?:/.test(tab.url)) throw new Error('仅支持 http/https 页面')
    const j = await post(livePort, '/api/clip-link', { url: tab.url, title: tab.title || tab.url })
    showReceipt(j.path, 'link-only')
    setStatus('🔗 已存链接')
  } catch (e) { setErr(e.message) }
})

$('pairBtn').addEventListener('click', async () => {
  const t = $('tokenInput').value.trim()
  if (!t) { setErr('请粘贴令牌'); return }
  setErr('')
  try {
    const res = await fetch(`http://127.0.0.1:${livePort}/api/pair-check`, { headers: { authorization: 'Bearer ' + t } })
    if (res.status === 200) {
      await setToken(t)
      boot()
    } else {
      setErr(res.status === 401 ? '令牌无效：请回 Knowbase 工具箱重新复制' : `HTTP ${res.status}`)
    }
  } catch (e) { setErr('校验失败：' + e.message) }
})

$('retryBtn').addEventListener('click', boot)
boot()
