import type { ElectronAPI, Entry, EntryFilter, CreateEntryDTO, UpdateEntryDTO, Tag, CreateScheduleTodoDTO, UpdateScheduleTodoDTO, CreateKnowledgeCategoryDTO, UpdateKnowledgeCategoryDTO, CreateKnowledgePageDTO, UpdateKnowledgePageDTO, KnowledgeTag, ExportFileResult, UserProfile, UserStats, UserExportData, UserImportData, MomentsPost, CreateMomentsPostDTO, UpdateMomentsPostDTO, MomentsAlbum, AttachmentMeta, CreateHabitDTO, UpdateHabitDTO, SuperviseConfig, AiToolsListResult, AiToolInvokeResult, AiToolUsage, AuditEntryInfo, McpServerInfo, McpServerDraft, McpToolPreview, McpTestResult, SkillInfo, LlmProviderInfo, LlmProviderDraft, LlmProviderType, LlmTestResultInfo, LlmModelTestResultInfo, LlmUsageInfo, AgentChatMessage, AgentChatResult, AgentContextInfo, AgentSessionInfo, AgentStoredMessage, CcSwitchScanResult, CcSwitchImportResult } from '../types'
import type { SettingsKey, SettingsValue, AppSettings } from './settings'
import { SETTINGS_DEFAULTS } from './settings'
const a = () => { if (!window.api) throw new Error('Electron API not available.'); return window.api }

export const getPathForFile = (file: File): string => a().getPathForFile(file)
export const copyImage = (src: { path?: string; dataUrl?: string }): Promise<boolean> => a().copyImage(src)
export const copyText = (text: string): Promise<boolean> => a().copyText(text)

// ===== Typed settings =====

/** Get a typed setting value, with its default as fallback */
export async function getSetting<K extends SettingsKey>(key: K): Promise<SettingsValue<K>> {
  const raw = await a().getSetting(String(key))
  return (raw ?? SETTINGS_DEFAULTS[key]) as SettingsValue<K>
}

/** Set a typed setting value — key and value type are linked */
export async function setSetting<K extends SettingsKey>(key: K, value: SettingsValue<K>): Promise<void> {
  await a().setSetting(String(key), value)
}

/** Get all settings at once, with defaults filled for any missing keys */
export async function getAllSettings(): Promise<AppSettings> {
  const s = await a().getAllSettings()
  return { ...SETTINGS_DEFAULTS, ...s } as AppSettings
}

// Raw variants for dynamic-key use cases (e.g. sidebar width keys)
export const getSettingRaw = (k: string) => a().getSetting(k)
export const setSettingRaw = (k: string, v: unknown) => a().setSetting(k, v)

// ===== Window control =====
export const minimize = () => a().minimize()
export const maximize = () => a().maximize()
export const close = () => a().close()
export const isMaximized = () => a().isMaximized()
export const onMaximizeChange = (cb: (v: boolean) => void) => a().onMaximizeChange(cb)
export const openDirDialog = () => a().openDirDialog()

// ===== Data =====
export const clearAllData = (): Promise<{ success: boolean; error?: string }> => a().clearAllData()
export const reloadWindow = () => a().reloadWindow()

// ===== Blog =====
export const getEntries = (f: EntryFilter = {}) => a().getEntries(f)
export const getEntryById = (id: string) => a().getEntryById(id)
export const createEntry = (d: CreateEntryDTO) => a().createEntry(d)
export const updateEntry = (id: string, d: UpdateEntryDTO) => a().updateEntry(id, d)
export const deleteEntry = (id: string) => a().deleteEntry(id)
export const toggleEntryStar = (id: string) => a().toggleEntryStar(id)
export const searchEntries = (q: string) => a().searchEntries(q)
export const getTags = () => a().getTags()
export const createTag = (n: string, c?: string) => a().createTag(n, c)
export const deleteTag = (id: string) => a().deleteTag(id)
export const getDbPath = () => a().getDbPath()

