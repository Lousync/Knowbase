import type { ReactNode } from 'react'
import { usePresence } from '../../lib/usePresence'

interface Props {
  open: boolean
  /**
   * 内容以**函数**传入（不是节点）：只有「已展开」或「正在播收起动画」时才求值渲染。
   * 这样既拿到展开/收起两个方向的高度动画，又保持「收起状态不挂载子树」的懒语义——
   * 文件树/笔记本树里成百上千的条目不会因为要用动画就全部进 DOM。
   */
  children: () => ReactNode
  /** 折叠容器附加类（一般不需要） */
  className?: string
  /** 内层容器类，默认 flex flex-col；需要块级布局的调用方可传 '' */
  innerClassName?: string
  /** 退场时长，需与 index.css 的 --dur-std 一致 */
  exitMs?: number
}

/**
 * 高度折叠容器（docs/ui-animation-plan.md C 类）。
 * 动画本体是 index.css 的 .kb-collapse（grid-template-rows 0fr↔1fr）；
 * 收起时子树延迟到动画结束才卸载，且用 visibility 延迟切换避免收起后的按钮/输入行仍可 Tab 聚焦。
 */
export function Collapsible({
  open,
  children,
  className,
  innerClassName = 'flex flex-col',
  exitMs = 220
}: Props) {
  const { mounted } = usePresence(open, exitMs)
  // 外层 grid 容器必须常驻：若随 mounted 一起挂载，展开时元素是以「已展开」状态新建的，
  // grid-template-rows 没有起始态可过渡，展开动画不会播。子内容用 open || mounted 求值，
  // 保证它与 open 类落在同一次提交里（否则 1fr 下无内容可撑，过渡会退化成跳变），
  // 同时收起动画播完即卸载子树，保持「收起不挂载」的懒语义。
  return (
    <div className={`kb-collapse ${open ? 'open' : ''} ${className ?? ''}`}>
      {open || mounted ? <div className={innerClassName}>{children()}</div> : null}
    </div>
  )
}
