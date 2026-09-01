import { Palette, Type, FileDown, Wrench, Keyboard, PencilLine, BellRing, Bot } from 'lucide-react'

/**
 * 设置模块的大项 / 小项定义与搜索索引。
 * 搜索不再只匹配左侧大项，而是深入到每一个具体设置项（小项），
 * 命中后可直接跳转到该项所在位置并高亮。
 */

export type SettingsSection =
  | 'appearance' | 'editor' | 'blog' | 'export'
  | 'aiTools' | 'advanced' | 'shortcuts' | 'reminder'

/** AI 工具大项内部的页签 */
export type AiTab = 'builtin' | 'mcp' | 'skill' | 'models' | 'perms'

export interface SectionDef {
  id: SettingsSection
  label: string
  icon: React.ReactNode
  /** 大项级别的别名（搜这些词时该大项下所有小项都会被召回） */
  keywords: string[]
}

export interface SettingItem {
  /** 唯一 id，同时作为 DOM 锚点 data-setting-anchor 的值 */
  id: string
  section: SettingsSection
  /** 所属分组小标题，用于面包屑显示 */
  group: string
  /** 小项名称 */
  label: string
  /** 一句话说明 */
  desc?: string
  /** 中英文别名，用于扩大召回 */
  keywords: string[]
  /** 仅 AI 工具大项需要：该小项所在的内部页签 */
  aiTab?: AiTab
}

export const SECTIONS: SectionDef[] = [
  { id: 'appearance', label: '外观',   icon: <Palette size={16} />,     keywords: ['外观', '主题', 'theme', '界面', '样式', '皮肤', '布局'] },
  { id: 'editor',     label: '编辑器', icon: <Type size={16} />,        keywords: ['编辑器', 'editor', '编写', '输入'] },
  { id: 'blog',       label: '博客',   icon: <PencilLine size={16} />,  keywords: ['博客', 'blog', '日记', '总结', '周报', '月报'] },
  { id: 'export',     label: '导出',   icon: <FileDown size={16} />,    keywords: ['导出', 'export', '保存', '文件'] },
  { id: 'aiTools',    label: 'AI 工具', icon: <Bot size={16} />,        keywords: ['AI', '工具', 'agent', '智能体', 'ai', '助手'] },
  { id: 'advanced',   label: '高级',   icon: <Wrench size={16} />,      keywords: ['高级', 'advanced', '偏好', '其它', '其他'] },
  { id: 'shortcuts',  label: '快捷键', icon: <Keyboard size={16} />,    keywords: ['快捷键', 'shortcut', '键盘', 'keyboard', '按键'] },
  { id: 'reminder',   label: '提醒',   icon: <BellRing size={16} />,    keywords: ['提醒', '打卡', '通知', 'remind', '提醒时间'] },
]

export const SECTION_MAP: Record<SettingsSection, SectionDef> =
  SECTIONS.reduce((acc, s) => { acc[s.id] = s; return acc }, {} as Record<SettingsSection, SectionDef>)

