import { useState } from 'react'
import { Columns2, ChevronDown, PanelRightClose } from 'lucide-react'

/**
 * 分屏副栏顶条（R1-W3 · Editor Groups v1）
 * 显示副栏当前模块 + 模块切换下拉（排除主栏与自身，避免同模块双实例）+ 关闭分屏
 */
export interface SplitTarget {
  id: string
  label: string
}

interface Props {
  currentLabel: string
  targets: SplitTarget[]
  onSwitch: (id: string) => void
  onClose: () => void
}

export function SplitPaneBar({ currentLabel, targets, onSwitch, onClose }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
      <Columns2 size={12} className="shrink-0 text-[var(--text-muted)]" />
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          title="切换副栏模块"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <span className="max-w-[120px] truncate">{currentLabel}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
        {open && (
          <div
            className="absolute left-0 top-full z-40 mt-1 w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-xl"
            onMouseLeave={() => setOpen(false)}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--text-disabled)]">在副栏打开</div>
            {targets.map((t) => (
              <button
                key={t.id}
                onClick={() => { setOpen(false); onSwitch(t.id) }}
                className="w-full px-3 py-1 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1" />
      <button onClick={onClose} title="关闭分屏" className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
        <PanelRightClose size={13} />
      </button>
    </div>
  )
}
