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
  // AI 测试桥:dev 默认开启(显式设 KNOWBASE_DEV_BRIDGE=0 可关闭)。
  // 生产构建不经过本分支,因此无论环境变量如何都不会打包该能力。
  if (env.KNOWBASE_DEV_BRIDGE === undefined) env.KNOWBASE_DEV_BRIDGE = '1'
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', 'npx', 'electron-vite', 'dev'], {
        env, cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: false
      })
    : spawn('npx', ['electron-vite', 'dev'], {
        env, cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: false
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
