import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { consumePendingAnchor, subscribePendingAnchor } from '../sections'
import { usePresence } from '../../../lib/usePresence'

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
  // 展开/收起动效：常驻到退场动画播完再卸载（保持原有的「收起时不渲染子内容」懒挂载语义，
  // 只是把卸载推迟一个动画时长）。见 docs/ui-animation-plan.md C 类。
  const { mounted } = usePresence(open, 220)

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
        {/* Tailwind v4 的 rotate-90 写的是 rotate 属性，transition-transform 收不到它 →
            统一用 .kb-chevron（同时过渡 transform 与 rotate） */}
        <ChevronRight size={12} className={`kb-chevron text-[var(--text-muted)] ${open ? 'rotate-90' : ''}`} />
        <h3 className={titleClassName ?? 'text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide group-hover:text-[var(--text-primary)]'}>
          {title}
        </h3>
        {typeof count === 'number' && (
          <span className="text-[10px] text-[var(--text-disabled)]">({count})</span>
        )}
        {headerRight && <span className="ml-auto shrink-0">{headerRight}</span>}
      </button>
      {/* 外层 grid 容器常驻、只懒挂载内层子树：随 mounted 一起挂载会让展开变成「已展开」状态下
          新建元素，没有起始态可过渡 → 展开动画不播。子内容用 open || mounted 求值，与 open 类
          同一次提交出现。见 docs/ui-animation-plan.md C 类。 */}
      <div className={`kb-collapse ${open ? 'open' : ''}`}>
        {open || mounted ? <div>{children}</div> : null}
      </div>
    </div>
  )
}
