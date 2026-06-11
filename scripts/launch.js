/**
 * 启动器 —— 剥离 ELECTRON_RUN_AS_NODE 环境变量后启动 Electron
 * 用法：node scripts/launch.js dev   → electron-vite dev
 *       node scripts/launch.js start → 运行已构建的 out/main/index.js
 */
const { spawn } = require('child_process')
const path = require('path')

const mode = process.argv[2] || 'start'
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

if (mode === 'dev') {
  const child = spawn('npx', ['electron-vite', 'dev'], {
    env, cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: true
  })
  child.on('close', code => process.exit(code || 0))
} else {
  const electron = path.join(__dirname, '..', 'node_modules/electron/dist/electron.exe')
  const mainScript = path.join(__dirname, '..', 'out/main/index.js')
  const child = spawn(electron, [mainScript], {
    env, cwd: path.join(__dirname, '..'), stdio: 'inherit'
  })
  child.on('error', err => { console.error('启动失败:', err.message); process.exit(1) })
  child.on('close', code => process.exit(code || 0))
}
