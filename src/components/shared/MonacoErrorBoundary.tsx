import { Component, type ReactNode } from 'react'

/**
 * Monaco 面板级错误边界（V-7，2026-09-08 从 editor/MonacoPane 提升为全仓共享）。
 *
 * 背景：monaco 0.56 内部存在 dispose 与渲染协调器/事件队列的时序竞态（上游未修）——
 * HMR/组件树重挂后旧实例 dispose 残留，渲染帧抛 InstantiationService disposed /
 * setClassName / domNode / getWidgets / Model is disposed 等错误。
 *
 * 全仓三处独立挂 @monaco-editor/react 的 <Editor>（editor MonacoPane / blog
 * MarkdownEditor / knowledge PageEditor）都必须套本边界：不套则错误直接冒泡到
 * RootErrorBoundary 塌整树，套了只塌本面板。
 *
 * 自愈策略：瞬时类错误（dispose 竞态）自动重建一次（重挂即愈），限一次防循环；
 * 再错停错误面板交用户手动。children 变化（换文档/换仓库）自动清除错误态。
 */
export class MonacoErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null; key: number; autoRetries: number }> {
  state: { err: Error | null; key: number; autoRetries: number } = { err: null, key: 0, autoRetries: 0 }
  static getDerivedStateFromError(err: Error): { err: Error | null } {
    return { err }
  }
  componentDidCatch(err: Error): void {
    // V-7（monaco 0.56）：HMR/重挂后旧实例 dispose 的时序竞态重挂即愈——
    // 瞬时类错误自动重建一次；限一次，再错停面板交用户手动，防循环
    const transient =
      /InstantiationService has been disposed|Model is disposed|reading '(setClassName|domNode|getWidgets)'/.test(err.message)
    if (transient && this.state.autoRetries < 1) {
      this.setState((s) => ({ err: null, key: s.key + 1, autoRetries: s.autoRetries + 1 }))
    }
  }
  componentDidUpdate(prev: { children: ReactNode }): void {
    // 换文档/换仓库（children 元素变化）时自动清错重试一次
    if (this.props.children !== prev.children && this.state.err) this.setState({ err: null })
  }
  render(): ReactNode {
    if (this.state.err) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-[var(--text-muted)]">
          <span>编辑器渲染出错（内容不会丢失，磁盘即真相源）</span>
          <button
            onClick={() => this.setState(s => ({ err: null, key: s.key + 1 }))}
            className="rounded-md border border-[var(--border-color)] px-3 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >重新加载编辑器</button>
        </div>
      )
    }
    return <div key={this.state.key} className="h-full min-h-0">{this.props.children}</div>
  }
}
