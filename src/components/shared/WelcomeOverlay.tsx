import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Folder, Clock, ArrowRight, Database, CheckCircle2 } from 'lucide-react'
import type { WorkspaceRecent } from '../../types'
import { workspaceOpenById, workspaceGetRecent, vaultLegacySummary, vaultImportLegacy, onVaultImportProgress } from '../../lib/ipc'
import { openVaultWithGuide } from '../../lib/vaultOpen'
import { showToast } from '../../lib/toast'

interface Props {
  onDone: () => void
}

interface LegacyInfo {
  hasLegacy: boolean
  pages: number
  blogEntries: number
  attachments: number
  attachmentBytes: number
}

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`

/**
 * 首次启动引导：无「当前仓库」时的全屏选择页（对标 Obsidian 打开 vault）。
 * 选定仓库后检测旧 SQLite 数据 → 提供「导入到当前仓库」入口（去库化 P0）。
 */
export function WelcomeOverlay({ onDone }: Props) {
  const [recent, setRecent] = useState<WorkspaceRecent[]>([])
  const [busy, setBusy] = useState(false)
  const [legacy, setLegacy] = useState<LegacyInfo | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number; message?: string } | null>(null)

  useEffect(() => {
    workspaceGetRecent().then(setRecent).catch(() => {})
  }, [])

  // 选定仓库后：检测旧数据 → 有则先展示导入卡
  const afterOpen = useCallback(async () => {
    try {
      const s = await vaultLegacySummary()
      if (s?.hasLegacy) {
        setLegacy(s)
        return // 等待用户在导入/跳过之间选择
      }
    } catch { /* 无旧库或读取失败 → 直接进入 */ }
    onDone()
  }, [onDone])

  // 导入进度监听（组件存活期间常驻，长任务在后台继续）
  useEffect(() => {
    const un = onVaultImportProgress((p) => {
      setProgress(p)
      if (p.phase === 'done') {
        setImporting(false)
        showToast({ type: 'info', message: p.message || '导入完成' })
        onDone()
      } else if (p.phase === 'error') {
        setImporting(false)
        showToast({ type: 'error', message: p.message || '导入失败' })
      }
    })
    return un
  }, [onDone])

  const openNew = useCallback(async () => {
    setBusy(true)
    try {
      // D7：非仓库目录 → 弹「初始化为仓库？」确认；取消/放弃返回 null，不做任何写入
      const opened = await openVaultWithGuide()
      if (!opened) return
      workspaceGetRecent().then(setRecent).catch(() => {})
      await afterOpen()
    } catch {
      showToast({ type: 'error', message: '打开仓库失败' })
    } finally {
      setBusy(false)
    }
  }, [afterOpen])

  const openRecent = useCallback(async (r: WorkspaceRecent) => {
    setBusy(true)
    try {
      const res = await workspaceOpenById(r.rootId)
      if (res.error) {
        showToast({ type: 'error', message: res.error || '无法打开该仓库' })
        return
      }
      await afterOpen()
    } finally {
      setBusy(false)
    }
  }, [afterOpen])

  const startImport = useCallback(async () => {
    setImporting(true)
    setProgress({ phase: 'plan', current: 0, total: 4, message: '准备导入…' })
    try {
      const r = await vaultImportLegacy({})
      if (!r.started && r.error) {
        setImporting(false)
        showToast({ type: 'error', message: r.error })
      }
    } catch {
      setImporting(false)
      showToast({ type: 'error', message: '启动导入失败' })
    }
  }, [])

  return (
    <div className="fixed inset-x-0 bottom-0 top-9 z-[200] flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="flex w-full max-w-md flex-col items-center gap-6 px-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-secondary)] text-[var(--accent)] shadow-[inset_0_0_0_1px_var(--border-color)]">
            <FolderOpen size={26} />
          </div>
          <div className="text-[15px] font-medium text-[var(--text-primary)]">选择仓库开始</div>
          <div className="text-center text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            仓库是一个文件夹：知识内容直接存放其中，应用数据保存在隐藏的 <code className="rounded bg-[var(--bg-secondary)] px-1 text-[var(--text-primary)]">.knowbase</code> 目录里
          </div>
        </div>

        {legacy && !importing && (
          <div className="flex w-full flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-start gap-2">
              <Database size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-primary)]">检测到旧版本数据</div>
                <div className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  知识 {legacy.pages} 篇 · 博客 {legacy.blogEntries} 篇 · 附件 {legacy.attachments} 个（{mb(legacy.attachmentBytes)}）
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">导入 = 复制到当前仓库（原库自动备份，可回滚）</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void startImport()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[12.5px] text-white transition-opacity hover:opacity-90"
              >
                <Database size={13} />
                导入到当前仓库
              </button>
              <button
                onClick={() => onDone()}
                className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                跳过
              </button>
            </div>
          </div>
        )}

        {importing && (
          <div className="flex w-full flex-col gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
              <CheckCircle2 size={14} className="animate-pulse text-[var(--accent)]" />
              {progress?.message || '正在导入…'}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-hover)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: progress?.total ? `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%` : '8%' }}
              />
            </div>
            <div className="text-[11px] text-[var(--text-tertiary)]">附件较大时耗时较长，可最小化等待，导入完成后自动进入</div>
          </div>
        )}

        {!legacy && (
          <button
            onClick={() => void openNew()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-5 py-3 text-[14px] text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
          >
            <FolderOpen size={18} className="text-[var(--accent)]" />
            打开文件夹作为仓库
          </button>
        )}

        {recent.length > 0 && (
          <div className="w-full">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-muted)]">
              <Clock size={12} />
              最近打开
            </div>
            <div className="flex flex-col gap-1">
              {recent.map((r) => (
                <button
                  key={r.rootId}
                  onClick={() => void openRecent(r)}
                  disabled={busy || importing}
                  className="group flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-60"
                >
                  <Folder size={14} className="shrink-0 text-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="max-w-[45%] truncate text-[11px] text-[var(--text-tertiary)]">{r.path}</span>
                  <ArrowRight size={13} className="shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
