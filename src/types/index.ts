// ===== 共享类型 =====

export interface Entry {
  id: string; title: string; contentMd: string; contentHtml: string
  date: string; createdAt: string; updatedAt: string
  isPinned: boolean; isStarred: boolean; wordCount: number; tags?: Tag[]
  states: string
}
export interface EntryFilter { date?: string; tagId?: string; pinnedOnly?: boolean; starredOnly?: boolean; limit?: number; offset?: number }
export interface CreateEntryDTO { title?: string; contentMd?: string; contentHtml?: string; date: string; tags?: string[]; states?: string }
export interface UpdateEntryDTO { title?: string; contentMd?: string; contentHtml?: string; date?: string; isPinned?: boolean; isStarred?: boolean; tags?: string[]; states?: string }
export interface Tag { id: string; name: string; color: string }
export type TabName = 'blog' | 'schedule' | 'knowledge' | 'moments' | 'recycle' | 'settings' | 'help' | 'user' | 'toolbox' | 'plugins'

// toolbox
export interface ToolboxScript {
  id: string; name: string; description: string; content: string
  language: string; sortOrder: number
  createdAt: string; updatedAt: string
}
// blog template
export interface BlogTemplate {
  id: string; name: string; contentMd: string
  sortOrder: number; createdAt: string; updatedAt: string
}
export interface CreateToolboxScriptDTO { name?: string; description?: string; content?: string; language?: string }
export interface UpdateToolboxScriptDTO { name?: string; description?: string; content?: string; language?: string; sortOrder?: number }

// password vault
export interface PasswordEntry {
  id: string; title: string; url: string; username: string; account: string; password: string; notes: string
  sortOrder: number; createdAt: string; updatedAt: string
}
export interface CreatePasswordEntryDTO { title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string }
export interface UpdatePasswordEntryDTO { title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string; sortOrder?: number }

// moments
export interface MomentsAlbum {
  id: string
  name: string
  photoCount: number
  cover: string
  coverPostId: string
  coverIndex: number
  createdAt: string
  updatedAt: string
}
export interface AttachmentMeta {
  id: string
  name: string
  url: string
  thumbUrl: string
  mime: string
  size: number
  position: number
}
export interface CreateMomentsPostDTO { contentMd?: string; contentHtml?: string; imageDataUrls?: string[]; attachmentIds?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean; showInTimeline?: boolean }
export interface UpdateMomentsPostDTO { contentMd?: string; contentHtml?: string; imageDataUrls?: string[]; attachmentIds?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean; showInTimeline?: boolean }

export interface MomentsPost {
  id: string
  contentMd: string
  contentHtml: string
  imageDataUrls: string[]
  attachmentIds: string[]
  attachments: AttachmentMeta[]
  tags: string[]
  albumId: string
  isPinned: boolean
  /** false = 仅归档到相册，不在时间线显示 */
  showInTimeline: boolean
  createdAt: string
  updatedAt: string
}
// weight tracker
export interface WeightRecord { id: string; weight: number; date: string; series: string; note: string; createdAt: string }
export interface CreateWeightDTO { weight: number; date: string; series?: string; note?: string }
export interface UpdateWeightDTO { weight?: number; date?: string; series?: string; note?: string }

// ---- 打卡模块 ----
export type HabitRuleType = 'daily' | 'weekdays' | 'flexible'
export interface Habit {
  id: string
  name: string
  color: string
  ruleType: HabitRuleType
  /** weekdays 规则的计划日，JS getDay() 数字，0=周日 */
  ruleDays: number[]
  /** flexible 规则的每周目标次数 */
  weeklyTarget: number
  sortOrder: number
  archived: boolean
  createdAt: string
}
export interface HabitRecord { id: string; habitId: string; date: string }
export interface CreateHabitDTO {
  name: string; color?: string; ruleType?: HabitRuleType
  ruleDays?: number[]; weeklyTarget?: number; sortOrder?: number
}
export interface UpdateHabitDTO {
  name?: string; color?: string; ruleType?: HabitRuleType
  ruleDays?: number[]; weeklyTarget?: number
  sortOrder?: number; archived?: boolean
}

// ---- 网址导航 ----
export interface BookmarkCategory { id: string; name: string; color: string; sortOrder: number; createdAt: string }
export interface BookmarkItem {
  id: string
  /** '' = 未分类 */
  categoryId: string
  title: string
  url: string
  description: string
  sortOrder: number
  createdAt: string
}