// schedule
export const getScheduleTodos = (date: string) => a().getScheduleTodos(date)
export const getScheduleDates = (yearMonth: string) => a().getScheduleDates(yearMonth)
export const getScheduleMonthTodos = (yearMonth: string) => a().getScheduleMonthTodos(yearMonth)
export const getScheduleDeadlineCounts = (yearMonth: string) => a().getScheduleDeadlineCounts(yearMonth)
export const getScheduleSubtasks = (parentId: string) => a().getScheduleSubtasks(parentId)
export const createScheduleTodo = (d: CreateScheduleTodoDTO) => a().createScheduleTodo(d)
export const updateScheduleTodo = (id: string, d: UpdateScheduleTodoDTO) => a().updateScheduleTodo(id, d)
export const deleteScheduleTodo = (id: string) => a().deleteScheduleTodo(id)
export const getScheduleTags = () => a().getScheduleTags()
export const createScheduleTag = (n: string, c?: string) => a().createScheduleTag(n, c)
export const deleteScheduleTag = (id: string) => a().deleteScheduleTag(id)

// knowledge (Scheme A)
export const getKnowledgeCategories = () => a().getKnowledgeCategories()
export const createKnowledgeCategory = (d: CreateKnowledgeCategoryDTO) => a().createKnowledgeCategory(d)
export const updateKnowledgeCategory = (id: string, d: UpdateKnowledgeCategoryDTO) => a().updateKnowledgeCategory(id, d)
export const deleteKnowledgeCategory = (id: string) => a().deleteKnowledgeCategory(id)
export const getKnowledgePages = (categoryId?: string | null) => a().getKnowledgePages(categoryId)
export const getKnowledgePageById = (id: string) => a().getKnowledgePageById(id)
export const createKnowledgePage = (d: CreateKnowledgePageDTO) => a().createKnowledgePage(d)
export const updateKnowledgePage = (id: string, d: UpdateKnowledgePageDTO) => a().updateKnowledgePage(id, d)
export const deleteKnowledgePage = (id: string) => a().deleteKnowledgePage(id)
export const searchKnowledgePages = (q: string) => a().searchKnowledgePages(q)
export const getKnowledgeBacklinks = (pageId: string) => a().getKnowledgeBacklinks(pageId)
export const getKnowledgeBacklinkContext = (pageId: string) => a().getKnowledgeBacklinkContext(pageId)
export const getKnowledgeManualLinks = (pageId: string) => a().getKnowledgeManualLinks(pageId)
export const addKnowledgeManualLink = (pageId: string, targetId: string) => a().addKnowledgeManualLink(pageId, targetId)
export const removeKnowledgeManualLink = (pageIdA: string, pageIdB: string) => a().removeKnowledgeManualLink(pageIdA, pageIdB)
export const updateKnowledgeLinks = (pageId: string, linkedTitles: string[]) => a().updateKnowledgeLinks(pageId, linkedTitles)
export const getKnowledgeTags = () => a().getKnowledgeTags()
export const createKnowledgeTag = (n: string, c?: string) => a().createKnowledgeTag(n, c)
export const deleteKnowledgeTag = (id: string) => a().deleteKnowledgeTag(id)
export const toggleKnowledgeStar = (id: string) => a().toggleKnowledgeStar(id)
export const getKnowledgeStarredPages = () => a().getKnowledgeStarredPages()
export const moveKnowledgePage = (id: string, direction: 'up' | 'down') => a().moveKnowledgePage(id, direction)
export const reorderKnowledgePage = (id: string, targetIndex: number) => a().reorderKnowledgePage(id, targetIndex)
export const moveKnowledgeCategory = (id: string, direction: 'up' | 'down') => a().moveKnowledgeCategory(id, direction)
export const duplicateKnowledgePage = (data: { pageId: string; targetCategoryId?: string | null }) => a().duplicateKnowledgePage(data)
export const duplicateKnowledgeCategory = (data: { categoryId: string; targetParentId?: string | null }) => a().duplicateKnowledgeCategory(data)

// export
export const showExportSaveDialog = (opts: { defaultName: string; filters: { name: string; extensions: string[] }[] }) => a().showExportSaveDialog(opts)
export const writeExportTextFile = (filePath: string, content: string, encoding?: string): Promise<ExportFileResult> => a().writeExportTextFile(filePath, content, encoding)

