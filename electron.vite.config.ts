import { dirname, resolve } from 'path'
import { realpathSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// worktree 场景：node_modules 是指向主工程 node_modules 的 junction（realpath 在 worktree 之外），
// Vite dev server 按真实路径判定后拒绝服务（monaco 等静态资源 403 → 黑屏）。
// 因此把「主工程根」一并加入 renderer 的 fs 白名单；普通 checkout 下 realpath 不变，此值无副作用。
const nodeModulesReal = realpathSync(resolve(__dirname, 'node_modules'))
const mainProjectRoot = dirname(nodeModulesReal)

export default defineConfig({
  main: {
    // defuddle 打进 bundle 而非 externalize：其 '/node' 子路径 exports 只有 import 条件，
    // rollup 的 external 字符串会连 'defuddle/node' 一起匹配放行 → 产物运行时 require 必炸
    // ERR_PACKAGE_PATH_NOT_EXPORTED（0.19.3 实测）。
    // linkedom 一并打进来：其 cjs 构建运行时 require('css-select')，而 css-select 新版是 ESM-only，
    // Electron 主进程必炸 ERR_REQUIRE_ESM（实测）；bundle 静态解析后统一为 CJS 产物，运行期无 require 链。
    // turndown 有合法 require 条件，维持外置。
    plugins: [externalizeDepsPlugin({ exclude: ['defuddle', 'linkedom'] })],
    // AI 测试桥开关：构建期静态替换。为 false 时 main 中的动态 import 会被
    // tree-shake 掉，devbridge 整个 chunk 不进产物（生产零残留）。
    define: {
      __DEV_BRIDGE__: JSON.stringify(process.env.KNOWBASE_DEV_BRIDGE === '1')
    },
    build: {
      outDir: 'out/main',
      // 本机 safe-delete 钩子会拦截 Vite 清空 outDir 的操作（Error during a `trash` operation），
      // 导致 dev/build 直接失败。关闭自动清空改为覆盖写：旧产物残留无害（文件名带 hash 或固定），
      // 需要彻底清理时手动删除 out/ 目录。
      emptyOutDir: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts')
        },
        // linkedom 打进 bundle 后会牵出其可选依赖 canvas（require('../build/Release/canvas.node')）——
        // 该分支在纯 Node/Electron 下永不触发，标记 external 让 rollup 不做静态解析即可。
        external: ['canvas']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      emptyOutDir: false,   // 同上：规避 safe-delete 拦截
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    server: {
      host: '127.0.0.1',
      port: 7173,          // 6173 会落入 Windows Hyper-V/winnat 排除端口段导致 EACCES
      strictPort: false,
      watch: {
        // Windows 下原子写（编辑工具/脚本）会产生 `.xx.tmpdir/` 临时目录与 `.uuid.tmp`
        // 文件，rename 完成即消失；chokidar 原生 watcher 恰以这一瞬为竞态捕获它们
        // → EBUSY 未捕获异常直接杀死 dev 进程（本机 dev 实测崩溃）。
        // 一并忽略非源码目录：tmp/（基线与冒烟产物，写入不再触发无谓 full-reload）、
        // .AGENT/（worktree 嵌套副本）、out_prev_*/（历史构建 dumps）。
        ignored: ['**/.*.tmp', '**/.*.tmpdir', '**/.*.tmpdir/**', '**/tmp/**', '**/.AGENT/**', '**/out_prev_*/**']
      },
      fs: {
        allow: [resolve(__dirname), mainProjectRoot]
      }
    },
    build: {
      outDir: 'out/renderer',
      emptyOutDir: false,   // 同上：规避 safe-delete 拦截
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