/** 所有可搜索的小项 */
export const SETTING_ITEMS: SettingItem[] = [
  // ===== 外观 =====
  { id: 'appearance.theme', section: 'appearance', group: '主题', label: '应用主题',
    desc: '深色 / 浅色配色，以及插件提供的主题包', keywords: ['主题', 'theme', '深色', '浅色', 'dark', 'light', '夜间', '配色'] },
  { id: 'appearance.deleteFx', section: 'appearance', group: '删除动画皮肤', label: '删除动画皮肤',
    desc: '知识库删除条目时的吞噬特效外观', keywords: ['删除动画', '删除特效', '吞噬', '火焰', '进度条', '皮肤', 'fx', 'delete'] },
  { id: 'appearance.sidebarIcons', section: 'appearance', group: '侧边栏图标', label: '侧边栏图标风格',
    desc: '活动栏模块图标风格（含插件图标包）', keywords: ['侧边栏图标', '图标包', '图标', '活动栏', 'icon', 'sidebar'] },
  { id: 'appearance.startupTab', section: 'appearance', group: '启动时默认显示', label: '启动时默认显示',
    desc: '打开应用后自动进入的模块', keywords: ['启动', '默认模块', '首页', 'startup', '默认显示', '初始模块'] },
  { id: 'appearance.blogCardSize', section: 'appearance', group: '博客卡片大小', label: '博客卡片大小',
    desc: '博客列表卡片的尺寸密度', keywords: ['卡片大小', '博客卡片', '卡片', '密度', 'card', '布局'] },
  { id: 'appearance.knowledgeSidebarItemSize', section: 'appearance', group: '知识库侧边栏条目', label: '知识库侧边栏条目大小',
    desc: '侧边栏树形条目（空间/笔记本/章节/页面）的行高与字号', keywords: ['侧边栏条目', '行高', '条目大小', '树形', '紧凑', '宽松'] },

  // ===== 编辑器 =====
  { id: 'editor.font', section: 'editor', group: '字体样式', label: '字体样式',
    desc: '编辑器正文使用的字体', keywords: ['字体', 'font', '字体样式', '字型', 'typeface'] },
  { id: 'editor.fontSize', section: 'editor', group: '字号', label: '字号',
    desc: '编辑器正文字号大小', keywords: ['字号', '字体大小', '大小', 'fontsize', 'font size'] },
  { id: 'editor.lineNumbers', section: 'editor', group: '显示', label: '显示行号',
    desc: '编辑器左侧是否显示行号', keywords: ['行号', '显示行号', 'linenumber', 'line numbers', 'gutter'] },

  // ===== 博客 =====
  { id: 'blog.summaryWeeklyDay', section: 'blog', group: '周期总结', label: '周总结日',
    desc: '每周在哪一天生成周总结', keywords: ['周总结', '总结日', '每周', '星期', '周几', 'weekly', '周报'] },
  { id: 'blog.summaryMonthlyMode', section: 'blog', group: '周期总结', label: '月总结日',
    desc: '每月总结规则：第一天 / 最后一天 / 固定日', keywords: ['月总结', '总结日', '每月', '月末', '月初', 'monthly', '月报'] },
  { id: 'blog.summaryMonthlyFixedDay', section: 'blog', group: '周期总结', label: '固定日期',
    desc: '固定日模式下，每月哪一天为月总结日', keywords: ['固定日期', '固定日', '几号', '月总结'] },
  { id: 'blog.templates', section: 'blog', group: '博客模板', label: '博客模板',
    desc: '写日记时一键套用的 Markdown 模板', keywords: ['模板', '博客模板', '新建模板', 'template', '套用', 'markdown'] },

  // ===== 导出 =====
  { id: 'export.encoding', section: 'export', group: '默认编码', label: '默认编码',
    desc: '导出文件的默认字符编码', keywords: ['编码', 'encoding', 'utf', 'utf8', 'utf-8', 'gbk', 'gb2312', 'bom', '乱码'] },

  // ===== AI 工具 =====
  { id: 'aiTools.usage', section: 'aiTools', group: '工具调用量', label: '工具调用量',
    desc: '本自然月 AI 工具累计调用次数', keywords: ['用量', '调用量', '额度', '统计', 'usage', '次数', '本月'] },
  { id: 'aiTools.monthlyLimit', section: 'aiTools', group: '月度调用上限', label: '月度调用上限', aiTab: 'builtin',
    desc: '每月最多调用次数，0 表示不限制', keywords: ['上限', '限制', '每月', '调用上限', 'limit', '额度', '配额'] },
  { id: 'aiTools.builtin', section: 'aiTools', group: '内置工具', label: '内置工具清单', aiTab: 'builtin',
    desc: '官方内置只读工具，不可关闭', keywords: ['内置工具', '工具', 'tool', '注册表', '只读'] },
  { id: 'aiTools.audit', section: 'aiTools', group: '最近调用', label: '最近调用记录', aiTab: 'builtin',
    desc: '最近 10 条调用审计记录', keywords: ['审计', '日志', '记录', 'audit', '调用记录', '历史'] },
  { id: 'aiTools.mcp', section: 'aiTools', group: 'MCP 服务器', label: 'MCP 服务器', aiTab: 'mcp',
    desc: '连接外部 Model Context Protocol 服务器', keywords: ['mcp', '服务器', '外部工具', 'server', 'sse', 'stdio', '连接'] },
  { id: 'aiTools.skill', section: 'aiTools', group: 'Skill 技能', label: 'Skill 技能', aiTab: 'skill',
    desc: '插件提供的声明式提示词资产', keywords: ['skill', '技能', '提示词', 'prompt', '资产'] },
  { id: 'aiTools.models', section: 'aiTools', group: '模型', label: '模型配置', aiTab: 'models',
    desc: 'AI 模型与 API 密钥配置', keywords: ['模型', 'model', 'api', 'key', '密钥', '大模型', 'llm', '配置模型'] },
  { id: 'aiTools.perms', section: 'aiTools', group: '权限', label: '调用权限', aiTab: 'perms',
    desc: 'AI 工具调用的权限控制', keywords: ['权限', 'permission', '授权', '允许', '拒绝', '安全'] },

  // ===== 高级 =====
  { id: 'advanced.update', section: 'advanced', group: '关于与更新', label: '检查更新',
    desc: '当前版本号与在线更新', keywords: ['更新', '升级', '版本', '检查更新', 'update', 'version', '新版本'] },
  { id: 'advanced.mirror', section: 'advanced', group: '关于与更新', label: '下载镜像',
    desc: 'GitHub 加速代理前缀，留空直连', keywords: ['镜像', '加速', '代理', 'github', 'proxy', '下载', 'cdn'] },
  { id: 'advanced.zoom', section: 'advanced', group: '缩放', label: '界面缩放',
    desc: '整体界面缩放比例与重置', keywords: ['缩放', 'zoom', '放大', '缩小', '重置', '比例', '界面大小'] },
  { id: 'advanced.deleteConfirm', section: 'advanced', group: '删除确认', label: '删除确认',
    desc: '博客 / 知识库 / 目录 / 章节删除时是否弹确认框', keywords: ['删除确认', '确认', '对话框', '弹窗', '跳过', 'confirm'] },
  { id: 'advanced.onboarding', section: 'advanced', group: '新手引导', label: '新手引导',
    desc: '重新查看新手引导', keywords: ['引导', '新手', '教程', 'onboarding', '向导', '引导页'] },
  { id: 'advanced.autosave', section: 'advanced', group: '自动保存', label: '自动保存',
    desc: '停止输入后自动保存的延迟时间', keywords: ['自动保存', '保存', '防抖', 'autosave', '延迟', 'debounce'] },

  // ===== 快捷键 =====
  { id: 'shortcuts.global', section: 'shortcuts', group: '全局', label: '全局快捷键',
    desc: '侧栏折叠、关闭弹窗', keywords: ['全局', '侧栏', '折叠', 'escape', 'esc', '关闭弹窗', 'ctrl b'] },
  { id: 'shortcuts.kbEditor', section: 'shortcuts', group: '知识库 — 编辑器', label: '知识库编辑器快捷键',
    desc: '保存、Markdown 预览、返回列表', keywords: ['保存', '预览', 'ctrl s', 'markdown 预览', 'ctrl /'] },
  { id: 'shortcuts.kbSidebar', section: 'shortcuts', group: '知识库 — 侧栏', label: '知识库侧栏快捷键',
    desc: '重命名与删除选中项', keywords: ['重命名', 'f2', '删除', '侧栏', 'rename'] },
  { id: 'shortcuts.kbTabs', section: 'shortcuts', group: '知识库 — Tab 管理', label: '知识库 Tab 快捷键',
    desc: '新建 / 关闭 / 切换标签页', keywords: ['tab', '标签页', '新建页面', '关闭', '切换', 'ctrl w', 'ctrl tab'] },
  { id: 'shortcuts.blogKeys', section: 'shortcuts', group: '博客', label: '博客快捷键',
    desc: '新建今日文章、保存并关闭、预览', keywords: ['博客快捷键', '新建文章', 'ctrl n', '保存并关闭'] },
  { id: 'shortcuts.scheduleKeys', section: 'shortcuts', group: '日程', label: '日程快捷键',
    desc: '新建任务、关闭弹窗', keywords: ['日程快捷键', '新建任务', '任务', 'ctrl n'] },

  // ===== 提醒 =====
  { id: 'reminder.enable', section: 'reminder', group: '打卡提醒', label: '启用打卡提醒',
    desc: '到点提醒当天未打卡的习惯', keywords: ['打卡', '提醒', '启用', '开关', 'checkin', '通知'] },
  { id: 'reminder.time', section: 'reminder', group: '打卡提醒', label: '提醒时间',
    desc: '每天触发打卡提醒的时间点', keywords: ['时间', '提醒时间', '几点', '打卡时间', '20:00'] },
]

