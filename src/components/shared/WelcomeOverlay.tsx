import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Folder, Clock, ArrowRight } from 'lucide-react'
import type { WorkspaceRecent } from '../../types'
import { workspaceOpenById, workspaceGetRecent } from '../../lib/ipc'
import { openVaultWithGuide } from '../../lib/vaultOpen'
import { showToast } from '../../lib/toast'

interface Props {
  onDone: (created?: boolean) => void
}

/**
 * 首次启动引导：无「当前仓库」时的全屏选择页（对标 Obsidian 打开 vault）。
 * R6 去库化收尾：旧 SQLite 数据检测/导入（vaultLegacySummary/vaultImportLegacy）已删除，
 * 数据随仓库文件夹保存，打开仓库即直接进入。
 */
export function WelcomeOverlay({ onDone }: Props) {
  const [recent, setRecent] = useState<WorkspaceRecent[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    workspaceGetRecent().then(setRecent).catch(() => {})
  }, [])

  const afterOpen = useCallback(async (created?: boolean) => {
    onDone(created)
  }, [onDone])

  const openNew = useCallback(async () => {
    setBusy(true)
    try {
      // D7：非仓库目录 → 弹「初始化为仓库？」确认；取消/放弃返回 null，不做任何写入
      const opened = await openVaultWithGuide()
      if (!opened) return
      workspaceGetRecent().then(setRecent).catch(() => {})
      // created=true：首次把目录初始化为仓库 → 父级默认落编辑区
      await afterOpen(true)
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
          <div className="text-center text-[11.5px] text-[var(--text-muted)]">
            第一次使用？在弹出的窗口中选一个位置并「新建文件夹」，然后确认初始化即可
          </div>
        </div>

        <button
          onClick={() => void openNew()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-5 py-3 text-[14px] text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
        >
          <FolderOpen size={18} className="text-[var(--accent)]" />
          打开文件夹作为仓库
        </button>

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
                  disabled={busy}
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
