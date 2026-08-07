import React from 'react'

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
export function BlogIcon(props: IconProps) {
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
export function ScheduleIcon(props: IconProps) {
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
export function KnowledgeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l1.8 2h8a1.5 1.5 0 0 1 1.5 1.5V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17V7.5Z" />
      <path d="M7.5 11.5h6.5" />
      <path d="M7.5 14.5h9" />
    </Svg>
  )
}

/** 说说：微信风格气泡 + 三点 */
export function MomentsIcon(props: IconProps) {
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
export function ToolboxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 9V6.7c0-.8.5-1.45 1.2-1.75l2-.9c.65-.3 1.35.05 1.65.7l.7 1.5c.2.4.3.85.3 1.3V9" />
      <path d="M4.15 12.55c-.15.95.4 1.95 1.4 1.95h12.9c1 0 1.55-1 1.4-1.95l-.95-5.4c-.15-.9-.95-1.6-1.85-1.6H6.95c-.9 0-1.7.7-1.85 1.6l-.95 5.4Z" />
    </Svg>
  )
}

/** 导出：托盘 + 向上箭头 */
export function ExportIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5v9" />
      <path d="M8.5 8 12 4.5 15.5 8" />
      <path d="M5 14.5v2.5A1.5 1.5 0 0 0 6.5 18.5h11a1.5 1.5 0 0 0 1.5-1.5v-2.5" />
    </Svg>
  )
}

/** 回收站：垃圾桶 */
export function RecycleIcon(props: IconProps) {
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
export function HelpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.3 1-1.3 1.9" />
      <path d="M12 17.2h.01" strokeWidth={2.4} />
    </Svg>
  )
}

/** 用户：人像 */
export function UserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5 20c1.15-2.95 3.7-4.4 7-4.4s5.85 1.45 7 4.4" />
    </Svg>
  )
}

/** 设置：调节滑杆 */
export function SettingsIcon(props: IconProps) {
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
