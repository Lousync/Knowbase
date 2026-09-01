import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { consumePendingAnchor, subscribePendingAnchor } from '../sections'

interface Props {
  title: string
  /** 列表条数，显示在标题右侧 */
  count?: number
  /** 所属设置项锚点 id；搜索跳转到该锚点时自动展开本组 */
  anchorId?: string
  defaultOpen?: boolean
  /** 标题字号样式：默认小节标题（12px 大写），大标题场景传 h2 样式 */
  titleClassName?: string
  /** 标题行右侧的附加控件（如刷新按钮） */
  headerRight?: React.ReactNode
  children: React.ReactNode
}

/**
 * 设置页的可折叠列表分组，默认收起，避免一屏被长枚举占满。
 * 搜索跳转的目标锚点落在收起分组内时自动展开。
 */
export function CollapseList({
  title, count, anchorId, defaultOpen = false, titleClassName, headerRight, children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)

  // 消费待跳转锚点：挂载时查一次（覆盖切换大项后的重挂载），订阅后续跳转（覆盖停留本页时的二次跳转）
  useEffect(() => {
    if (anchorId && consumePendingAnchor(anchorId)) setOpen(true)
    return subscribePendingAnchor(id => { if (anchorId && id === anchorId) setOpen(true) })
  }, [anchorId])

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 mb-3 group text-left"
      >
        <ChevronRight size={12} className={`text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
        <h3 className={titleClassName ?? 'text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide group-hover:text-[var(--text-primary)]'}>
          {title}
        </h3>
        {typeof count === 'number' && (
          <span className="text-[10px] text-[var(--text-disabled)]">({count})</span>
        )}
        {headerRight && <span className="ml-auto shrink-0">{headerRight}</span>}
      </button>
      {open && children}
    </div>
  )
}