// ---- 远程监督 ----
export type SupervisePlatform = 'serverchan' | 'wecom' | 'dingtalk' | 'custom'
export interface SuperviseConfig {
  enabled: boolean
  platform: SupervisePlatform
  /** serverchan 存 SendKey，其余存完整 webhook 地址 */
  webhookUrl: string
  /** 仅钉钉加签 */
  secret: string
  instantPush: boolean
  dailyPush: boolean
  /** HH:mm */
  dailyTime: string
  /** 免打扰起止 HH:mm，空 = 不启用 */
  quietStart: string
  quietEnd: string
}
export interface SuperviseLog {
  id: number
  pushType: 'instant' | 'daily'
  habitId: string | null
  title: string
  content: string
  status: 'success' | 'failed' | 'pending'
  retryCount: number
  errorMessage: string | null
  createdAt: string
  pushedAt: string | null
}

// user
export interface UserProfile {
  username: string
  avatarPath: string
  hasPassword: boolean
  createdAt: string
  updatedAt: string
}
export interface UserStats {
  blogCount: number
  knowledgePages: number
  scheduleTodos: number
  blogTags: number
  knowledgeTags: number
  scheduleTags: number
  consecutiveDays: number
  totalWords: number
  totalCategories: number
}
export interface UserExportData {
  username: string
  avatarPath: string
  avatarBase64: string | null
  passwordHash: string
}
export interface UserImportData {
  username?: string
  avatarPath?: string
  avatarBase64?: string | null
  passwordHash?: string
}
export type { AppSettings, SettingsKey, SettingsValue } from '../lib/settings'

// schedule
export interface ScheduleTodo {
  id: string; title: string; description: string; date: string
  time: string | null; quadrant: number
  taskType: 'deadline' | 'plan' | 'daily'; tagId: string | null
  status: 'pending' | 'done'; sortOrder: number
  endCriteria: string; parentId: string | null
  createdAt: string; updatedAt: string
  tag?: ScheduleTag | null
  subtasks?: ScheduleTodo[]
}
export interface ScheduleTag { id: string; name: string; color: string }
export interface CreateScheduleTodoDTO {
  title: string; description?: string; date: string; time?: string
  quadrant?: number; taskType?: 'deadline' | 'plan' | 'daily'; tagId?: string
  endCriteria?: string; parentId?: string
}
export interface UpdateScheduleTodoDTO {
  title?: string; description?: string; date?: string; time?: string | null
  quadrant?: number; taskType?: 'deadline' | 'plan' | 'daily'; tagId?: string | null
  status?: string; endCriteria?: string; parentId?: string | null
}

// knowledge
export interface KnowledgeCategory {
  id: string; name: string; parentId: string | null; sortOrder: number
  categoryType: 'notebook' | 'folder' | 'space'
  createdAt: string; updatedAt: string
  children?: KnowledgeCategory[]
}
export interface KnowledgePage {
  id: string; title: string; contentMd: string; contentHtml: string
  annotationMd?: string
  categoryId: string | null; isStarred: boolean; sortOrder: number
  fileType: string
  attachmentId: string
  createdAt: string; updatedAt: string
  tags?: KnowledgeTag[]
  backlinks?: KnowledgePage[]
  /** 搜索命中摘录（仅 searchPages 结果携带） */
  excerpt?: string
}
/** 反链条目（带引用上下文摘录） */
export interface KnowledgeBacklinkItem {
  id: string; title: string; fileType: string
  updatedAt: string
  excerpt: string
}
export interface KnowledgeTag { id: string; name: string; color: string }
export interface CreateKnowledgeCategoryDTO { name: string; parentId?: string | null; categoryType?: 'notebook' | 'folder' | 'space' }
export interface UpdateKnowledgeCategoryDTO { name?: string; parentId?: string | null; sortOrder?: number; categoryType?: 'notebook' | 'folder' | 'space' }
export interface CreateKnowledgePageDTO { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null; fileType?: string; filePath?: string; tags?: string[] }
export interface UpdateKnowledgePageDTO { title?: string; contentMd?: string; contentHtml?: string; annotationMd?: string; categoryId?: string | null; fileType?: string; filePath?: string; tags?: string[] }

// import
export interface ImportFileResult {
  path: string
  baseName: string
  content: string
  fileType: string
  error?: string
}

// recycle bin
export interface RecycleBinItem {
  id: string
  originalId: string
  module: 'blog' | 'knowledge' | 'knowledge_category' | 'passwordVault' | 'moments'
  title: string
  data: any
  deletedAt: string
}

