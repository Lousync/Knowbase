import { useCallback, useEffect, useState } from 'react'
import { X, Database, Download, Trash2, RefreshCw } from 'lucide-react'
import type { QuizMigrateStatus } from '../../../types'
import { quizMigrateStatus, quizMigrateExport, quizMigrateDropPluginData } from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

/**
 * 错题本插件数据面板（JSON 版）：
 * 原为「主表 ⇄ 插件命名空间表」迁移面板（P2），sql.js 主表退役后仅保留
 * 插件数据（JSON 桶）的状态查看 / 导出备份 / 清空三个操作。
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

  const runExport = async () => {
    setBusy('export')
    try {
      const r = await quizMigrateExport()
      if (r.ok) { pushLog(`[导出] 插件数据已备份: ${r.path}`); showToast({ type: 'info', message: '备份已导出' }) }
      else pushLog(`[导出] 失败: ${r.error}`)
    } catch (e) { pushLog(`[导出] 异常: ${String(e)}`) }
    setBusy(null)
  }

  const runDrop = async () => {
    if (!window.confirm('将清空错题本插件的 JSON 数据桶。建议先导出备份。确认？')) return
    setBusy('drop')
    try {
      const r = await quizMigrateDropPluginData()
      pushLog(r.ok ? '[清理] 插件数据已清空' : `[清理] 失败: ${r.error}`)
    } catch (e) { pushLog(`[清理] 异常: ${String(e)}`) }
    setBusy(null)
    await refresh()
  }

  const tables = ['records', 'collections', 'record_collections', 'tags', 'record_tags']

  return (
    <div className="absolute inset-0 z-[60] bg-[var(--bg-primary)] flex flex-col">
      <div className="shrink-0 flex items-center gap-3 px-4 h-11 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <Database size={14} className="text-[var(--accent)]" />
        <span className="text-[13px] font-medium text-[var(--text-primary)]">错题本插件数据</span>
        <span className="text-[10px] text-[var(--text-disabled)]">JSON 存储（userData/data/plugin-data.json）</span>
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
        {/* 状态 */}
        <section>
          <h3 className="text-[12px] font-medium text-[var(--text-secondary)] mb-2">各表数据行数</h3>
          <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                  <th className="text-left px-3 py-1.5 font-medium">表</th>
                  <th className="text-right px-3 py-1.5 font-medium">行数</th>
                </tr>
              </thead>
              <tbody>
                {tables.map(t => (
                  <tr key={t} className="border-t border-[var(--border-color)]/60">
                    <td className="px-3 py-1.5 text-[var(--text-primary)] font-mono">{t}</td>
                    <td className="px-3 py-1.5 text-right text-[var(--text-primary)]">{status?.plugin[t] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
            存储于 JSON 桶
            <code className="mx-1 px-1 py-px rounded bg-[var(--bg-hover)]">plugin_knowbase_quizbook_*</code>
            （原主表 ⇄ 插件表迁移通道已随 sql.js 退役删除）
          </p>
        </section>

        {/* 操作 */}
        <section className="flex flex-wrap gap-2">
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
            <Trash2 size={13} /> 清空插件数据
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
