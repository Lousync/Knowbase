import { Loader2, Check } from 'lucide-react'
import type { ExportMarkdownProgress } from '../../../types'

interface ProgressPanelProps {
  progress: ExportMarkdownProgress | null
  format: string
}

export function ProgressPanel({ progress, format }: ProgressPanelProps) {
  const isMarkdown = format === 'markdown'
  const isDeterminate = isMarkdown && progress && progress.total > 0
  const pct = isDeterminate ? Math.round((progress!.current / progress!.total) * 100) : 0

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-6 w-full max-w-sm">
      <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-4">导出进度</div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden mb-3">
        {isDeterminate ? (
          <div
            className="h-full bg-[var(--accent)] rounded-full transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-[var(--accent)] rounded-full animate-pulse" />
        )}
      </div>

      {/* Status text */}
      <div className="flex items-center gap-2 text-[13px]">
        {isDeterminate ? (
          <>
            <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
            <span className="text-[var(--text-primary)]">
              {progress!.current} / {progress!.total} 个文件
            </span>
            <span className="text-[var(--text-muted)]">({pct}%)</span>
          </>
        ) : (
          <>
            <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
            <span className="text-[var(--text-primary)]">
              {progress?.phase || '正在写入文件...'}
            </span>
          </>
        )}
      </div>

      {/* Current file name (markdown only) */}
      {isDeterminate && progress!.currentFile && (
        <div className="mt-2 text-[11px] text-[var(--text-muted)] truncate max-w-[300px]">
          {progress!.currentFile}
        </div>
      )}
    </div>
  )
}