// export
export interface BlogExportData { entries: (Entry & { tags: Tag[] })[]; tags: Tag[] }
export interface ScheduleExportData { todos: (ScheduleTodo & { tag: ScheduleTag | null })[]; tags: ScheduleTag[] }
export interface KnowledgeExportData { categories: KnowledgeCategory[]; pages: (KnowledgePage & { tags: KnowledgeTag[]; backlinks: string[] })[]; tags: KnowledgeTag[] }
export interface PasswordVaultExportData { entries: PasswordEntry[] }
export interface MomentsExportData { posts: MomentsPost[]; albums: MomentsAlbum[] }
export interface HabitExport {
  id: string; name: string; color: string; icon: string
  ruleType: HabitRuleType; ruleDays: number[]; weeklyTarget: number
  sortOrder: number; archived: boolean; createdAt: string; updatedAt: string
}
export interface HabitRecordExport { id: string; habitId: string; date: string }
export interface CheckinExportData { habits: HabitExport[]; records: HabitRecordExport[] }
export interface BookmarkNavExportData { categories: BookmarkCategory[]; bookmarks: BookmarkItem[] }
export interface AllExportData {
  exportVersion: string; exportedAt: string
  user?: UserExportData & { settings: Record<string, unknown>; stats: UserStats }
  blog: BlogExportData; schedule: ScheduleExportData; knowledge: KnowledgeExportData
  passwordVault?: PasswordVaultExportData
  moments?: MomentsExportData
  checkin?: CheckinExportData
  bookmarkNav?: BookmarkNavExportData
}

export interface ExportFileResult { filePath: string; size: number }
export interface ExportMarkdownProgress { current: number; total: number; currentFile: string; phase: string }
export interface ExportMarkdownResult { fileCount: number; totalSize: number; files: { relPath: string; size: number }[] }

export interface PluginRegistryEntry {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  downloadUrl: string
  iconUrl?: string
  category?: string
  riskLevel?: PluginRiskLevel
  contributions?: string[]
  capabilities?: string[]
  size?: number
  checksum?: string
  updatedAt?: string
}

export type PluginRiskLevel = 'S' | 'A' | 'B'

export interface PluginSummary {
  id: string
  name: string
  version: string
  engineVersion?: string
  author?: string
  description?: string
  type: string
  entry?: string
  icon?: string
  category?: string
  riskLevel: PluginRiskLevel
  capabilities: string[]
  grantedCapabilities: string[]
  legacyGrant?: boolean
  enabled: boolean
  installedAt: string
  builtin?: boolean
  contributions: string[]
  broken?: boolean
}

// ===== AI 工具（ToolRegistry，方案见 .claude/plans/agent-tools-foundation.md） =====

export interface AgentToolInfo {
  /** 全局唯一：builtin.knowledge.search / mcp.<serverId>.<toolName> / skill.<id>.<name> */
  name: string
  title: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, {
      type: 'string' | 'number' | 'boolean'
      description?: string
      minimum?: number
      maximum?: number
      enum?: string[]
    }>
    required?: string[]
  }
  source: 'builtin' | 'mcp' | 'skill'
  enabled: boolean
  readOnly: boolean
  /** 所属业务模块（按模块控制 AI 权限） */
  module?: string
  /** 调用所需最低权限 */
  requires?: 'read' | 'write'
}

export interface AiToolUsage {
  used: number
  /** 0 = 不限 */
  limit: number
}

export type AiToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DISABLED'
  | 'INVALID_ARGS'
  | 'LIMIT_EXCEEDED'
  | 'EXEC_ERROR'

export type AiToolInvokeResult = {
  ok: true
  data: unknown
} | {
  ok: false
  code: AiToolErrorCode
  message: string
}

export interface AiToolsListResult {
  tools: AgentToolInfo[]
  usage: AiToolUsage
}

export interface AuditEntryInfo {
  id: string
  pluginId: string
  action: string
  detail: string
  createdAt: string
}

/** 插件审计条目（与 AI 工具审计同构，别名导出供插件模块消费） */
export type PluginAuditEntry = AuditEntryInfo

// ===== MCP 外部服务器（M2） =====

export interface McpToolPreview {
  name: string
  description: string
}

export interface McpServerInfo {
  id: string
  name: string
  transport: 'stdio' | 'sse' | 'http'
  /** stdio=命令行拼接预览 / sse·http=URL */
  endpointPreview: string
  /** 环境变量键名列表（值永不回传渲染层） */
  envKeys: string[]
  enabled: boolean
  status: 'untested' | 'ok' | 'error'
  lastError: string
  toolCount: number
  maxConnections: number
}

