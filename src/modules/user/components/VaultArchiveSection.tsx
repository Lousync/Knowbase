import { useEffect, useRef, useState } from 'react'
import { Archive, X } from 'lucide-react'
import {
  vaultArchiveExport, vaultArchiveImportStart, vaultArchiveImportDecide, vaultArchiveImportCancel,
} from '../../../lib/ipc'
import type { VaultArchiveConflictItem, VaultArchiveDecision } from '../../../types'
import { showToast } from '../../../lib/toast'

/**
 * 整仓归档（P6/D5）：导出当前仓库为 zip（含 .knowbase/.attachments 全部）；
 * 导入时冲突逐条决策（覆盖/跳过/重命名）——批量按钮 + 单条修改。
 */
export function VaultArchiveSection() {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [conflicts, setConflicts] = useState<VaultArchiveConflictItem[] | null>(null)
  const [decisions, setDecisions] = useState<Record<string, 'overwrite' | 'skip' | 'rename'>>({})
  const decidingRef = useRef(false)

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const res = await vaultArchiveExport()
      if (res && res.ok) showToast({ type: 'info', message: `已导出 ${res.files} 个文件：${res.path}` })
      else if (res && res.error) showToast({ type: 'error', message: res.error })
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    if (importing || conflicts) return
    setImporting(true)
    try {
      const res = await vaultArchiveImportStart()
      if (!res) return
      if ('pending' in res && res.pending) {
        setConflicts(res.conflicts)
        // 默认动作：覆盖（zip 是较新的完整快照）
        const d: Record<string, 'overwrite' | 'skip' | 'rename'> = {}
        for (const c of res.conflicts) d[c.relPath] = 'overwrite'
        setDecisions(d)
      } else if ('canceled' in res && res.canceled) {
        /* 用户取消对话框 */
      } else if (res.ok) {
        finishImportToast(res.written ?? 0, res.skipped ?? 0, res.renamed ?? 0, res.registered)
      } else if (res.error) {
        showToast({ type: 'error', message: res.error })
      }
    } finally {
      setImporting(false)
    }
  }

  const finishImportToast = (written: number, skipped: number, renamed: number, registered?: string) => {
    const where = registered === 'new' ? '（已登记为新仓库并切换）' : registered === 'current' ? '（合并进当前仓库）' : registered === 'existing' ? '（合并进已有仓库，可从切换器打开）' : ''
    showToast({ type: 'info', message: `导入完成：写入 ${written}（重命名 ${renamed}）、跳过 ${skipped}${where}。建议重启应用以重建全部索引` })
  }

  const setAll = (action: 'overwrite' | 'skip' | 'rename') => {
    if (!conflicts) return
    const d: Record<string, 'overwrite' | 'skip' | 'rename'> = {}
    for (const c of conflicts) d[c.relPath] = action
    setDecisions(d)
  }

  const submit = async () => {
    if (decidingRef.current || !conflicts) return
    decidingRef.current = true
    const list: VaultArchiveDecision[] = conflicts.map((c) => ({ relPath: c.relPath, action: decisions[c.relPath] ?? 'overwrite' }))
    const res = await vaultArchiveImportDecide(list)
    decidingRef.current = false
    setConflicts(null)
    if (res && res.ok) finishImportToast(res.written ?? 0, res.skipped ?? 0, res.renamed ?? 0, res.registered)
    else showToast({ type: 'error', message: (res && res.error) || '导入失败' })
  }

  const cancelDialog = async () => {
    setConflicts(null)
    await vaultArchiveImportCancel()
  }

  // 组件卸载时若还挂着冲突对话框 → 放弃主进程待决计划
  useEffect(() => () => { if (decidingRef.current === false) void vaultArchiveImportCancel() }, [])

  const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`

  return (
    <div className="pt-4 mt-4 border-t border-[var(--border-color)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Archive size={15} className="text-[var(--text-muted)]" />
          <div>
            <span className="text-[13px] font-semibold">整仓归档</span>
            <p className="text-[10px] text-[var(--text-disabled)]">仓库根全部内容（含 .knowbase 与 .attachments）打包为 zip；导入时冲突可逐条选择</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExport}
            disabled={exporting || importing}
            className="px-2 py-1 rounded-md text-[11.5px] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
          >
            {exporting ? '导出中...' : '导出 zip'}
          </button>
          <button
            onClick={handleImport}
            disabled={exporting || importing}
            className="px-2 py-1 rounded-md text-[11.5px] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
          >
            {importing ? '准备中...' : '导入 zip'}
          </button>
        </div>
      </div>

      {/* 冲突逐条决策弹窗（D5：覆盖/跳过/重命名） */}
      {conflicts && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 kb-overlay" onClick={cancelDialog}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl w-[620px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
              <div className="text-[14px] font-semibold">导入冲突：{conflicts.length} 个文件已存在</div>
              <button onClick={cancelDialog} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"><X size={16} /></button>
            </div>
            <div className="px-5 py-2.5 flex items-center gap-2 border-b border-[var(--border-color)] shrink-0 text-[11.5px]">
              <span className="text-[var(--text-muted)]">批量：</span>
              {(['overwrite', 'skip', 'rename'] as const).map((a) => (
                <button key={a} onClick={() => setAll(a)} className="px-2 py-0.5 rounded border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
                  {a === 'overwrite' ? '全部覆盖' : a === 'skip' ? '全部跳过' : '全部重命名'}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              {conflicts.map((c) => (
                <div key={c.relPath} className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--border-color)]/40 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[12px] truncate" title={c.relPath}>{c.relPath}</div>
                    <div className="text-[10px] text-[var(--text-disabled)]">归档 {kb(c.zipSize)} · 现有 {kb(c.existingSize)}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(['overwrite', 'skip', 'rename'] as const).map((a) => (
                      <label key={a} className={`px-1.5 py-0.5 rounded text-[11px] cursor-pointer border transition-colors ${decisions[c.relPath] === a ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
                        <input type="radio" className="hidden" checked={decisions[c.relPath] === a} onChange={() => setDecisions((prev) => ({ ...prev, [c.relPath]: a }))} />
                        {a === 'overwrite' ? '覆盖' : a === 'skip' ? '跳过' : '重命名'}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border-color)] flex gap-2 shrink-0">
              <button onClick={cancelDialog} className="flex-1 py-1.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-hover)] transition-colors">
                取消导入
              </button>
              <button
                onClick={submit}
                disabled={importing}
                className="flex-1 py-1.5 text-[12px] font-medium bg-[var(--accent)] text-white rounded-md hover:opacity-90 transition-colors disabled:opacity-40"
              >
                按选择导入（共 {conflicts.length} 项冲突）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
