/**
 * 桌面一键启动器
 * - 首次运行：自动安装依赖
 * - 检测到源码有更新（git pull / 编辑后）：自动重新构建
 * - 构建完成：直接启动 Electron（免安装、免手动打包）
 * 用法：node scripts/start-desktop.js
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const BUILT = path.join(ROOT, 'out/main/index.js')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'out', '.git', 'dist-electron'].includes(entry.name)) continue
      walk(p, out)
    } else {
      out.push(p)
    }
  }
  return out
}

function newestMtime(rootPaths) {
  let newest = 0
  for (const p of rootPaths) {
    if (!fs.existsSync(p)) continue
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      for (const f of walk(p)) {
        const m = fs.statSync(f).mtimeMs
        if (m > newest) newest = m
      }
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs
    }
  }
  return newest
}

function needInstall() {
  return !fs.existsSync(ELECTRON)
}

function needBuild() {
  if (!fs.existsSync(BUILT)) return true
  const sources = ['electron', 'src', 'index.html', 'package.json', 'electron.vite.config.ts', 'scripts'].map(f => path.join(ROOT, f))
  // 允许 1 秒时间误差，避免文件系统时间戳抖动导致误判
  return newestMtime(sources) > fs.statSync(BUILT).mtimeMs + 1000
}

function run(cmd, args, label) {
  console.log(`\n[启动器] ${label} ...`)
  const child = spawn(cmd, args, { cwd: ROOT, shell: false, stdio: 'inherit' })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`${label} 失败 (exit ${code})`))
    })
  })
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

;(async () => {
  try {
    if (needInstall()) {
      console.log('[启动器] 首次运行，正在安装依赖，请稍候...')
      await run(npm, ['install'], '安装依赖')
    }
    if (needBuild()) {
      console.log('[启动器] 检测到代码更新，正在重新构建（约 20~30 秒）...')
      await run(npm, ['run', 'build'], '构建')
    }
    console.log('[启动器] 正在启动 Knowbase ...')
    await run(process.execPath, [path.join(ROOT, 'scripts/launch.js'), 'start'], '启动应用')
    console.log('[启动器] 应用已退出')
  } catch (err) {
    console.error('\n[启动器] ' + err.message)
    console.error('[启动器] 如反复失败，请打开项目目录手动执行：npm install && npm run build')
    process.exit(1)
  }
})()