/** 添加/编辑/连通性测试共用草稿 */
export interface McpServerDraft {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  commandArgs?: string[]
  url?: string
  env?: Record<string, string>
  /** stdio 双重确认：未确认时主进程拒绝保存与测试 */
  confirmCommand?: boolean
}

export interface McpTestResult {
  ok: boolean
  latencyMs: number
  tools: McpToolPreview[]
  error?: string
}

// ===== Skill 提示词资产（M3） =====

export interface SkillInfo {
  pluginId: string
  pluginName: string
  /** 注册表内名称 skill.<pluginId>.<skillId> */
  registryName: string
  id: string
  title: string
  description: string
  variables: string[]
  /** 声明依赖的工具（展示用途） */
  tools: string[]
}

// ===== 模型网关 + AI 对话 =====

export type LlmProviderType = 'openai-compatible' | 'ollama' | 'anthropic'

/** 脱敏后的供应商信息（Key 相关字段永不回传） */
export interface LlmProviderInfo {
  id: string
  name: string
  type: LlmProviderType
  baseUrl: string
  enabled: boolean
  hasKey: boolean
  models: string[]
  isDefault: boolean
}

export interface LlmProviderDraft {
  id?: string
  name: string
  type: LlmProviderType
  baseUrl: string
  /** 仅新增/更换时传入；编辑留空保留旧密文 */
  apiKey?: string
  enabled?: boolean
}

export interface LlmTestResultInfo {
  ok: boolean
  latencyMs: number
  models?: string[]
  error?: string
}

export interface LlmUsageInfo {
  monthTokens: number
  budget: number
}

// ===== CC Switch 一键导入 =====

export interface CcSwitchItem {
  id: string
  name: string
  type: LlmProviderType
  baseUrl: string
  /** 打码预览（前6+***+后4），明文永不离开主进程 */
  keyPreview: string
}

export interface CcSwitchScanResult {
  found: boolean
  source: string
  items: CcSwitchItem[]
}

export interface CcSwitchImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export interface AgentTraceStep {
  kind: 'llm' | 'tool'
  name?: string
  ok: boolean
  durationMs: number
  tokens?: number
  summary?: string
}

export interface AgentChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentContextInfo {
  type: string
  label: string
  data?: Record<string, unknown>
}

export interface AgentSessionInfo {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

/** 会话内消息（trace 仅 assistant 消息携带） */
export interface AgentStoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** JSON 字符串（原始行格式），前端自行解析 */
  traceJson?: string | null
  createdAt: string
}

export interface AgentChatResult {
  ok: boolean
  sessionId?: string
  reply?: string
  error?: string
  code?: string
  trace: AgentTraceStep[]
}

