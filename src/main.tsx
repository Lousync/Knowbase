import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import './lib/monaco-setup'
import { SettingsProvider } from './lib/SettingsContext'

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