/** 空查询时展示的热门推荐项 */
export const RECOMMENDED_IDS = [
  'editor.font',
  'appearance.theme',
  'editor.lineNumbers',
  'advanced.zoom',
  'reminder.enable',
  'export.encoding',
  'aiTools.models',
  'shortcuts.global',
]

export const RECOMMENDED_ITEMS: SettingItem[] = RECOMMENDED_IDS
  .map(id => SETTING_ITEMS.find(i => i.id === id))
  .filter((i): i is SettingItem => !!i)

// ===== 检索 =====

export interface SearchHit {
  item: SettingItem
  score: number
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

const ASCII_RE = /^[\x20-\x7e]+$/

/** 子序列匹配：用于英文拼写容错（"lne" → "line numbers"） */
function isSubsequence(hay: string, needle: string): boolean {
  if (!needle) return false
  let i = 0
  for (let k = 0; k < hay.length && i < needle.length; k++) {
    if (hay[k] === needle[i]) i++
  }
  return i === needle.length
}

/** 单字段打分：0 表示未命中 */
function scoreField(field: string, token: string, base: { exact: number; starts: number; contains: number; fuzzy: number }): number {
  if (!field) return 0
  if (field === token) return base.exact
  if (field.startsWith(token)) return base.starts
  if (field.includes(token)) return base.contains
  if (ASCII_RE.test(token) && token.length >= 2 && isSubsequence(field, token)) return base.fuzzy
  return 0
}

const W_LABEL = { exact: 120, starts: 100, contains: 80, fuzzy: 26 }
const W_KEYWORD = { exact: 80, starts: 66, contains: 56, fuzzy: 22 }
const W_GROUP = { exact: 62, starts: 54, contains: 46, fuzzy: 18 }
const W_SECTION = { exact: 72, starts: 64, contains: 56, fuzzy: 18 }
const W_DESC = { exact: 0, starts: 0, contains: 32, fuzzy: 0 }

/**
 * 按空格/常见分隔符切词（先切再压空格），
 * 保证 "ctrl n" 不会被压成 "ctrln" 而让 "ln" 之类的短词误命中。
 */
function toWords(s: string): string[] {
  return s.toLowerCase()
    .split(/[\s,，、/·—]+/)
    .map(w => w.trim())
    .filter(Boolean)
}

/** 单个英文字母/数字：只认前缀匹配，避免 "a" 命中 20+ 项噪音 */
const SINGLE_CHAR_RE = /^[a-z0-9]$/
const strict = (w: typeof W_LABEL) => ({ exact: w.exact, starts: w.starts, contains: 0, fuzzy: 0 })

function bestFieldScore(words: string[], token: string, w: typeof W_LABEL): number {
  let best = 0
  for (const word of words) {
    const sc = scoreField(word, token, w)
    if (sc > best) best = sc
    if (best >= w.exact) break
  }
  return best
}

/** 把查询串切成 token；多词查询按空格分词后逐个参与 AND 匹配 */
function tokenize(q: string): string[] {
  const parts = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts
  // 多词时不再额外加入"拼接整体"，否则 "ai 模型" 会因 "ai模型" 无法命中而被整体判负
  return parts
}

/**
 * 检索设置项。多个 token 时要求全部命中（AND），得分为各 token 累加。
 */
export function searchSettings(query: string, limit?: number): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const tokens = tokenize(q)
  const hits: SearchHit[] = []

