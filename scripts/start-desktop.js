/**
 * 桌面一键启动器
 * - 首次运行：自动安装依赖
 * - 直接以开发模式启动：node scripts/launch.js dev（实时编译最新代码，免安装、免手动打包）
 * 用法：node scripts/start-desktop.js
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')

function needInstall() {
  return !fs.existsSync(ELECTRON)
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
    console.log('[启动器] 正在以开发模式启动 Knowbase ...')
    await run(process.execPath, [path.join(ROOT, 'scripts/launch.js'), 'dev'], '启动应用')
    console.log('[启动器] 应用已退出')
  } catch (err) {
    console.error('\n[启动器] ' + err.message)
    console.error('[启动器] 如反复失败，请打开项目目录手动执行：npm install && npm run build')
    process.exit(1)
  }
})()
