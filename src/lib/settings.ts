/**
 * 集中式 Settings Schema —— 所有设置 key、默认值、类型，以及 UI 选项列表统一在此定义。
 * 新增一个 setting 只需在这里加一行，前后端自动获得类型安全。
 */

// ===== 选项列表（供 UI 渲染） =====

export const THEME_OPTIONS = [
  { id: 'dark',  label: '深色' },
  { id: 'light', label: '浅色' },
] as const

export const FONT_OPTIONS = [
  { id: 'system', label: '系统默认', sample: 'System UI' },
  { id: 'yahei',  label: '微软雅黑', sample: 'Microsoft YaHei' },
  { id: 'noto',   label: '思源黑体', sample: 'Noto Sans SC' },
  { id: 'mono',   label: '等宽字体', sample: 'Cascadia Code' },
] as const

/** 字体 ID → CSS font-family */
export const FONT_CSS_MAP: Record<string, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  yahei:  "'Microsoft YaHei', '微软雅黑', sans-serif",
  noto:   "'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  mono:   "'Cascadia Code', 'Fira Code', 'Consolas', 'Microsoft YaHei', monospace",
}

export const ENCODING_OPTIONS = [
  { id: 'utf-8',   label: 'UTF-8',   desc: '国际通用' },
  { id: 'gbk',     label: 'GBK',     desc: 'Windows 默认' },
  { id: 'gb2312',  label: 'GB2312',  desc: '简体中文' },
] as const

export const ICON_SIZE_OPTIONS = [
  { id: 's', label: '小' },
  { id: 'm', label: '中' },
  { id: 'l', label: '大' },
] as const

// ===== 设置定义 =====

export const SETTINGS = {
  // ---- 外观 ----
  theme:             { default: 'dark',       desc: '界面主题' },
  editorFont:        { default: 'system',     desc: '编辑器字体' },

  // ---- 编辑器 ----
  showLineNumbers:   { default: true,         desc: '编辑器显示行号' },
  zoom:              { default: 1.0,          desc: '界面缩放比例' },

  // ---- 导出 ----
  exportEncoding:    { default: 'utf-8',      desc: '导出文件编码' },

  // ---- 删除确认 ----
  skipDeleteConfirm_blog:                { default: false, desc: '跳过博客删除确认' },
  skipDeleteConfirm_knowledge:           { default: false, desc: '跳过知识库页面删除确认' },
  skipDeleteConfirm_knowledgeCategory:   { default: false, desc: '跳过目录/笔记本删除确认' },
  skipDeleteConfirm_chapter:             { default: false, desc: '跳过章节删除确认' },

  // ---- 回收站 ----
  trashExportDir:           { default: '',   desc: '回收站文件导出目录' },
  recycleBinRetentionDays:  { default: 30,   desc: '回收站保留天数' },

  // ---- 日程 ----
  scheduleIconSize:  { default: 'm',         desc: '日程图标大小' },

  // ---- 边栏宽度 ----
  sidebarWidth_blog:             { default: 240, desc: '博客边栏宽度' },
  sidebarWidth_schedule:         { default: 240, desc: '日程边栏宽度' },
  sidebarWidth_knowledgeCat:     { default: 240, desc: '知识库分类栏宽度' },
  sidebarWidth_knowledgePages:   { default: 240, desc: '知识库页面栏宽度' },
  sidebarWidth_knowledgeChapters:{ default: 240, desc: '知识库章节栏宽度' },

  // ---- 行为参数 ----
  autoSaveDebounceMs:     { default: 2000, desc: '编辑器自动保存防抖(ms)' },
  exportStatusClearMs:    { default: 5000, desc: '导出成功提示停留(ms)' },

  // ---- 缩放约束 ----
  zoomMin:   { default: 0.85, desc: '缩放下限' },
  zoomMax:   { default: 1.5,  desc: '缩放上限' },
  zoomStep:  { default: 0.05, desc: '缩放步进' },
}

// ===== 边栏面板约束（组件 default/min/max，非用户可改，集中引用） =====

export const PANEL_CONSTRAINTS = {
  sidebarWidth_blog:              { default: 224, min: 160, max: 450 },
  sidebarWidth_schedule:          { default: 280, min: 220, max: 450 },
  sidebarWidth_knowledgeCat:      { default: 240, min: 180, max: 400 },
  sidebarWidth_knowledgePages:    { default: 240, min: 180, max: 400 },
  sidebarWidth_knowledgeChapters: { default: 240, min: 180, max: 400 },
} as const

// ===== 类型工具 =====

/** 所有设置 key 的联合类型 */
export type SettingsKey = keyof typeof SETTINGS

/** 单个 key 对应的值类型 */
export type SettingsValue<K extends SettingsKey> = typeof SETTINGS[K]['default']

/** 完整的设置对象类型 */
export type AppSettings = { [K in SettingsKey]: SettingsValue<K> }

/** 所有设置的默认值 */
export const SETTINGS_DEFAULTS: AppSettings = Object.fromEntries(
  Object.entries(SETTINGS).map(([k, v]) => [k, (v as { default: unknown }).default])
) as AppSettings
