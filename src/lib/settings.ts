/**
 * 集中式 Settings Schema —— 所有设置 key、默认值、类型，以及 UI 选项列表统一在此定义。
 * 新增一个 setting 只需在这里加一行，前后端自动获得类型安全。
 */

// ===== 选项列表（供 UI 渲染） =====

export const THEME_OPTIONS = [
  { id: 'dark',  label: '深色' },
  { id: 'light', label: '浅色' },
] as const

/** Apply a theme class to <html> — clears any previous theme-* class, adds the new one.
 *  Call this whenever the user switches themes. New themes only need a new THEME_OPTIONS entry
 *  and a matching `html.theme-<id>` CSS block. */
export function applyThemeClass(themeId: string): void {
  document.documentElement.className = document.documentElement.className
    .split(/\s+/)
    .filter(c => !c.startsWith('theme-'))
    .join(' ')
  document.documentElement.classList.add(`theme-${themeId}`)
}

export const FONT_OPTIONS = [
  { id: 'system',    label: '系统默认',   sample: 'System UI' },
  { id: 'yahei',     label: '微软雅黑',   sample: 'Microsoft YaHei' },
  { id: 'dengxian',  label: '等线',       sample: 'DengXian' },
  { id: 'heiti',     label: '黑体',       sample: 'SimHei' },
  { id: 'noto',      label: '思源黑体',   sample: 'Noto Sans SC' },
  { id: 'notoserif', label: '思源宋体',   sample: 'Noto Serif SC' },
  { id: 'songti',    label: '宋体',       sample: 'SimSun' },
  { id: 'fangsong',  label: '仿宋',       sample: 'FangSong' },
  { id: 'kaiti',     label: '楷体',       sample: 'KaiTi' },
  { id: 'lxgw',      label: '霞鹜文楷',   sample: 'LXGW WenKai' },
  { id: 'times',     label: '西文衬线',   sample: 'Times New Roman' },
  { id: 'mono',      label: '等宽字体',   sample: 'Cascadia Code' },
] as const