  for (const item of SETTING_ITEMS) {
    const section = SECTION_MAP[item.section]
    const labelWords = toWords(item.label)
    const keywordWords = item.keywords.flatMap(k => toWords(k))
    const groupWords = toWords(item.group)
    const sectionWords = [section.label, ...section.keywords].flatMap(k => toWords(k))
    const desc = norm(item.desc ?? '')

    let total = 0
    let ok = true
    for (const tk of tokens) {
      const single = SINGLE_CHAR_RE.test(tk)
      const wLabel = single ? strict(W_LABEL) : W_LABEL
      const wKeyword = single ? strict(W_KEYWORD) : W_KEYWORD
      const wGroup = single ? strict(W_GROUP) : W_GROUP
      const wSection = single ? strict(W_SECTION) : W_SECTION

      let best = 0
      best = Math.max(best, bestFieldScore(labelWords, tk, wLabel))
      if (best < wLabel.exact) best = Math.max(best, bestFieldScore(keywordWords, tk, wKeyword))
      if (best < wKeyword.exact) best = Math.max(best, bestFieldScore(groupWords, tk, wGroup))
      if (best < wGroup.exact) best = Math.max(best, bestFieldScore(sectionWords, tk, wSection))
      if (!single && best < W_DESC.contains) best = Math.max(best, scoreField(desc, tk, W_DESC))
      if (best === 0) { ok = false; break }
      total += best
    }
    if (!ok) continue
    hits.push({ item, score: total })
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ia = SECTIONS.findIndex(s => s.id === a.item.section)
    const ib = SECTIONS.findIndex(s => s.id === b.item.section)
    if (ia !== ib) return ia - ib
    return SETTING_ITEMS.indexOf(a.item) - SETTING_ITEMS.indexOf(b.item)
  })

  return limit && limit > 0 ? hits.slice(0, limit) : hits
}