// import
export const showImportOpenDialog = () => a().showImportOpenDialog()
export const readImportFiles = (paths: string[]) => a().readImportFiles(paths)
export const importPdf = (base64: string, fileName: string) => a().importPdf(base64, fileName)
export const importPdfFile = (filePath: string) => a().importPdfFile(filePath)
export const importBinary = (base64: string, fileName: string, fileType: string) => a().importBinary(base64, fileName, fileType)
export const importBinaryFile = (filePath: string, fileType: string) => a().importBinaryFile(filePath, fileType)
export const showFolderDialog = () => a().showFolderDialog()
export const importFolder = (folderPath: string, parentCategoryId: string | null) => a().importFolder(folderPath, parentCategoryId)
export const openExternal = (filePath: string) => a().openExternal(filePath)
export const getAppVersion = () => a().getAppVersion()
export const checkForUpdate = () => a().checkForUpdate()
export const downloadUpdate = (url: string, name: string, size?: number) => a().downloadUpdate(url, name, size)
export const installUpdate = (filePath: string) => a().installUpdate(filePath)
export const onUpdateDownloadProgress = (cb: (p: { percent: number; receivedBytes: number; totalBytes: number }) => void) => a().onUpdateDownloadProgress(cb)
export const pluginFetchRegistry = () => a().pluginFetchRegistry()
export const pluginInstall = (url: string) => a().pluginInstall(url)
export const pluginInstallFromFile = () => a().pluginInstallFromFile()
export const pluginListInstalled = () => a().pluginListInstalled()
export const pluginSetEnabled = (id: string, enabled: boolean) => a().pluginSetEnabled(id, enabled)
export const pluginUninstall = (id: string) => a().pluginUninstall(id)
export const pluginGetContribution = (id: string, key: string) => a().pluginGetContribution(id, key)
export const pluginSetGranted = (id: string, caps: string[]) => a().pluginSetGranted(id, caps)
export const pluginAuditList = (id?: string) => a().pluginAuditList(id)
export const pluginAuditClear = (id?: string) => a().pluginAuditClear(id)
export const pluginAuditWrite = (id: string, action: string, detail?: unknown) => a().pluginAuditWrite(id, action, detail)
export const knowledgePackGetState = (pluginId: string) => a().knowledgePackGetState(pluginId)
export const knowledgePackImport = (pluginId: string, overwriteModified: boolean, forceExternalIds?: string[]) => a().knowledgePackImport(pluginId, overwriteModified, forceExternalIds)
export const onKnowledgePackProgress = (cb: (p: { pluginId: string; current: number; total: number; title: string }) => void) => a().onKnowledgePackProgress(cb)
export const getAttachmentsPath = () => a().getAttachmentsPath()
export const showImportDataDialog = () => a().showImportDataDialog()
export const readImportFile = (filePath: string) => a().readImportFile(filePath)
export const executeImport = (data: object) => a().executeImport(data)
export const importDb = (srcPath: string) => a().importDb(srcPath)
export const previewUserFromDb = (filePath: string) => a().previewUserFromDb(filePath)

// recycle bin
export const getRecycleBinItems = () => a().getRecycleBinItems()
export const restoreRecycleBinItem = (id: string) => a().restoreRecycleBinItem(id)
export const restoreRecycleBinPartial = (id: string, path: string) => a().restoreRecycleBinPartial(id, path)
export const trashRecycleBinItem = (id: string) => a().trashRecycleBinItem(id)
export const trashAllRecycleBin = () => a().trashAllRecycleBin()
export const trashRecycleBinPartial = (id: string, path: string) => a().trashRecycleBinPartial(id, path)
export const emptyRecycleBin = () => a().emptyRecycleBin()
export const purgeExpiredRecycleBinItems = () => a().purgeExpiredRecycleBinItems()

// ===== User =====
export const getUserProfile = (): Promise<UserProfile | null> => a().getUserProfile()
export const setUserUsername = (username: string) => a().setUserUsername(username)
export const setUserPassword = (password: string) => a().setUserPassword(password)
export const verifyUserPassword = (password: string): Promise<boolean> => a().verifyUserPassword(password)
export const verifyImportPassword = (password: string, storedHash: string): Promise<boolean> => a().verifyImportPassword(password, storedHash)
export const hasUserPassword = (): Promise<boolean> => a().hasUserPassword()
export const changeUserPassword = (oldPassword: string, newPassword: string) => a().changeUserPassword(oldPassword, newPassword)
export const clearUserPassword = (password: string) => a().clearUserPassword(password)
export const pickAvatarFile = (): Promise<string | null> => a().pickAvatarFile()
export const saveAvatar = (sourcePath: string) => a().saveAvatar(sourcePath)
export const getAvatarBase64 = (): Promise<string | null> => a().getAvatarBase64()
export const getUserStats = (): Promise<UserStats> => a().getUserStats()
export const getUserExportData = (): Promise<UserExportData | null> => a().getUserExportData()
export const restoreUserFromImport = (data: UserImportData) => a().restoreUserFromImport(data)

