import React from 'react'
import { useSettings } from '../../lib/SettingsContext'
import { useSidebarIconNode, type IconModuleId } from '../../lib/sidebarIcons'

/**
 * 统一风格的手绘模块图标（24px 视口、圆角描边）。
 * 全部继承 currentColor，配合主题的 accent / muted 颜色使用。
 */

interface IconProps {
  size?: number
  className?: string
}

function Svg({ size = 24, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 博客：带折角的文档 + 两行文字 */
function BlogIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h7.2L17.5 7.8V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
      <path d="M13.2 3.6v4.2h4.3" />
      <path d="M9 12h6.5" />
      <path d="M9 15.5h4" />
    </Svg>
  )
}

/** 日程：带对勾的日历 */
function ScheduleIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Z" />
      <path d="M4.5 9.5h15" />
      <path d="M8.5 3.5v3.2" />
      <path d="M15.5 3.5v3.2" />
      <path d="M9 14.2l2.1 2.1 4-4.6" />
    </Svg>
  )
}

/** 知识库：文件夹 */
function KnowledgeIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l1.8 2h8a1.5 1.5 0 0 1 1.5 1.5V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17V7.5Z" />
      <path d="M7.5 11.5h6.5" />
      <path d="M7.5 14.5h9" />
    </Svg>
  )
}

/** 说说：微信风格气泡 + 三点 */
function MomentsIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-3.5 3.2a.55.55 0 0 1-.94-.39V17H6.5A2.5 2.5 0 0 1 4 14.5v-8Z" />
      <path d="M8.5 10.5h.01" strokeWidth={2.4} />
      <path d="M12 10.5h.01" strokeWidth={2.4} />
      <path d="M15.5 10.5h.01" strokeWidth={2.4} />
    </Svg>
  )
}

/** 工具箱：工具箱 */
function ToolboxIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 9V6.7c0-.8.5-1.45 1.2-1.75l2-.9c.65-.3 1.35.05 1.65.7l.7 1.5c.2.4.3.85.3 1.3V9" />
      <path d="M4.15 12.55c-.15.95.4 1.95 1.4 1.95h12.9c1 0 1.55-1 1.4-1.95l-.95-5.4c-.15-.9-.95-1.6-1.85-1.6H6.95c-.9 0-1.7.7-1.85 1.6l-.95 5.4Z" />
    </Svg>
  )
}

/** 导出：托盘 + 向上箭头 */
function ExportIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5v9" />
      <path d="M8.5 8 12 4.5 15.5 8" />
      <path d="M5 14.5v2.5A1.5 1.5 0 0 0 6.5 18.5h11a1.5 1.5 0 0 0 1.5-1.5v-2.5" />
    </Svg>
  )
}

/** 回收站：垃圾桶 */
function RecycleIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.75 11a1.5 1.5 0 0 0 1.5 1.4h6.5a1.5 1.5 0 0 0 1.5-1.4l.75-11" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </Svg>
  )
}

/** 帮助：问号 */
function HelpIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.3 1-1.3 1.9" />
      <path d="M12 17.2h.01" strokeWidth={2.4} />
    </Svg>
  )
}

/** 用户：人像 */
function UserIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5 20c1.15-2.95 3.7-4.4 7-4.4s5.85 1.45 7 4.4" />
    </Svg>
  )
}

/** 设置：调节滑杆 */
function SettingsIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M1.5 14h5" />
      <path d="M9.5 8h5" />
      <path d="M17.5 16h5" />
    </Svg>
  )
}

/** 插件：拼图块——圆角主体 + 顶部凸起 + 右侧凹槽 */
function PluginIconHandDrawn(props: IconProps) {
  return (
    <Svg {...props}>
      {/* 轮廓：四圆角主体，顶部中央凸出半圆，右侧中央内陷半圆 */}
      <path d="
        M 6 7
        a 1 1 0 0 1 1 -1
        h 3
        a 2 2 0 0 0 4 0
        h 3
        a 1 1 0 0 1 1 1
        v 2.5
        a 1.5 1.5 0 0 1 0 3
        V 15
        a 1 1 0 0 1 -1 1
        h -10
        a 1 1 0 0 1 -1 -1
        V 7
        Z
      " />
      {/* 中心连接点：实心小圆点，呼应"接入/扩展"语义 */}
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  )
}
// ===== 风格感知包装(设置→外观→侧边栏图标;default 走上方手绘实现) =====

function StyleAware({ moduleId, Fallback, size = 24, className }: IconProps & {
  moduleId: IconModuleId
  Fallback: (props: IconProps) => React.ReactElement
}) {
  const { s } = useSettings()
  const node = useSidebarIconNode(s.sidebarIconStyle ?? 'default', moduleId, size, className)
  if (node) return <>{node}</>
  return <Fallback size={size} className={className} />
}

const HAND_DRAWN: Record<IconModuleId, (props: IconProps) => React.ReactElement> = {
  blog: BlogIconHandDrawn,
  schedule: ScheduleIconHandDrawn,
  knowledge: KnowledgeIconHandDrawn,
  moments: MomentsIconHandDrawn,
  toolbox: ToolboxIconHandDrawn,
  plugins: PluginIconHandDrawn,
  recycle: RecycleIconHandDrawn,
  help: HelpIconHandDrawn,
  user: UserIconHandDrawn,
  settings: SettingsIconHandDrawn,
  export: ExportIconHandDrawn,
}

export function BlogIcon(props: IconProps) { return <StyleAware moduleId="blog" Fallback={BlogIconHandDrawn} {...props} /> }
export function ScheduleIcon(props: IconProps) { return <StyleAware moduleId="schedule" Fallback={ScheduleIconHandDrawn} {...props} /> }
export function KnowledgeIcon(props: IconProps) { return <StyleAware moduleId="knowledge" Fallback={KnowledgeIconHandDrawn} {...props} /> }
export function MomentsIcon(props: IconProps) { return <StyleAware moduleId="moments" Fallback={MomentsIconHandDrawn} {...props} /> }
export function ToolboxIcon(props: IconProps) { return <StyleAware moduleId="toolbox" Fallback={ToolboxIconHandDrawn} {...props} /> }
export function ExportIcon(props: IconProps) { return <StyleAware moduleId="export" Fallback={ExportIconHandDrawn} {...props} /> }
export function RecycleIcon(props: IconProps) { return <StyleAware moduleId="recycle" Fallback={RecycleIconHandDrawn} {...props} /> }
export function HelpIcon(props: IconProps) { return <StyleAware moduleId="help" Fallback={HelpIconHandDrawn} {...props} /> }
export function UserIcon(props: IconProps) { return <StyleAware moduleId="user" Fallback={UserIconHandDrawn} {...props} /> }
export function SettingsIcon(props: IconProps) { return <StyleAware moduleId="settings" Fallback={SettingsIconHandDrawn} {...props} /> }
export function PluginIcon(props: IconProps) { return <StyleAware moduleId="plugins" Fallback={PluginIconHandDrawn} {...props} /> }

/** 任意包预览:设置→外观 的图标选择器用它渲染每个包的效果 */
export function IconPreview({ moduleId, packId, size = 24, className }: { moduleId: IconModuleId; packId: string } & IconProps) {
  const node = useSidebarIconNode(packId, moduleId, size, className)
  if (node) return <>{node}</>
  const Fallback = HAND_DRAWN[moduleId]
  return Fallback ? <Fallback size={size} className={className} /> : null
}
