import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { SettingsProvider } from './lib/SettingsContext'

// monaco-setup 不在此处引入（性能 2026-09-10）：它静态拉入 monaco-editor 主包 + 5 个 worker，
// 曾使首屏主 chunk 达 13.3MB。现下沉到三个 Monaco 宿主组件
// （editor/MonacoPane、knowledge/PageEditor、blog/MarkdownEditor）各自副作用引入，
// rollup 会提升为共享 chunk，只在真正打开编辑器时才下载解析。

// 不用 StrictMode（2026-09-08）：dev 双挂载（mount→unmount→mount）与 @monaco-editor/react
// 4.7 卸载逻辑（pe(): dispose model+editor）组合出 dispose 竞态——组件树持有已 dispose 的
// editor 引用，之后每次主题广播（bindEditorTheme 全局 setTheme）引爆残留监听，即 V-7 的
// Model is disposed / InstantiationService has been disposed 连环刷屏。生产构建本就无此
// 行为，移除后 dev 与生产一致。副作用暴露价值远小于本项目的 Monaco 稳定性成本。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <App />
  </SettingsProvider>,
)