// ===== Toolbox =====
export const getToolboxScripts = () => a().getToolboxScripts()
export const getToolboxScriptById = (id: string) => a().getToolboxScriptById(id)
export const createToolboxScript = (d: { name?: string; description?: string; content?: string; language?: string }) => a().createToolboxScript(d)
export const updateToolboxScript = (id: string, d: { name?: string; description?: string; content?: string; language?: string; sortOrder?: number }) => a().updateToolboxScript(id, d)
export const deleteToolboxScript = (id: string) => a().deleteToolboxScript(id)
export const reorderToolboxScripts = (ids: string[]) => a().reorderToolboxScripts(ids)

// ===== Password Vault =====
export const getPasswordEntries = () => a().getPasswordEntries()
export const getPasswordEntryById = (id: string) => a().getPasswordEntryById(id)
export const createPasswordEntry = (d: { title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string }) => a().createPasswordEntry(d)
export const updatePasswordEntry = (id: string, d: { title?: string; url?: string; username?: string; account?: string; password?: string; notes?: string; sortOrder?: number }) => a().updatePasswordEntry(id, d)
export const deletePasswordEntry = (id: string) => a().deletePasswordEntry(id)

// moments
export const getMomentsPosts = () => a().getMomentsPosts()
export const getMomentsPostById = (id: string) => a().getMomentsPostById(id)
export const createMomentsPost = (d: CreateMomentsPostDTO) => a().createMomentsPost(d)
export const updateMomentsPost = (id: string, d: UpdateMomentsPostDTO) => a().updateMomentsPost(id, d)
export const deleteMomentsPost = (id: string) => a().deleteMomentsPost(id)
export const toggleMomentsPin = (id: string) => a().toggleMomentsPin(id)
export const getMomentsAlbums = (): Promise<MomentsAlbum[]> => a().getMomentsAlbums()
export const createMomentsAlbum = (name: string) => a().createMomentsAlbum(name)
export const renameMomentsAlbum = (id: string, name: string) => a().renameMomentsAlbum(id, name)
export const deleteMomentsAlbum = (id: string) => a().deleteMomentsAlbum(id)
export const setMomentsPostAlbum = (postId: string, albumId: string) => a().setMomentsPostAlbum(postId, albumId)
export const setMomentsAlbumCover = (albumId: string, postId: string, index: number) => a().setMomentsAlbumCover(albumId, postId, index)
// attachments
export const uploadAttachments = (data: { ownerType?: string; ownerId?: string; files: { name?: string; mime?: string; dataUrl?: string; base64?: string; thumbDataUrl?: string }[] }) => a().uploadAttachments(data)
export const uploadAttachmentFromPath = (data: { ownerType?: string; ownerId?: string; filePath: string }) => a().uploadAttachmentFromPath(data)
export const getAttachmentsByOwner = (ownerType: string, ownerId: string): Promise<AttachmentMeta[]> => a().getAttachmentsByOwner(ownerType, ownerId)
export const deleteAttachment = (id: string) => a().deleteAttachment(id)
export const getAttachmentPath = (id: string): Promise<string | null> => a().getAttachmentPath(id)
export const readAttachmentBase64 = (id: string): Promise<string | null> => a().readAttachmentBase64(id)
export const readAttachmentBase64ByFileName = (fileName: string): Promise<string | null> => a().readAttachmentBase64ByFileName(fileName)
export const cleanupOrphanAttachments = () => a().cleanupOrphanAttachments()

