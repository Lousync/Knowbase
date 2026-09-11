/**
 * 平板端单页应用（内嵌 HTML，无任何外部依赖）。
 * 扫码打开即用：上传文件到电脑 / 下载电脑待发送的文件。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function renderPage(hostname: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Phrontis 设备传输</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #f4f5f7; color: #1f2329; padding: 14px; min-height: 100vh; }
  .card { background: #fff; border: 1px solid #e4e6ea; border-radius: 14px; max-width: 460px; margin: 0 auto 12px; overflow: hidden; }
  .head { padding: 13px 16px; border-bottom: 1px solid #eef0f3; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .head .title { font-size: 14px; font-weight: 500; }
  .head .sub { font-size: 11px; color: #8a9099; margin-top: 2px; }
  .pill { font-size: 11px; color: #0f6e56; background: #e1f5ee; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .section { padding: 14px 16px; }
  .section + .section { border-top: 1px solid #eef0f3; }
  .section h3 { font-size: 13px; font-weight: 500; margin-bottom: 10px; }
  .drop { border: 1.5px dashed #9fe1cb; background: #f2fbf7; border-radius: 10px; padding: 18px 12px; text-align: center; cursor: pointer; }
  .drop:active { background: #e4f5ed; }
  .drop .main { font-size: 13px; color: #085041; }
  .drop .hint { font-size: 11px; color: #5f9a8a; margin-top: 4px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 9px 11px; background: #f6f7f9; border-radius: 9px; margin-top: 8px; font-size: 12px; }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .meta { color: #8a9099; font-size: 11px; flex-shrink: 0; }
  .row .ok { color: #0f6e56; font-size: 11px; flex-shrink: 0; }
  button.dl { border: 1px solid #cfd3da; background: #fff; border-radius: 7px; font-size: 11px; padding: 3px 10px; color: #1f2329; cursor: pointer; flex-shrink: 0; }
  button.dl:active { background: #f0f1f3; }
  .empty { text-align: center; color: #a2a7ae; font-size: 12px; padding: 14px 0 4px; }
  .foot { padding: 10px 16px; border-top: 1px solid #eef0f3; font-size: 11px; color: #b0b4ba; text-align: center; }
  .toast { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); background: rgba(31,35,41,.92); color: #fff; font-size: 12px; padding: 8px 14px; border-radius: 999px; opacity: 0; transition: opacity .25s; pointer-events: none; max-width: 86vw; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="card">
  <div class="head">
    <div>
      <div class="title">已连接到志岩的电脑</div>
      <div class="sub">${escapeHtml(hostname)}</div>
    </div>
    <span class="pill" id="timer">连接中…</span>
  </div>

  <div class="section">
    <h3>传到电脑</h3>
    <div class="drop" id="drop">
      <div class="main">选择文件或照片</div>
      <div class="hint">可访问「文件」App 与照片图库</div>
    </div>
    <input type="file" id="file" multiple style="display:none">
    <div id="uploaded"></div>
  </div>

  <div class="section">
    <h3>从电脑取</h3>
    <div id="outbox"><div class="empty">加载中…</div></div>
  </div>

  <div class="foot">数据仅在局域网内传输 · 关闭电脑端服务即断开</div>
</div>
<div class="toast" id="toast"></div>

<script>
(function () {
  var token = new URLSearchParams(location.search).get('token') || ''
  var api = function (path, extra) { return '/api/' + path + '?token=' + encodeURIComponent(token) + (extra || '') }
  var toast = document.getElementById('toast')
  var toastTimer = null
  var connErr = document.getElementById('connErr')
  function showConnError(msg) {
    connErr.textContent = msg
    connErr.style.display = 'block'
  }
  function hideConnError() { connErr.style.display = 'none' }
  function showToast(msg) {
    toast.textContent = msg
    toast.classList.add('show')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { toast.classList.remove('show') }, 2600)
  }

  var timerEl = document.getElementById('timer')
  var remainingMs = 0
  function tick() {
    if (remainingMs <= 0) { timerEl.textContent = '即将断开'; return }
    var s = Math.ceil(remainingMs / 1000)
    var m = Math.floor(s / 60), r = s % 60
    timerEl.textContent = m + ' 分 ' + r + ' 秒后断开'
    remainingMs -= 1000
  }
  setInterval(tick, 1000)

  fetch(api('status')).then(function (r) {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  }).then(function (d) {
    remainingMs = d.remainingMs || 0
    tick()
  }).catch(function () {
    showConnError('无法连接电脑端，请确认服务仍在运行')
  })

  var drop = document.getElementById('drop')
  var fileInput = document.getElementById('file')
  drop.addEventListener('click', function () { fileInput.click() })

  function upload(files) {
    if (!files || !files.length) return
    var fd = new FormData()
    for (var i = 0; i < files.length; i++) fd.append('file', files[i])
    var xhr = new XMLHttpRequest()
    xhr.open('POST', api('upload'))
    var row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = '<span class="name">' + escapeHtml(files[0].name) + '</span><span class="meta">上传中…</span>'
    document.getElementById('uploaded').prepend(row)
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        row.querySelector('.meta').textContent = Math.round(e.loaded / e.total * 100) + '%'
      }
    }
    xhr.onload = function () {
      if (xhr.status === 200) {
        row.querySelector('.meta').className = 'ok'
        row.querySelector('.meta').textContent = '已收到'
        showToast('已发送到电脑')
        hideConnError()
      } else if (xhr.status === 401) {
        row.querySelector('.meta').className = 'meta'
        row.querySelector('.meta').textContent = '连接已失效'
        showConnError('连接已失效，请回到电脑端重新开启并扫码')
      } else {
        row.querySelector('.meta').className = 'meta'
        row.querySelector('.meta').textContent = '失败(' + xhr.status + ')'
        showToast('上传失败')
      }
    }
    xhr.onerror = function () {
      row.querySelector('.meta').className = 'meta'
      row.querySelector('.meta').textContent = '网络错误'
      showConnError('网络中断，请确认电脑端服务仍在运行')
    }
    xhr.send(fd)
  }
  fileInput.addEventListener('change', function () { upload(fileInput.files); fileInput.value = '' })

  // 拖放上传：拖到页面任意位置即发送（浏览器默认行为会打开文件，必须阻止）
  document.addEventListener('dragover', function (e) { e.preventDefault() })
  document.addEventListener('drop', function (e) {
    e.preventDefault()
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) upload(e.dataTransfer.files)
  })

  var outboxEl = document.getElementById('outbox')
  function renderOutbox(list) {
    if (!list || !list.length) {
      outboxEl.innerHTML = '<div class="empty">电脑端暂无待发送文件</div>'
      return
    }
    var html = ''
    for (var i = 0; i < list.length; i++) {
      var f = list[i]
      html += '<div class="row"><span class="name">' + escapeHtml(f.name) + '</span><span class="meta">' + formatSize(f.size) + '</span>' +
        (f.downloaded ? '<span class="ok">已下载</span>' : '') +
        '<a href="' + api('download', '&name=' + encodeURIComponent(f.name)) + '"><button class="dl">下载</button></a></div>'
    }
    outboxEl.innerHTML = html
  }
  function refreshOutbox() {
    fetch(api('outbox')).then(function (r) {
      if (r.status === 401) {
        showConnError('连接已失效，请回到电脑端重新开启并扫码')
        return null
      }
      if (!r.ok) {
        showConnError('读取失败(' + r.status + ')')
        return null
      }
      return r.json()
    }).then(function (data) {
      if (!data) return
      hideConnError()
      renderOutbox(data.files)
    }).catch(function () {
      showConnError('无法连接电脑端，请确认服务仍在运行')
    })
  }
  refreshOutbox()
  setInterval(refreshOutbox, 2500)
})();
</script>
</body>
</html>`
}
