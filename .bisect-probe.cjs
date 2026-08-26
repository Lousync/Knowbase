const { spawn } = require('child_process')
const path = require('path')
const ROOT = process.cwd()
const PORT = Number(process.argv[2] || 9345)
let msgId = 0
const pending = new Map()
const errs = []

;(async () => {
  const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron.exe'), [`--remote-debugging-port=${PORT}`, ROOT], { stdio: 'ignore' })
  let url = null
  for (let i = 0; i < 30 && !url; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      url = ((await r.json()).find(x => x.type === 'page') || {}).webSocketDebuggerUrl
    } catch {}
    if (!url) await new Promise(r => setTimeout(r, 1000))
  }
  const ws = new WebSocket(url)
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 250))
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errs.push('[console] ' + m.params.args?.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 250))
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable', params: {} }))
  const ev = expr => new Promise(res => {
    const id = ++msgId
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true } }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({}) } }, 10000)
  })
  for (let i = 0; i < 25; i++) {
    const r = await ev('return typeof window.api!=="undefined"')
    if (r.result?.value === true) break
    await new Promise(r => setTimeout(r, 500))
  }
  // 等待 React 完成挂载（html 出现 theme-* 类 = App effect 已执行），再派发并重试
  let ok = false
  for (let i = 0; i < 12 && !ok; i++) {
    await ev(`
      if (!document.documentElement.className.includes('theme-')) return 'wait-mount'
      window.dispatchEvent(new CustomEvent('settings:open'))
      return 'dispatched'
    `)
    await new Promise(r => setTimeout(r, 900))
    const chk = await ev(`return document.body.innerText.includes('搜索设置')`)
    ok = chk.result?.value === true
  }
  const theme = await ev(`return document.documentElement.className`)
  console.log(JSON.stringify({ settingsOpened: ok, htmlClass: theme.result?.value, exceptions: errs.slice(0, 3) }))
  try { child.kill() } catch {}
  await new Promise(r => setTimeout(r, 1200))
  process.exit(0)
})()
