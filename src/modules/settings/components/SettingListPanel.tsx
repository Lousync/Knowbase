import { useEffect, useRef, useState } from 'react'

export interface SettingListTag {
  label: string
  /** default = 灰边框 / muted；success = 绿（只读）；warning = 橙（写入） */
  tone?: 'default' | 'success' | 'warning'
}

export interface SettingListItem {
  id: string
  label: string
  icon?: React.ReactNode
  /** 单行右侧的标签簇，水平排列、紧凑（只读 / 写入 / 模块等） */
  tags?: SettingListTag[]
  /** 选中/悬停某项时，底部详情区显示的说明 */
  desc?: string
}

interface Props {
  title?: string
  description?: string
  items: SettingListItem[]
  /** 初始选中项 id；不传则默认第一项 */
  defaultSelectedId?: string
  titleClassName?: string
  /** 容器最大宽度（默认 max-w-md） */
  maxWidthClassName?: string
  /** 列表最大高度（启用后内部可滚动），默认不限制 */
  maxListHeightClassName?: string
}

/**
 * 设置页的只读列表面板：与 SettingSelect 的 listbox 视觉一致，
 * 但语义上不接受 onChange —— 适合"内置工具 / MCP 工具 / Skill 提示词"等
 * 只想展示「每个条目 + 详情」的场合。
 *
 * - 标题 + 描述常驻在面板外
 * - 面板内每行单行紧凑：图标 + label + 右侧 tags；row 间用 border-t 分隔
 * - 鼠标悬停或键盘 ↑/↓ 切换高亮项
 * - 面板底部详情区显示当前高亮项的 desc（无 desc 时该行不显示，避免空态）
 */
export function SettingListPanel({
  title, description, items, defaultSelectedId,
  titleClassName, maxWidthClassName = 'max-w-md', maxListHeightClassName,
}: Props) {
  const [activeId, setActiveId] = useState<string>(
    defaultSelectedId ?? items[0]?.id ?? '',
  )
  const listRef = useRef<HTMLDivElement>(null)

  // 外部默认项变化时（如设置异步加载完成）重新对齐
  useEffect(() => {
    if (defaultSelectedId && items.some(i => i.id === defaultSelectedId)) {
      setActiveId(defaultSelectedId)
    } else if (!items.some(i => i.id === activeId) && items[0]) {
      setActiveId(items[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSelectedId, items])

  const move = (delta: number) => {
    if (items.length === 0) return
    const idx = items.findIndex(i => i.id === activeId)
    const next = items[(idx + delta + items.length) % items.length]
    if (next) setActiveId(next.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home') { e.preventDefault(); if (items[0]) setActiveId(items[0].id) }
    else if (e.key === 'End') { e.preventDefault(); const last = items[items.length - 1]; if (last) setActiveId(last.id) }
  }

  const active = items.find(i => i.id === activeId)

  const tagClass = (tone: SettingListTag['tone']) => {
    if (tone === 'success') return 'border-emerald-700/40 text-emerald-400'
    if (tone === 'warning') return 'border-orange-700/40 text-orange-400'
    return 'border-[var(--border-color)] text-[var(--text-muted)]'
  }

  return (
    <div>
      {title && (
        <h3 className={titleClassName ?? 'text-[13px] font-medium text-[var(--text-primary)]'}>{title}</h3>
      )}
      {description && (
        <p className={`text-[11px] text-[var(--text-muted)] ${title ? 'mt-0.5' : ''}`}>{description}</p>
      )}

      <div
        className={`relative mt-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden ${maxWidthClassName}`}
        onKeyDown={onKeyDown}
      >
        <div
          ref={listRef}
          role="listbox"
          aria-label={title}
          tabIndex={0}
          className={`overflow-y-auto ${maxListHeightClassName ?? ''}`}
        >
          {items.map((it, i) => {
            const isActive = it.id === activeId
            return (
              <div
                key={it.id}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActiveId(it.id)}
                onFocus={() => setActiveId(it.id)}
                tabIndex={-1}
                className={`flex items-center gap-2 px-3.5 py-2 cursor-default outline-none transition-colors ${
                  i > 0 ? 'border-t border-[var(--border-color)]' : ''
                } ${isActive ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'}`}
              >
                {it.icon && <span className="shrink-0 text-[var(--accent)]">{it.icon}</span>}
                <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--text-primary)]">{it.label}</span>
                {it.tags && it.tags.length > 0 && (
                  <span className="flex items-center gap-1 shrink-0">
                    {it.tags.map((tg, k) => (
                      <span
                        key={k}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${tagClass(tg.tone)}`}
                      >
                        {tg.label}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )
          })}
          {items.length === 0 && (
            <p className="text-[12px] text-[var(--text-muted)] px-3.5 py-3">暂无条目</p>
          )}
        </div>

        {active?.desc && (
          <div className="border-t border-[var(--border-color)] px-3.5 py-2 text-[11px] text-[var(--text-muted)] leading-relaxed">
            {active.desc}
          </div>
        )}
      </div>
    </div>
  )
}
