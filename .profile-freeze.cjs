const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const ROOT = process.cwd()
const PORT = Number(process.argv[2] || 9354)
let msgId = 0
const pending = new Map()

;(async () => {
  const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron.exe'), [`--remote-debugging-port=${PORT}`, path.join(ROOT, 'out', 'main', 'index.js')], { stdio: 'ignore' })
  let url = null
  for (let i = 0; i < 30 && !url; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      url = ((await r.json()).find(x => x.type === 'page') || {}).webSocketDebuggerUrl
    } catch {}
    if (!url) await new Promise(r => setTimeout(r, 1000))
  }
  const ws = new WebSocket(url)
  const results = []
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id) } }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const send = (method, params = {}) => new Promise(res => {
    const id = ++msgId
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({}) } }, 30000)
  })
  const ev = expr => send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true })
  for (let i = 0; i < 25; i++) {
    const r = await ev('return typeof window.api!=="undefined"')
    if (r.result?.value === true) break
    await new Promise(r => setTimeout(r, 500))
  }
  for (let i = 0; i < 12; i++) {
    const t = await ev(`return document.documentElement.className`)
    if (String(t.result?.value).includes('theme-')) break
    await new Promise(r => setTimeout(r, 800))
  }

  await send('Profiler.enable')
  await send('Profiler.start')
  await ev(`
    const b=[...document.querySelectorAll('button')].find(x=>(x.title||'').includes('设置'));
    if(b)b.click(); return 1
  `)
  await new Promise(r => setTimeout(r, 4000)) // 冻结期间采样
  const prof = await send('Profiler.stop')
  try { child.kill() } catch {}

  const nodes = prof?.profile?.nodes ?? []
  const samples = prof?.profile?.samples ?? []
  const timeDeltas = prof?.profile?.timeDeltas ?? []
  const hit = new Map()
  samples.forEach((s, i) => {
    const n = nodes.find(n => n.id === s)
    if (!n) return
    const f = n.callFrame
    const key = `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`
    hit.set(key, (hit.get(key) ?? 0) + (timeDeltas[i] ?? 0))
  })
  const top = [...hit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log('采样点:', samples.length, '总时长(ms):', Math.round(timeDeltas.reduce((a, b) => a + b, 0)))
  top.forEach(([k, v]) => console.log(`  ${Math.round(v)}ms  ${k}`))
  fs.writeFileSync(path.join(ROOT, '.cpu-profile.json'), JSON.stringify(prof?.profile ?? {}))
})()