/** 字体 ID → CSS font-family（链条末端的兜底保证任何机器都可用） */
export const FONT_CSS_MAP: Record<string, string> = {
  system:    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  yahei:     "'Microsoft YaHei', '微软雅黑', sans-serif",
  dengxian:  "'DengXian', '等线', 'Microsoft YaHei', sans-serif",
  heiti:     "'SimHei', '黑体', 'Microsoft YaHei', sans-serif",
  noto:      "'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  notoserif: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif",
  songti:    "'SimSun', '宋体', 'Noto Serif SC', serif",
  fangsong:  "'FangSong', '仿宋', 'SimSun', serif",
  kaiti:     "'KaiTi', '楷体', 'SimSun', serif",
  lxgw:      "'LXGW WenKai', '霞鹜文楷', 'KaiTi', '楷体', serif",
  times:     "'Times New Roman', Georgia, 'SimSun', serif",
  mono:      "'Cascadia Code', 'Fira Code', 'Consolas', 'Microsoft YaHei', monospace",
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

export const BLOG_SIZE_OPTIONS = [
  { id: 's', label: '紧凑' },
  { id: 'm', label: '标准' },
  { id: 'l', label: '宽松' },
] as const

/** 知识库侧边栏条目大小（树行密度：行高 + 字号） */
export const KNOWLEDGE_SIDEBAR_SIZE_OPTIONS = [
  { id: 's', label: '紧凑' },
  { id: 'm', label: '标准' },
  { id: 'l', label: '宽松' },
] as const

/** 知识库侧边栏条目大小 → CSS 变量（--kb-row-py 树行内边距 / --kb-row-py-lg 章节行内边距 / --kb-row-fs 行字号）。
 *  三档必须拉开足够差距，否则切换时视觉几乎无变化（用户会以为设置无效）。
 *  字号 12/14/18px + 行高递进，紧凑↔标准↔宽松一眼可辨；标准档(m)接近原默认外观。 */
export const KNOWLEDGE_SIDEBAR_ITEM_VARS: Record<string, Record<string, string>> = {
  s: { '--kb-row-py': '0px', '--kb-row-py-lg': '2px', '--kb-row-fs': '12px' },
  m: { '--kb-row-py': '3px', '--kb-row-py-lg': '5px', '--kb-row-fs': '14px' },
  l: { '--kb-row-py': '9px', '--kb-row-py-lg': '12px', '--kb-row-fs': '18px' },
}

export const FONT_SIZE_OPTIONS = [
  { id: 12, label: '12px' },
  { id: 13, label: '13px' },
  { id: 14, label: '14px' },
  { id: 15, label: '15px' },
  { id: 16, label: '16px' },
  { id: 18, label: '18px' },
  { id: 20, label: '20px' },
] as const

// ===== 设置定义 =====

export const SETTINGS = {
  // ---- 外观 ----
  theme:             { default: 'dark',       desc: '界面主题' },
  editorFont:        { default: 'system',     desc: '编辑器字体' },
  deleteFxSkin:      { default: 'builtin',    desc: '删除动画皮肤' },

  // ---- 编辑器 ----
  showLineNumbers:   { default: true,         desc: '编辑器显示行号' },
  editorFontSize:    { default: 13,           desc: '编辑器字号' },
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

  // ---- PDF 阅读 ----
  pdfReaderMode:   { default: 'builtin',     desc: 'PDF 阅读方式: builtin=内置阅读器, external=本地工具打开' },

  // ---- 日程 ----
  scheduleIconSize:  { default: 'm',         desc: '日程图标大小' },

  // ---- 博客 ----
  blogCardSize:       { default: 'm',         desc: '博客卡片大小' },

  // ---- 知识库 ----
  knowledgeSidebarItemSize: { default: 'm',  desc: '知识库侧边栏条目大小（s=紧凑 / m=标准 / l=宽松）' },

  // ---- 边栏宽度 ----
  sidebarWidth_blog:             { default: 240, desc: '博客边栏宽度' },
  sidebarWidth_schedule:         { default: 240, desc: '日程边栏宽度' },
  sidebarWidth_knowledgeCat:     { default: 240, desc: '知识库分类栏宽度' },
  sidebarWidth_knowledgePages:   { default: 240, desc: '知识库页面栏宽度' },
  sidebarWidth_knowledgeChapters:{ default: 240, desc: '知识库章节栏宽度' },
  sidebarWidth_devtools:         { default: 176, desc: '开发者工具边栏宽度' },
  sidebarWidth_devtoolsDocs:     { default: 208, desc: '开发者工具帮助文档列表栏宽度' },

  // ---- 行为参数 ----
  autoSaveDebounceMs:     { default: 2000, desc: '编辑器自动保存防抖(ms)' },
  exportStatusClearMs:    { default: 5000, desc: '导出成功提示停留(ms)' },

  // ---- 工具箱 ----
  skipDeleteConfirm_toolboxScript: { default: false, desc: '跳过工具箱脚本删除确认' },

  // ---- 安全 ----
  lockPassword:  { default: '',    desc: '锁屏密码（留空则点击即可解锁）' },
  lockOnStartup: { default: false, desc: '启动时自动锁屏' },

  // ---- 缩放约束 ----
  zoomMin:   { default: 0.85, desc: '缩放下限' },
  zoomMax:   { default: 1.5,  desc: '缩放上限' },
  zoomStep:  { default: 0.05, desc: '缩放步进' },

  // ---- 活动栏 ----
  activityBarOrder:  { default: '["blog","schedule","knowledge","moments","toolbox","plugins","export","recycle"]', desc: '活动栏图标顺序 (JSON)' },
  activityBarHidden: { default: '[]', desc: '活动栏隐藏的模块 (JSON)' },
  startupTab:        { default: 'blog', desc: '启动时默认显示的模块' },

  // ---- 周期总结（每日博客） ----
  summaryWeeklyDay:      { default: 0, desc: '周总结日（0=周日 … 6=周六）' },
  summaryMonthlyMode:    { default: 'last', desc: '月总结日模式：first=每月第一天 / last=每月最后一天 / fixed=固定日' },
  summaryMonthlyFixedDay: { default: 1, desc: '固定月总结日的日期（1-28）' },
  sidebarIconStyle:      { default: 'default', desc: '侧边栏图标风格（default=手绘 / classic140=1.4.0 细线 / plugin:<插件id>:<包id>）' },

  // ---- 打卡提醒 ----
  checkinReminderEnabled: { default: true,   desc: '启用打卡提醒' },
  checkinReminderTime:    { default: '20:00', desc: '打卡提醒时间（HH:mm）' },

  // ---- 新手引导 ----
  onboardingDone: { default: false, desc: '已完成新手引导' },

  // ---- 彩蛋 ----
  badgeEggActivated: { default: false, desc: '彩蛋：标题栏角标变为 YHAz（外观页底部无标注输入框输入 YHAz 激活）' },

  // ---- AI 工具 ----
  aiToolMonthlyLimit: { default: 0, desc: 'AI 工具月度调用上限（0=不限）' },

  // ---- 模型网关 ----
  modelProviders:      { default: '',   desc: 'LLM 供应商列表（加密 JSON 容器，渲染层不可解）' },
  defaultChatModel:    { default: '',   desc: '默认对话模型（格式 providerId:modelId）' },
  monthlyTokenBudget:  { default: 0,    desc: '月度 token 预算（0=不限）' },
  llmMaxTokens:        { default: 4096, desc: '单次调用 maxTokens 上限' },

  // ---- AI 模块权限 ----
  aiModulePermissions: { default: '{"knowledge":"read","blog":"read","schedule":"read","checkin":"read","bookmarks":"read","pomodoro":"read"}', desc: 'AI 按模块权限：off=禁止 read=只读 write=可读写(JSON)' },

  // ---- AI 助手侧栏 ----
  assistantWidth: { default: 380, desc: 'AI 助手侧栏宽度(px)' },

  // ---- 日程打卡小窗 ----
  dayPanelState: { default: '', desc: '日程打卡小窗状态(JSON: x/y/width/height/docked，主进程直写)' },

  // ---- 单词本 ----
  wordbookActiveBook: { default: '',  desc: '当前学习的词书(\'\'=未选 cet4|cet6|ky)' },
  wordbookNewPerDay:  { default: 10,  desc: '每日建议新学词数' },

  // ---- 错题本形态 ----
  quizbookMode: { default: 'plugin', desc: '错题本形态:plugin 插件版(默认,C 级模块插件) / builtin 内置版(回退)' },

  // ---- 模型标记 ----
  aiFreeModelIds: { default: '[]', desc: '手动标记为免费的模型 ID 列表(JSON 数组)' },
  // ---- 插件安全分级 ----
  pluginAllowedLevels: { default: 'S,A,B', desc: '允许安装/启用的插件安全等级(S/A/B 逗号分隔)' },

  // ---- 更新下载 ----
  updateMirror: { default: 'https://gh-proxy.com', desc: '更新下载镜像(GitHub 加速代理前缀,留空直连 GitHub;失效可随时替换)' },
}

// ===== 边栏面板约束（组件 default/min/max，非用户可改，集中引用） =====

export const PANEL_CONSTRAINTS = {
  sidebarWidth_blog:              { default: 224, min: 160, max: 450 },
  sidebarWidth_schedule:          { default: 280, min: 220, max: 450 },
  sidebarWidth_knowledgeCat:      { default: 240, min: 180, max: 400 },
  sidebarWidth_knowledgePages:    { default: 240, min: 180, max: 400 },
  sidebarWidth_knowledgeChapters: { default: 240, min: 180, max: 400 },
  sidebarWidth_devtools:          { default: 176, min: 140, max: 320 },
  sidebarWidth_devtoolsDocs:      { default: 208, min: 160, max: 360 },
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