/** 命中项在小项列表中的数量（用于左侧大项角标） */
export function countBySection(hits: SearchHit[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const h of hits) acc[h.item.section] = (acc[h.item.section] ?? 0) + 1
  return acc
}

// ===== 跳转锚点广播 =====
// 搜索跳转的目标锚点除用于滚动高亮外，还广播给各视图：
// 若目标落在默认收起的 CollapseList 分组内，视图据此自动展开。

type AnchorListener = (id: string | null) => void
let pendingAnchor: string | null = null
const anchorListeners = new Set<AnchorListener>()

/** 记录并广播待跳转锚点（jumpTo 时调用） */
export function setPendingAnchor(id: string | null) {
  pendingAnchor = id
  anchorListeners.forEach(l => l(id))
}

/** 视图挂载/更新时消费：锚点归属本组则返回 true 并清除 */
export function consumePendingAnchor(id: string): boolean {
  if (pendingAnchor === id) { pendingAnchor = null; return true }
  return false
}

/** 订阅后续跳转（视图已挂载时二次跳转走这里），返回退订函数 */
export function subscribePendingAnchor(l: AnchorListener): () => void {
  anchorListeners.add(l)
  return () => { anchorListeners.delete(l) }
}

/**
 * 输入补齐：返回可直接补全到输入框尾部的文本。
 * 只在候选项中存在"以当前输入开头且更长"的小项名称时返回。
 */
export function completionFor(query: string, candidates: SettingItem[]): string {
  const raw = query.trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  for (const c of candidates) {
    const label = c.label
    if (label.length > raw.length && label.toLowerCase().startsWith(lower)) {
      return label.slice(raw.length)
    }
  }
  return ''
}
