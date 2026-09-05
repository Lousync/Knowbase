import { useEffect, useState } from 'react'
import { ChevronsDown, Shrink, Minus, Square, Copy, X } from 'lucide-react'

interface Props {
  /** 当前禅模式档位（1=专注 2=禅） */
  zenLevel: number
  onZenLevelChange: (n: number) => void
  /** 当前编辑文件名（可空） */
  fileName?: string
}

/**
 * 禅模式 Z2+ 顶部热区：标题栏隐藏后，窗口顶部保留 8px 可拖动热区，
 * 鼠标移入淡出唤出控制条（窗口三键 + 降档 + 退出禅模式）。
 * 规格：docs/zen-mode-design.md §4/§6-4。淡出用 transition-opacity，不依赖 transitionend（§7-5）。
 */
export function ZenHotZone({ zenLevel, onZenLevelChange, fileName }: Props) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api?.isMaximized?.().then(setIsMaximized)
    window.api?.onMaximizeChange?.((v: boolean) => setIsMaximized(v))
  }, [])

  return (
    <div className="group fixed inset-x-0 top-0 z-[90] h-2 drag-region">
      {/* 唤出条：hover 淡入（8px 热区触发，鼠标进入条内保持 hover 链） */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-9 items-center gap-2 border-b border-[var(--border-color)] bg-[color-mix(in_srgb,var(--bg-tertiary)_88%,transparent)] px-3 opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
        <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)] select-none">
          <Shrink size={12} className="text-[var(--accent)]" />
          禅模式 · {zenLevel === 2 ? '禅' : '专注'}
          {fileName && <span className="max-w-[240px] truncate text-[var(--text-secondary)]">· {fileName}</span>}
        </span>

        <div className="ml-auto flex items-center gap-0.5 no-drag">
          <button
            onClick={() => onZenLevelChange(Math.max(1, zenLevel - 1))}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="降一档"
          >
            <ChevronsDown size={12} />降档
          </button>
          <button
            onClick={() => onZenLevelChange(0)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="退出禅模式 (Esc)"
          >
            <X size={12} />退出禅模式
          </button>
          <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
          {/* 窗口三键：标题栏隐藏后的最小可用窗口控制（§7-4） */}
          <button onClick={() => window.api?.minimize()} title="最小化" className="rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <Minus size={13} />
          </button>
          <button onClick={() => window.api?.maximize()} title={isMaximized ? '还原' : '最大化'} className="rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            {isMaximized ? <Copy size={11} /> : <Square size={11} />}
          </button>
          <button onClick={() => window.api?.close()} title="关闭" className="rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--danger)] hover:text-white">
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