export interface ElectronAPI {
  getPathForFile: (file: File) => string
  copyImage: (src: { path?: string; dataUrl?: string }) => Promise<boolean>
  clearClipboardIfEqual: (text: string) => Promise<boolean>
  copyText: (text: string) => Promise<boolean>
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (cb: (v: boolean) => void) => void
  setAlwaysOnTop: (onTop: boolean) => Promise<boolean>
  isAlwaysOnTop: () => Promise<boolean>
  getSetting: (key: string) => Promise<unknown>
  getAllSettings: () => Promise<Record<string, unknown>>
  setSetting: (key: string, value: unknown) => Promise<void>
  openDirDialog: () => Promise<string | null>
  reloadWindow: () => Promise<void>
  clearAllData: () => Promise<{ success: boolean; error?: string }>
  getEntries: (f: EntryFilter) => Promise<Entry[]>
  getEntryById: (id: string) => Promise<(Entry & { tags: Tag[] }) | null>
  createEntry: (d: CreateEntryDTO) => Promise<Entry>
  updateEntry: (id: string, d: UpdateEntryDTO) => Promise<Entry>
  toggleEntryStar: (id: string) => Promise<(Entry & { tags: Tag[] }) | null>
  deleteEntry: (id: string) => Promise<void>
  searchEntries: (q: string) => Promise<Entry[]>
  getTags: () => Promise<Tag[]>
  createTag: (n: string, c?: string) => Promise<Tag>
  deleteTag: (id: string) => Promise<void>
  getDbPath: () => Promise<string>
  getScheduleTodos: (date: string) => Promise<ScheduleTodo[]>
  getScheduleDates: (yearMonth: string) => Promise<string[]>
  getScheduleMonthTodos: (yearMonth: string) => Promise<ScheduleTodo[]>
  getScheduleDeadlineCounts: (yearMonth: string) => Promise<Record<string, number>>
  getScheduleSubtasks: (parentId: string) => Promise<ScheduleTodo[]>
  createScheduleTodo: (d: CreateScheduleTodoDTO) => Promise<ScheduleTodo>
  updateScheduleTodo: (id: string, d: UpdateScheduleTodoDTO) => Promise<ScheduleTodo>
  deleteScheduleTodo: (id: string) => Promise<void>
  getScheduleTags: () => Promise<ScheduleTag[]>
  createScheduleTag: (n: string, c?: string) => Promise<ScheduleTag>
  deleteScheduleTag: (id: string) => Promise<void>
  // knowledge (Scheme A)
  getKnowledgeCategories: () => Promise<KnowledgeCategory[]>
  createKnowledgeCategory: (d: CreateKnowledgeCategoryDTO) => Promise<KnowledgeCategory>
  updateKnowledgeCategory: (id: string, d: UpdateKnowledgeCategoryDTO) => Promise<KnowledgeCategory>
  deleteKnowledgeCategory: (id: string) => Promise<void>
  getKnowledgePages: (categoryId?: string | null) => Promise<KnowledgePage[]>
  getKnowledgePageById: (id: string) => Promise<KnowledgePage | null>
  createKnowledgePage: (d: CreateKnowledgePageDTO) => Promise<KnowledgePage>
  updateKnowledgePage: (id: string, d: UpdateKnowledgePageDTO) => Promise<KnowledgePage>
  deleteKnowledgePage: (id: string) => Promise<void>
  searchKnowledgePages: (q: string) => Promise<KnowledgePage[]>
  getKnowledgeBacklinks: (pageId: string) => Promise<KnowledgePage[]>
  getKnowledgeBacklinkContext: (pageId: string) => Promise<KnowledgeBacklinkItem[]>
  getKnowledgeManualLinks: (pageId: string) => Promise<KnowledgePage[]>
  addKnowledgeManualLink: (pageId: string, targetId: string) => Promise<{ ok: boolean }>
  removeKnowledgeManualLink: (a: string, b: string) => Promise<{ ok: boolean }>
  updateKnowledgeLinks: (pageId: string, linkedTitles: string[]) => Promise<void>
  getKnowledgeTags: () => Promise<KnowledgeTag[]>
  createKnowledgeTag: (n: string, c?: string) => Promise<KnowledgeTag>
  deleteKnowledgeTag: (id: string) => Promise<void>
  toggleKnowledgeStar: (id: string) => Promise<KnowledgePage>
  getKnowledgeStarredPages: () => Promise<KnowledgePage[]>
  moveKnowledgePage: (id: string, direction: 'up' | 'down') => Promise<void>
  reorderKnowledgePage: (id: string, targetIndex: number) => Promise<void>
  moveKnowledgeCategory: (id: string, direction: 'up' | 'down') => Promise<void>
  // import
  showImportOpenDialog: () => Promise<string[]>
  readImportFiles: (paths: string[]) => Promise<ImportFileResult[]>
  importPdf: (base64: string, fileName: string) => Promise<{ id?: string; title?: string; fileType?: string; error?: string }>
  importPdfFile: (filePath: string) => Promise<{ id?: string; title?: string; fileType?: string; error?: string }>
  openExternal: (filePath: string) => Promise<void>
  getAppVersion: () => Promise<string>
  checkForUpdate: () => Promise<{ ok: boolean; hasUpdate: boolean; currentVersion: string; latestVersion: string; releaseUrl: string; notes: string; asset: { name: string; url: string; size: number } | null; message?: string }>
  downloadUpdate: (url: string, name: string, size?: number) => Promise<{ success: boolean; filePath?: string; message?: string }>
  installUpdate: (filePath: string) => Promise<{ success: boolean; message?: string }>
  onUpdateDownloadProgress: (cb: (p: { percent: number; receivedBytes: number; totalBytes: number }) => void) => () => void
  pluginFetchRegistry: () => Promise<{ ok: boolean; plugins: PluginRegistryEntry[]; updatedAt?: string; message?: string }>
  pluginInstall: (url: string, grantedCapabilities?: string[]) => Promise<{ success: boolean; message?: string }>
  onPluginDownloadProgress: (cb: (p: { key: string; received: number; total: number; percent: number; host?: string }) => void) => () => void
  pluginInstallFromFile: (grantedCapabilities?: string[]) => Promise<{ success: boolean; message?: string }>
  pluginListInstalled: () => Promise<PluginSummary[]>
  pluginSetEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean; message?: string }>
  pluginUninstall: (id: string) => Promise<{ success: boolean; message?: string }>
  pluginGetContribution: (id: string, key: string) => Promise<{ ok: boolean; data?: unknown; message?: string }>
  pluginSetGranted: (id: string, caps: string[]) => Promise<{ success: boolean; message?: string }>
  pluginAuditList: (id?: string) => Promise<PluginAuditEntry[]>
  pluginAuditClear: (id?: string) => Promise<{ success: boolean }>
  pluginAuditWrite: (id: string, action: string, detail?: unknown) => Promise<{ success: boolean }>
  knowledgePackGetState: (pluginId: string) => Promise<{ ok: boolean; state?: 'not-imported' | 'imported' | 'update-available' | 'disabled'; version?: string; chapters?: number; totalPages?: number; newPages?: number; changedPages?: number; lastImportedAt?: string; spaceId?: string | null; notebookCount?: number; spaceName?: string; message?: string }>
  knowledgePackImport: (pluginId: string, overwriteModified: boolean, forceExternalIds?: string[]) => Promise<{ ok: boolean; created?: number; updated?: number; skipped?: number; conflicts?: { title: string; reason: string; externalId: string }[]; spaceId?: string | null; message?: string }>
  onKnowledgePackProgress: (cb: (p: { pluginId: string; current: number; total: number; title: string }) => void) => () => void
  getAttachmentsPath: () => Promise<string>
  showImportDataDialog: () => Promise<string[]>
  readImportFile: (filePath: string) => Promise<string | null>
  executeImport: (data: object) => Promise<{ success: boolean; imported: number; skipped: number; message: string }>
  importDb: (srcPath: string) => Promise<{ success: boolean; message: string }>
  previewUserFromDb: (filePath: string) => Promise<{ profile?: { username: string; avatar_path: string; password_hash: string }; stats?: { blogCount: number; scheduleCount: number; knowledgeCount: number }; error?: string }>
  // recycle bin
  getRecycleBinItems: () => Promise<RecycleBinItem[]>
  restoreRecycleBinItem: (id: string) => Promise<void>
  restoreRecycleBinPartial: (id: string, path: string) => Promise<void>
  trashRecycleBinItem: (id: string) => Promise<void>
  trashAllRecycleBin: () => Promise<void>
  trashRecycleBinPartial: (id: string, path: string) => Promise<void>
  emptyRecycleBin: () => Promise<void>
  purgeExpiredRecycleBinItems: () => Promise<void>
  // user
  getUserProfile: () => Promise<UserProfile | null>
  setUserUsername: (username: string) => Promise<{ success: boolean }>
  setUserPassword: (password: string) => Promise<{ success: boolean }>
  verifyUserPassword: (password: string) => Promise<boolean>
  verifyImportPassword: (password: string, storedHash: string) => Promise<boolean>
  hasUserPassword: () => Promise<boolean>
  changeUserPassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  clearUserPassword: (password: string) => Promise<{ success: boolean; error?: string }>
  pickAvatarFile: () => Promise<string | null>
  saveAvatar: (sourcePath: string) => Promise<{ success: boolean; path: string }>
  getAvatarBase64: () => Promise<string | null>
  getUserStats: () => Promise<UserStats>
  getUserExportData: () => Promise<UserExportData | null>
  restoreUserFromImport: (data: UserImportData) => Promise<{ success: boolean }>
  showExportSaveDialog: (opts: { defaultName: string; filters: { name: string; extensions: string[] }[] }) => Promise<{ filePath: string | null }>
  writeExportTextFile: (filePath: string, content: string, encoding?: string) => Promise<ExportFileResult>
  // toolbox
  getToolboxScripts: () => Promise<ToolboxScript[]>
  getToolboxScriptById: (id: string) => Promise<ToolboxScript | null>
  createToolboxScript: (d: CreateToolboxScriptDTO) => Promise<ToolboxScript>
  updateToolboxScript: (id: string, d: UpdateToolboxScriptDTO) => Promise<ToolboxScript>
  deleteToolboxScript: (id: string) => Promise<void>
  reorderToolboxScripts: (ids: string[]) => Promise<void>
  // password vault
  getPasswordEntries: () => Promise<PasswordEntry[]>
  getPasswordEntryById: (id: string) => Promise<PasswordEntry | null>
  createPasswordEntry: (d: CreatePasswordEntryDTO) => Promise<PasswordEntry>
  updatePasswordEntry: (id: string, d: UpdatePasswordEntryDTO) => Promise<PasswordEntry>
  deletePasswordEntry: (id: string) => Promise<void>
  // moments
  getMomentsPosts: () => Promise<MomentsPost[]>
  getMomentsPostById: (id: string) => Promise<MomentsPost | null>
  createMomentsPost: (d: CreateMomentsPostDTO) => Promise<MomentsPost>
  updateMomentsPost: (id: string, d: UpdateMomentsPostDTO) => Promise<MomentsPost>
  deleteMomentsPost: (id: string) => Promise<void>
  toggleMomentsPin: (id: string) => Promise<MomentsPost>
  getMomentsAlbums: () => Promise<MomentsAlbum[]>
  createMomentsAlbum: (name: string) => Promise<MomentsAlbum | null>
  renameMomentsAlbum: (id: string, name: string) => Promise<MomentsAlbum | null>
  deleteMomentsAlbum: (id: string) => Promise<void>
  setMomentsPostAlbum: (postId: string, albumId: string) => Promise<MomentsPost | null>
  setMomentsAlbumCover: (albumId: string, postId: string, index: number) => Promise<MomentsAlbum | null>
  // attachments
  uploadAttachments: (data: { ownerType?: string; ownerId?: string; files: { name?: string; mime?: string; dataUrl?: string; base64?: string; thumbDataUrl?: string }[] }) => Promise<AttachmentMeta[]>
  uploadAttachmentFromPath: (data: { ownerType?: string; ownerId?: string; filePath: string }) => Promise<AttachmentMeta | null>
  getAttachmentsByOwner: (ownerType: string, ownerId: string) => Promise<AttachmentMeta[]>
  deleteAttachment: (id: string) => Promise<void>
  getAttachmentPath: (id: string) => Promise<string | null>
  readAttachmentBase64: (id: string) => Promise<string | null>
  readAttachmentBase64ByFileName: (fileName: string) => Promise<string | null>
  cleanupOrphanAttachments: () => Promise<{ removed: number }>
  exportBackupToZip: (zipPath: string, moduleIds?: string[]) => Promise<{ filePath: string; fileCount: number; totalSize: number }>
  importBackupPackage: (srcPath: string) => Promise<{ success: boolean; imported: number; skipped: number; attachments: number; message: string }>
  // weight tracker
  getWeightRecords: () => Promise<WeightRecord[]>
  getWeightSeries: () => Promise<string[]>
  createWeightRecord: (d: CreateWeightDTO) => Promise<WeightRecord>
  updateWeightRecord: (id: string, d: UpdateWeightDTO) => Promise<WeightRecord>
  deleteWeightRecord: (id: string) => Promise<void>
  // checkin
  habitGetAll: () => Promise<{ habits: Habit[]; records: HabitRecord[] }>
  createHabit: (d: CreateHabitDTO) => Promise<Habit>
  updateHabit: (id: string, d: UpdateHabitDTO) => Promise<Habit>
  deleteHabit: (id: string) => Promise<void>
  toggleHabitCheck: (habitId: string, date: string) => Promise<{ checked: boolean }>
  reorderHabits: (orderedIds: string[]) => Promise<void>
  // bookmark nav
  bookmarkGetAll: () => Promise<{ categories: BookmarkCategory[]; bookmarks: BookmarkItem[] }>
  createBookmarkCategory: (d: { name: string; color?: string }) => Promise<BookmarkCategory>
  updateBookmarkCategory: (id: string, d: { name?: string; color?: string }) => Promise<BookmarkCategory | null>
  deleteBookmarkCategory: (id: string) => Promise<void>
  reorderBookmarkCategories: (orderedIds: string[]) => Promise<void>
  createBookmarkItem: (d: { title: string; url: string; description?: string; categoryId?: string }) => Promise<BookmarkItem>
  updateBookmarkItem: (id: string, d: { title?: string; url?: string; description?: string; categoryId?: string | null }) => Promise<BookmarkItem | null>
  deleteBookmarkItem: (id: string) => Promise<void>
  openBookmarkUrl: (url: string) => Promise<void>
  pickBookmarkImportFile: () => Promise<string | null>
  // remote supervise
  superviseGetConfig: () => Promise<SuperviseConfig>
  superviseSaveConfig: (partial: Partial<SuperviseConfig>) => Promise<SuperviseConfig>
  superviseTest: () => Promise<{ ok: boolean; error?: string }>
  superviseGetHistory: (limit?: number) => Promise<SuperviseLog[]>
  superviseRetry: (id: number) => Promise<SuperviseLog | null>
  superviseRetryAllFailed: () => Promise<{ total: number; ok: number }>
  superviseSendDailyNow: () => Promise<{ ok: boolean; skipped?: string; error?: string }>
  superviseClearHistory: () => Promise<void>
  // period summary (weekly / monthly)
  createPomodoroSession: (minutes: number) => Promise<boolean>
  getBlogPeriodStats: (start: string, end: string) => Promise<{
    checkins: number
    blogEntries: number
    knowledgePages: number
    pomodoroMinutes: number
    scheduleDone: number
  }>
  // blog templates
  listBlogTemplates: () => Promise<BlogTemplate[]>
  createBlogTemplate: (d: { name: string; contentMd?: string }) => Promise<BlogTemplate | null>
  updateBlogTemplate: (id: string, d: { name?: string; contentMd?: string }) => Promise<BlogTemplate | null>
  deleteBlogTemplate: (id: string) => Promise<void>
  // fill popup
  isFillPopup: boolean
  fillPopupTheme: string
  fillPopupGetEntries: () => Promise<PasswordEntry[]>
  fillPopupCopy: (field: string, value: string) => Promise<void>
  fillPopupHide: () => Promise<void>
  onFillPopupRefresh: (cb: () => void) => () => void
  // AI tools (ToolRegistry)
  aiToolsList: () => Promise<AiToolsListResult>
  aiToolsInvoke: (name: string, args?: unknown) => Promise<AiToolInvokeResult>
  aiToolsGetUsage: () => Promise<AiToolUsage>
  aiToolsGetRecentAudit: (limit?: number) => Promise<AuditEntryInfo[]>
  // MCP servers
  mcpListServers: () => Promise<McpServerInfo[]>
  mcpAddServer: (draft: McpServerDraft) => Promise<McpServerInfo>
  mcpUpdateServer: (id: string, patch: Partial<McpServerDraft>) => Promise<McpServerInfo | null>
  mcpRemoveServer: (id: string) => Promise<boolean>
  mcpToggleServer: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string } & Partial<McpServerInfo>>
  mcpListTools: (id: string) => Promise<{ tools: McpToolPreview[] }>
  mcpRefreshTools: (id: string) => Promise<{ ok: boolean; error?: string; tools: McpToolPreview[] }>
  mcpTestConnection: (draft: McpServerDraft) => Promise<McpTestResult>
  // Skills
  aiToolsListSkills: () => Promise<{ skills: SkillInfo[] }>
  aiToolsCopySkillPrompt: (pluginId: string, skillId: string) => Promise<boolean>
  // Model gateway + agent
  llmListProviders: () => Promise<{ providers: LlmProviderInfo[]; defaultChatModel: string }>
  llmSaveProvider: (draft: LlmProviderDraft) => Promise<{ ok: boolean; id?: string; error?: string }>
  llmRemoveProvider: (id: string) => Promise<{ ok: boolean }>
  llmToggleProvider: (id: string, enabled: boolean) => Promise<{ ok: boolean }>
  llmTestConnection: (draft: { type: LlmProviderType; baseUrl: string; apiKey?: string }) => Promise<LlmTestResultInfo>
  llmRefreshModels: (id: string) => Promise<{ ok: boolean; models: string[]; error?: string }>
  llmAddModel: (id: string, model: string) => Promise<{ ok: boolean; models: string[]; error?: string }>
  llmSetDefaultModel: (value: string) => Promise<{ ok: boolean }>
  llmGetUsage: () => Promise<LlmUsageInfo>
  agentChat: (req: { sessionId: string; message: string; context?: AgentContextInfo; chatId?: string }) => Promise<AgentChatResult>
  agentRegenerate: (req: { sessionId: string; context?: AgentContextInfo; chatId?: string }) => Promise<AgentChatResult>
  agentEditMessage: (req: { sessionId: string; messageId: string; message: string; context?: AgentContextInfo; chatId?: string }) => Promise<AgentChatResult>
  agentDeleteMessage: (messageId: string) => Promise<boolean>
  agentAbort: (chatId: string) => Promise<boolean>
  agentSessions: () => Promise<AgentSessionInfo[]>
  agentNewSession: (title?: string) => Promise<AgentSessionInfo>
  agentMessages: (sessionId: string) => Promise<AgentStoredMessage[]>
  agentRenameSession: (id: string, title: string) => Promise<boolean>
  agentDeleteSession: (id: string) => Promise<boolean>
  llmCcSwitchList: () => Promise<CcSwitchScanResult>
  llmCcSwitchImport: (ids: string[]) => Promise<CcSwitchImportResult>
}

declare global { interface Window { api: ElectronAPI } }
