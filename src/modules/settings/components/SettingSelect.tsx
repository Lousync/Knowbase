import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  id: string
  label: string
  /** 悬浮/键盘聚焦时在下拉底部展示的说明 */
  desc?: string
  icon?: React.ReactNode
  /** 出厂默认值：下拉中该选项右侧显示「默认」角标 */
  isDefault?: boolean
}

interface Props {
  title: string
  /** 设置项说明，常驻显示在标题下方 */
  description?: string
  options: SelectOption[]
  value: string
  onChange: (id: string) => void
  titleClassName?: string
}

/**
 * VS Code 设置风格的下拉选择器：标题 + 说明常驻，
 * 下方是一个显示当前值的下拉框，点开为悬浮选项列表
 * （悬浮/方向键高亮，底部显示该项说明），选中即生效并收起。
 */
export function SettingSelect({
  title, description, options, value, onChange, titleClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState(value)
  const rootRef = useRef<HTMLDivElement>(null)

  // 打开期间：点击面板外或按 Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openList = () => { setActiveId(value); setOpen(true) }

  const move = (delta: number) => {
    const idx = options.findIndex(o => o.id === activeId)
    const next = options[(idx + delta + options.length) % options.length]
    if (next) setActiveId(next.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const target = options.find(o => o.id === activeId)
      if (target) { onChange(target.id); setOpen(false) }
    }
  }

  const current = options.find(o => o.id === value)
  const active = options.find(o => o.id === activeId)

  return (
    <div ref={rootRef} className="relative">
      <h3 className={titleClassName ?? 'text-[13px] font-medium text-[var(--text-primary)]'}>{title}</h3>
      {description && (
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{description}</p>
      )}

      <div className="relative max-w-md mt-2">
        {/* 下拉框：显示当前值 */}
        <button
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] text-[var(--text-primary)] outline-none hover:border-[var(--text-disabled)] focus:border-[var(--accent)] transition-colors"
        >
          <span className="flex items-center gap-2 truncate">
            {current?.icon && <span className="shrink-0 text-[var(--text-muted)]">{current.icon}</span>}
            <span className="truncate">{current?.label ?? '—'}</span>
          </span>
          <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* 悬浮选项列表 */}
        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-lg overflow-hidden">
            <div role="listbox" className="max-h-[260px] overflow-y-auto py-1">
              {options.map(o => {
                const isActive = o.id === activeId
                return (
                  <button
                    key={o.id}
                    role="option"
                    aria-selected={o.id === value}
                    onMouseEnter={() => setActiveId(o.id)}
                    onClick={() => { onChange(o.id); setOpen(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
                      isActive ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {o.icon && <span className="shrink-0 text-[var(--text-muted)]">{o.icon}</span>}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.isDefault && (
                      <span className="shrink-0 text-[10px] text-[var(--text-disabled)]">默认</span>
                    )}
                    {o.id === value && <Check size={13} className="shrink-0 text-[var(--accent)]" />}
                  </button>
                )
              })}
            </div>
            {active?.desc && (
              <div className="px-3 py-2 border-t border-[var(--border-color)] text-[11px] text-[var(--text-muted)]">
                {active.desc}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