/** 把应用内的图片 URL（attachment:// 或 data:）复制到系统剪贴板 */
export async function copyImageUrlToClipboard(url: string): Promise<boolean> {
  if (!url) return false
  if (url.startsWith('attachment://')) {
    const m = /attachment:\/\/([^/?#]+)/.exec(url)
    if (!m) return false
    const path = await getAttachmentPath(m[1])
    return path ? copyImage({ path }) : false
  }
  if (url.startsWith('data:')) return copyImage({ dataUrl: url })
  return false
}
export const exportBackupToZip = (zipPath: string, moduleIds?: string[]) => a().exportBackupToZip(zipPath, moduleIds)
export const importBackupPackage = (srcPath: string) => a().importBackupPackage(srcPath)
// ===== Weight Tracker =====
export const getWeightRecords = () => a().getWeightRecords()
export const getWeightSeries = () => a().getWeightSeries()
export const createWeightRecord = (d: { weight: number; date: string; series?: string; note?: string }) => a().createWeightRecord(d)
export const updateWeightRecord = (id: string, d: { weight?: number; date?: string; series?: string; note?: string }) => a().updateWeightRecord(id, d)
export const deleteWeightRecord = (id: string) => a().deleteWeightRecord(id)

// ===== Checkin =====
export const habitGetAll = () => a().habitGetAll()
export const createHabit = (d: CreateHabitDTO) => a().createHabit(d)
export const updateHabit = (id: string, d: UpdateHabitDTO) => a().updateHabit(id, d)
export const deleteHabit = (id: string) => a().deleteHabit(id)
export const toggleHabitCheck = (habitId: string, date: string) => a().toggleHabitCheck(habitId, date)
export const reorderHabits = (orderedIds: string[]) => a().reorderHabits(orderedIds)

// ===== Bookmark Nav =====
export const bookmarkGetAll = () => a().bookmarkGetAll()
export const createBookmarkCategory = (d: { name: string; color?: string }) => a().createBookmarkCategory(d)
export const updateBookmarkCategory = (id: string, d: { name?: string; color?: string }) => a().updateBookmarkCategory(id, d)
export const deleteBookmarkCategory = (id: string) => a().deleteBookmarkCategory(id)
export const reorderBookmarkCategories = (orderedIds: string[]) => a().reorderBookmarkCategories(orderedIds)
export const createBookmarkItem = (d: { title: string; url: string; description?: string; categoryId?: string }) => a().createBookmarkItem(d)
export const updateBookmarkItem = (id: string, d: { title?: string; url?: string; description?: string; categoryId?: string | null }) => a().updateBookmarkItem(id, d)
export const deleteBookmarkItem = (id: string) => a().deleteBookmarkItem(id)
export const openBookmarkUrl = (url: string) => a().openBookmarkUrl(url)
export const pickBookmarkImportFile = () => a().pickBookmarkImportFile()

// ===== Remote Supervise =====
export const superviseGetConfig = (): Promise<SuperviseConfig> => a().superviseGetConfig()
export const superviseSaveConfig = (partial: Partial<SuperviseConfig>): Promise<SuperviseConfig> => a().superviseSaveConfig(partial)
export const superviseTest = (): Promise<{ ok: boolean; error?: string }> => a().superviseTest()
export const superviseGetHistory = (limit?: number) => a().superviseGetHistory(limit)
export const superviseRetry = (id: number) => a().superviseRetry(id)
export const superviseRetryAllFailed = (): Promise<{ total: number; ok: number }> => a().superviseRetryAllFailed()
export const superviseSendDailyNow = (): Promise<{ ok: boolean; skipped?: string; error?: string }> => a().superviseSendDailyNow()
export const superviseClearHistory = (): Promise<void> => a().superviseClearHistory()

// ===== Period Summary (weekly / monthly) =====
export const createPomodoroSession = (minutes: number): Promise<boolean> => a().createPomodoroSession(minutes)
export interface PeriodStats {
  checkins: number
  blogEntries: number
  knowledgePages: number
  pomodoroMinutes: number
  scheduleDone: number
}
export const getBlogPeriodStats = (start: string, end: string): Promise<PeriodStats> => a().getBlogPeriodStats(start, end)

// ===== Blog Templates =====
export const listBlogTemplates = () => a().listBlogTemplates()
export const createBlogTemplate = (d: { name: string; contentMd?: string }) => a().createBlogTemplate(d)
export const updateBlogTemplate = (id: string, d: { name?: string; contentMd?: string }) => a().updateBlogTemplate(id, d)
export const deleteBlogTemplate = (id: string) => a().deleteBlogTemplate(id)

// ===== AI Tools (ToolRegistry) =====
export const aiToolsList = (): Promise<AiToolsListResult> => a().aiToolsList()
export const aiToolsInvoke = (name: string, args?: unknown): Promise<AiToolInvokeResult> => a().aiToolsInvoke(name, args)
export const aiToolsGetUsage = (): Promise<AiToolUsage> => a().aiToolsGetUsage()
export const aiToolsGetRecentAudit = (limit?: number): Promise<AuditEntryInfo[]> => a().aiToolsGetRecentAudit(limit)

// ===== MCP Servers =====
export const mcpListServers = (): Promise<McpServerInfo[]> => a().mcpListServers()
export const mcpAddServer = (draft: McpServerDraft): Promise<McpServerInfo> => a().mcpAddServer(draft)
export const mcpUpdateServer = (id: string, patch: Partial<McpServerDraft>): Promise<McpServerInfo | null> => a().mcpUpdateServer(id, patch)
export const mcpRemoveServer = (id: string): Promise<boolean> => a().mcpRemoveServer(id)
export const mcpToggleServer = (id: string, enabled: boolean): Promise<{ ok: boolean; error?: string } & Partial<McpServerInfo>> => a().mcpToggleServer(id, enabled)
export const mcpListTools = (id: string): Promise<{ tools: McpToolPreview[] }> => a().mcpListTools(id)
export const mcpRefreshTools = (id: string): Promise<{ ok: boolean; error?: string; tools: McpToolPreview[] }> => a().mcpRefreshTools(id)
export const mcpTestConnection = (draft: McpServerDraft): Promise<McpTestResult> => a().mcpTestConnection(draft)

// ===== Skills =====
export const aiToolsListSkills = (): Promise<{ skills: SkillInfo[] }> => a().aiToolsListSkills()
export const aiToolsCopySkillPrompt = (pluginId: string, skillId: string): Promise<boolean> => a().aiToolsCopySkillPrompt(pluginId, skillId)

// ===== Model Gateway + AI 对话 =====
export const llmListProviders = (): Promise<{ providers: LlmProviderInfo[]; defaultChatModel: string }> => a().llmListProviders()
export const llmSaveProvider = (d: LlmProviderDraft): Promise<{ ok: boolean; id?: string; error?: string }> => a().llmSaveProvider(d)
export const llmRemoveProvider = (id: string): Promise<{ ok: boolean }> => a().llmRemoveProvider(id)
export const llmToggleProvider = (id: string, enabled: boolean): Promise<{ ok: boolean }> => a().llmToggleProvider(id, enabled)
export const llmTestConnection = (d: { type: LlmProviderType; baseUrl: string; apiKey?: string }): Promise<LlmTestResultInfo> => a().llmTestConnection(d)
export const llmRefreshModels = (id: string): Promise<{ ok: boolean; models: string[]; error?: string }> => a().llmRefreshModels(id)
export const llmAddModel = (id: string, model: string): Promise<{ ok: boolean; models: string[]; error?: string }> => a().llmAddModel(id, model)
export const llmSetDefaultModel = (value: string): Promise<{ ok: boolean }> => a().llmSetDefaultModel(value)
export const llmTestModel = (providerId: string, model: string): Promise<LlmModelTestResultInfo> => a().llmTestModel(providerId, model)
export const llmGetUsage = (): Promise<LlmUsageInfo> => a().llmGetUsage()
export const agentChat = (sessionId: string, message: string, context?: AgentContextInfo, chatId?: string): Promise<AgentChatResult> => a().agentChat({ sessionId, message, context, chatId })
export const agentRegenerate = (sessionId: string, context?: AgentContextInfo, chatId?: string): Promise<AgentChatResult> => a().agentRegenerate({ sessionId, context, chatId })
export const agentEditMessage = (sessionId: string, messageId: string, message: string, context?: AgentContextInfo, chatId?: string): Promise<AgentChatResult> => a().agentEditMessage({ sessionId, messageId, message, context, chatId })
export const agentDeleteMessage = (messageId: string): Promise<boolean> => a().agentDeleteMessage(messageId)
export const agentAbort = (chatId: string): Promise<boolean> => a().agentAbort(chatId)
export const agentSessions = (): Promise<AgentSessionInfo[]> => a().agentSessions()
export const agentNewSession = (title?: string): Promise<AgentSessionInfo> => a().agentNewSession(title)
export const agentMessages = (sessionId: string): Promise<AgentStoredMessage[]> => a().agentMessages(sessionId)
export const agentRenameSession = (id: string, title: string): Promise<boolean> => a().agentRenameSession(id, title)
export const agentDeleteSession = (id: string): Promise<boolean> => a().agentDeleteSession(id)
export const llmCcSwitchList = (): Promise<CcSwitchScanResult> => a().llmCcSwitchList()
export const llmCcSwitchImport = (ids: string[]): Promise<CcSwitchImportResult> => a().llmCcSwitchImport(ids)
