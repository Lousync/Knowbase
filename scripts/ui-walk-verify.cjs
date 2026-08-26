/**
 * UI 遍历自检：拉起应用（CDP）→ 打开设置 → 逐个点击 AI 工具的六个页签 →
 * 监听渲染层 console error / 页面崩溃 / 主进程退出 → 汇总报告。
 */
const { spawn } = require('child_process')
const path = require('path')
const ROOT = process.cwd()
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const PORT = 9336
let msgId = 0
const pending = new Map()
const consoleErrors = []
const pageErrors = []

;(async () => {
  const child = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`, ROOT], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderrTail = ''
  child.stderr.on('data', d => { stderrTail += d })
  let exited = false
  child.on('exit', code => { exited = true; console.log(`[!!] 主进程提前退出 code=${code}`) })

  let ws = null
  try {
    let url = null
    for (let i = 0; i < 30 && !url; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
        const t = await r.json()
        url = (t.find(x => x.type === 'page') || {}).webSocketDebuggerUrl
      } catch {}
      if (!url) await new Promise(r => setTimeout(r, 1000))
    }
    if (!url) throw new Error('CDP 未就绪')
    ws = new WebSocket(url)
    ws.onmessage = e => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); return }
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
        consoleErrors.push(m.params.args?.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300))
      }
      if (m.method === 'Runtime.exceptionThrown') {
        pageErrors.push(String(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text ?? '').slice(0, 300))
      }
    }
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable', params: {} }))

    const ev = expr => new Promise(res => {
      const id = ++msgId
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({}) } }, 15000)
    })

    // 等 api 就绪
    for (let i = 0; i < 25; i++) {
      const r = await ev('return typeof window.api!=="undefined"')
      if (r.result?.value === true) break
      await new Promise(r => setTimeout(r, 500))
    }

    // 打开设置模块
    await ev(`window.dispatchEvent(new CustomEvent('settings:open')); return true`)
    await new Promise(r => setTimeout(r, 800))

    // 找到「AI 工具」设置入口并点开（轮询等待渲染，防首启慢）
    let opened = false
    for (let i = 0; i < 10 && !opened; i++) {
      const r = await ev(`
        const btns=[...document.querySelectorAll('button')];
        const ai=btns.find(b=>b.textContent.trim()==='AI 工具');
        if(ai){ai.click();return true} return false
      `)
      opened = r.result?.value === true
      if (!opened) await new Promise(r => setTimeout(r, 800))
    }
    console.log('进入 AI 工具页:', opened)
    await new Promise(r => setTimeout(r, 600))

    // 六个页签逐个点击，每处停留后检查 DOM 是否仍有根节点（白屏检测）
    for (const label of ['内置工具', 'MCP', 'Skill', '模型', '权限']) {
      const r = await ev(`
        const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='${label}');
        if(b){b.click();return 'clicked'} return 'not-found'
      `)
      await new Promise(r => setTimeout(r, 700))
      const alive = await ev(`return !!document.getElementById('root') && document.body.children.length>0`)
      console.log(`页签[${label}]: ${r.result?.value} | root存活: ${alive.result?.value}`)
    }

    // 全局助手面板冒烟：Ctrl+J 唤起 → FAB/面板 DOM 出现
    await ev(`
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'j',ctrlKey:true,bubbles:true}));
      return true
    `)
    await new Promise(r => setTimeout(r, 500))

    // 主题切换触发 editorTheme 观察器
    await ev(`
      document.documentElement.classList.add('theme-light');
      setTimeout(()=>document.documentElement.classList.remove('theme-light'),300);
      return true
    `)
    await new Promise(r => setTimeout(r, 600))

    console.log('--- 结果 ---')
    console.log('主进程存活:', !exited)
    console.log('渲染层 console.error 数:', consoleErrors.length)
    consoleErrors.slice(0, 5).forEach(e => console.log('  [console.error]', e))
    console.log('未捕获异常数:', pageErrors.length)
    pageErrors.slice(0, 5).forEach(e => console.log('  [exception]', e))
    if (stderrTail) console.log('主进程 stderr 尾部:', stderrTail.slice(-500))
  } catch (err) {
    console.log('FATAL:', String(err).slice(0, 200))
  } finally {
    try { ws?.close() } catch {}
    try { child.kill() } catch {}
    await new Promise(r => setTimeout(r, 1200))
    try { process.kill(child.pid, 'SIGKILL') } catch {}
  }
})()
