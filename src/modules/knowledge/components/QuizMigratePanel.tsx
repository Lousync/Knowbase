import { useCallback, useEffect, useState } from 'react'
import { X, Database, ArrowDownToLine, ArrowUpFromLine, Download, Trash2, RefreshCw } from 'lucide-react'
import type { QuizMigrateStatus } from '../../../types'
import { quizMigrateStatus, quizMigrateExport, quizMigrateToPlugin, quizMigrateFromPlugin, quizMigrateDropPluginData } from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

/**
 * 错题本数据迁移面板（P2）：主表 ⇄ 插件命名空间表。
 * 面向插件化搬迁：先 dry-run 预览 → 实迁移（自动备份）→ 可回滚。
 * 主表数据不删除（迁移=复制），直到用户确认插件版稳定后再手动清空插件表。
 */
export function QuizMigratePanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<QuizMigrateStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  const refresh = useCallback(async () => {
    try { setStatus(await quizMigrateStatus()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const pushLog = (line: string) => setLog(prev => [...prev.slice(-19), line])

  const runDry = async () => {
    setBusy('dry')
    try {
      const r = await quizMigrateToPlugin({ dryRun: true })
      if (r.ok) {
        const summary = Object.entries(r.moved ?? {}).map(([t, n]) => `${t}: ${n}`).join('，')
        pushLog(`[dry-run] 将迁移 ${summary}`)
      } else pushLog(`[dry-run] 失败: ${r.error}`)
    } catch (e) { pushLog(`[dry-run] 异常: ${String(e)}`) }
    setBusy(null)
    await refresh()
  }

  const runReal = async () => {
    if (!window.confirm('将把主表错题数据复制到插件命名空间表（自动备份，源表保留）。继续？')) return
    setBusy('migrate')
    try {
      const r = await quizMigrateToPlugin({ dryRun: false, backup: true })
      if (r.ok) {
        const summary = Object.entries(r.moved ?? {}).map(([t, n]) => `${t}: ${n}`).join('，')
        pushLog(`[迁移] 完成 ${summary}${r.backupPath ? `\n备份: ${r.backupPath}` : ''}`)
        showToast({ type: 'info', message: '迁移完成，备份已生成' })
      } else pushLog(`[迁移] 失败: ${r.error}`)
    } catch (e) { pushLog(`[迁移] 异常: ${String(e)}`) }
    setBusy(null)
    await refresh()
  }

  const runRollback = async () => {
    if (!window.confirm('将把插件命名空间表的数据反向写回主表（覆盖同 key）。继续？')) return
    setBusy('rollback')
    try {
      const r = await quizMigrateFromPlugin()
      if (r.ok) {
        const summary = Object.entries(r.moved ?? {}).map(([t, n]) => `${t}: ${n}`).join('，')
        pushLog(`[回滚] 完成 ${summary}`)
        showToast({ type: 'info', message: '已从插件表回滚到主表' })
      } else pushLog(`[回滚] 失败: ${r.error}`)
    } catch (e) { pushLog(`[回滚] 异常: ${String(e)}`) }
    setBusy(null)
    await refresh()
  }

  const runExport = async () => {
    setBusy('export')
    try {
      const r = await quizMigrateExport()
      if (r.ok) { pushLog(`[导出] 主表已备份: ${r.path}`); showToast({ type: 'info', message: '备份已导出' }) }
      else pushLog(`[导出] 失败: ${r.error}`)
    } catch (e) { pushLog(`[导出] 异常: ${String(e)}`) }
    setBusy(null)
  }

  const runDrop = async () => {
    if (!window.confirm('将删除插件命名空间表（plugin_knowbase_quizbook_*）。建议先导出备份。确认？')) return
    setBusy('drop')
    try {
      const r = await quizMigrateDropPluginData()
      pushLog(r.ok ? '[清理] 插件表已删除' : `[清理] 失败: ${r.error}`)
    } catch (e) { pushLog(`[清理] 异常: ${String(e)}`) }
    setBusy(null)
    await refresh()
  }

  const tables = ['records', 'collections', 'record_collections', 'tags', 'record_tags']

  return (
    <div className="absolute inset-0 z-[60] bg-[var(--bg-primary)] flex flex-col">
      <div className="shrink-0 flex items-center gap-3 px-4 h-11 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <Database size={14} className="text-[var(--accent)]" />
        <span className="text-[13px] font-medium text-[var(--text-primary)]">错题本数据迁移（P2）</span>
        <span className="text-[10px] text-[var(--text-disabled)]">主表 ⇄ 插件命名空间表</span>
        <div className="flex-1" />
        <button onClick={() => void refresh()} title="刷新状态" className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <RefreshCw size={13} />
        </button>
        <button onClick={onClose} className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <X size={14} />
          关闭
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
        {/* 状态对比 */}
        <section>
          <h3 className="text-[12px] font-medium text-[var(--text-secondary)] mb-2">数据行数对比（主表 / 插件表）</h3>
          <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                  <th className="text-left px-3 py-1.5 font-medium">表</th>
                  <th className="text-right px-3 py-1.5 font-medium">主表</th>
                  <th className="text-right px-3 py-1.5 font-medium">插件表</th>
                </tr>
              </thead>
              <tbody>
                {tables.map(t => (
                  <tr key={t} className="border-t border-[var(--border-color)]/60">
                    <td className="px-3 py-1.5 text-[var(--text-primary)] font-mono">{t}</td>
                    <td className="px-3 py-1.5 text-right text-[var(--text-primary)]">{status?.main[t] ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right text-[var(--text-primary)]">{status?.plugin[t] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
            插件表{status?.pluginTablesExist ? '已建表' : '未建表（执行迁移时自动创建）'}；目标表前缀
            <code className="mx-1 px-1 py-px rounded bg-[var(--bg-hover)]">plugin_knowbase_quizbook_*</code>
          </p>
        </section>

        {/* 操作 */}
        <section className="flex flex-wrap gap-2">
          <button
            onClick={() => void runDry()}
            disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
          >
            <Database size={13} /> 迁移预览（dry-run）
          </button>
          <button
            onClick={() => void runReal()}
            disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-[12px] hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <ArrowDownToLine size={13} /> 迁移到插件表
          </button>
          <button
            onClick={() => void runRollback()}
            disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
          >
            <ArrowUpFromLine size={13} /> 回滚到主表
          </button>
          <button
            onClick={() => void runExport()}
            disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
          >
            <Download size={13} /> 导出备份
          </button>
          <button
            onClick={() => void runDrop()}
            disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--danger)]/40 text-[12px] text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40 transition-colors"
          >
            <Trash2 size={13} /> 清空插件表
          </button>
        </section>

        {/* 日志 */}
        {log.length > 0 && (
          <section>
            <h3 className="text-[12px] font-medium text-[var(--text-secondary)] mb-2">操作日志</h3>
            <pre className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
              {log.join('\n')}
            </pre>
          </section>
        )}
      </div>
    </div>
  )
}
