import type { ElectronAPI, Entry, EntryFilter, CreateEntryDTO, UpdateEntryDTO, Tag, CreateScheduleTodoDTO, UpdateScheduleTodoDTO, CreateKnowledgeCategoryDTO, UpdateKnowledgeCategoryDTO, CreateKnowledgePageDTO, UpdateKnowledgePageDTO, KnowledgeTag, ExportFileResult, ExportMarkdownProgress, ExportMarkdownResult, UserProfile, UserStats, UserExportData, UserImportData } from '../types'
import type { SettingsKey, SettingsValue, AppSettings } from './settings'
import { SETTINGS_DEFAULTS } from './settings'
const a = () => { if (!window.api) throw new Error('Electron API not available.'); return window.api }

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
export const exportAllBlogData = () => a().exportAllBlogData()
export const exportAllScheduleData = () => a().exportAllScheduleData()
export const exportAllKnowledgeData = () => a().exportAllKnowledgeData()
export const exportAllData = () => a().exportAllData()

export const showExportSaveDialog = (opts: { defaultName: string; filters: { name: string; extensions: string[] }[] }) => a().showExportSaveDialog(opts)
export const showExportOpenDirDialog = () => a().showExportOpenDirDialog()
export const writeExportTextFile = (filePath: string, content: string, encoding?: string): Promise<ExportFileResult> => a().writeExportTextFile(filePath, content, encoding)
export const copyDbFile = (destPath: string): Promise<ExportFileResult> => a().copyDbFile(destPath)
export const writeMarkdownExport = (dirPath: string, files: { relPath: string; content: string }[], encoding?: string): Promise<ExportMarkdownResult> => a().writeMarkdownExport(dirPath, files, encoding)
export const onMarkdownExportProgress = (cb: (p: ExportMarkdownProgress) => void): (() => void) =>
  a().onMarkdownExportProgress(cb)

// import
export const showImportOpenDialog = () => a().showImportOpenDialog()
export const readImportFiles = (paths: string[]) => a().readImportFiles(paths)
export const importPdf = (base64: string, fileName: string) => a().importPdf(base64, fileName)
export const importPdfFile = (filePath: string) => a().importPdfFile(filePath)
export const openExternal = (filePath: string) => a().openExternal(filePath)
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

// ===== AI =====
export const aiChat = (opts: { messages: { role: string; content: string }[] }) => a().aiChat(opts)
