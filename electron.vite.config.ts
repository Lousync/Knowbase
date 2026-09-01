import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
        }
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
      strictPort: false
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
