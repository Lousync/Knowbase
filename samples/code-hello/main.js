/**
 * Code 插件试点（V3-3）：验证 type:code 插件的后台 Worker 执行链路。
 *
 * 协议（与 UI 插件同构，v2 见 plugin-api-v2-design §4.4）：
 *   宿主 → 本 Worker:  { channel:'kb-plugin', v:2, action:'init', payload:{ token, hostVersion } }
 *   本 Worker → 宿主: { channel:'kb-plugin', v:2, id, method:'kb.ui.toast', params:'…' }
 *   宿主 → 本 Worker:  { channel:'kb-plugin', v:2, id, ok:true, result } | { ok:false, error }
 *
 * Worker 无 DOM：能力只能经 postMessage 请求宿主转发 Gateway。
 * kb.ui.toast 为免授权能力（空 capability），零能力插件即可调用——作为链路探针。
 */
const CHANNEL = 'kb-plugin'
let started = false
let seq = 0

function rpc(method, params) {
  seq += 1
  self.postMessage({ channel: CHANNEL, v: 2, id: `hw${seq}`, method, params })
}

function log(msg) {
  console.log(`[code-hello] ${msg}`)
}

self.onmessage = (e) => {
  const d = (e.data ?? {}) || {}
  if (d.channel !== CHANNEL) return

  if (d.action === 'init' && d.v === 2 && !started) {
    started = true
    log(`worker 就绪 hostVersion=${d.payload?.hostVersion ?? '?'}`)
    // 链路探针 1：宿主弹提示（toast 免授权，直观可见）
    rpc('kb.ui.toast', `Code 插件已启动（worker 探针 OK）`)
  }
}

// Worker 顶层立即输出，验证 worker 脚本被真正执行
log('worker 脚本已加载，等待 init…')
