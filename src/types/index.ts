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
export type TabName = 'blog' | 'schedule' | 'knowledge' | 'moments' | 'export' | 'recycle' | 'settings' | 'help' | 'user' | 'toolbox'

// ai
export interface AIChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface AIChatResult { content: string; error?: string }

// toolbox
export interface ToolboxScript {
  id: string; name: string; description: string; content: string
  language: string; sortOrder: number
  createdAt: string; updatedAt: string
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
export interface CreateMomentsPostDTO { contentMd?: string; contentHtml?: string; imageDataUrls?: string[]; attachmentIds?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean }
export interface UpdateMomentsPostDTO { contentMd?: string; contentHtml?: string; imageDataUrls?: string[]; attachmentIds?: string[]; tags?: string[]; albumId?: string; isPinned?: boolean }

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
  createdAt: string
  updatedAt: string
}
// weight tracker
export interface WeightRecord { id: string; weight: number; date: string; series: string; note: string; createdAt: string }
export interface CreateWeightDTO { weight: number; date: string; series?: string; note?: string }
export interface UpdateWeightDTO { weight?: number; date?: string; series?: string; note?: string }

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
  categoryType: 'notebook' | 'folder'
  createdAt: string; updatedAt: string
  children?: KnowledgeCategory[]
}
export interface KnowledgePage {
  id: string; title: string; contentMd: string; contentHtml: string
  categoryId: string | null; isStarred: boolean; sortOrder: number
  fileType: string
  attachmentId: string
  createdAt: string; updatedAt: string
  tags?: KnowledgeTag[]
  backlinks?: KnowledgePage[]
}
export interface KnowledgeTag { id: string; name: string; color: string }
export interface CreateKnowledgeCategoryDTO { name: string; parentId?: string | null; categoryType?: 'notebook' | 'folder' }
export interface UpdateKnowledgeCategoryDTO { name?: string; parentId?: string | null; sortOrder?: number; categoryType?: 'notebook' | 'folder' }
export interface CreateKnowledgePageDTO { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null; fileType?: string; filePath?: string; tags?: string[] }
export interface UpdateKnowledgePageDTO { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null; fileType?: string; filePath?: string; tags?: string[] }

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
export interface AllExportData {
  exportVersion: string; exportedAt: string
  user?: UserExportData & { settings: Record<string, unknown>; stats: UserStats }
  blog: BlogExportData; schedule: ScheduleExportData; knowledge: KnowledgeExportData
  passwordVault?: PasswordVaultExportData
  moments?: MomentsExportData
}

export interface ExportFileResult { filePath: string; size: number }
export interface ExportMarkdownProgress { current: number; total: number; currentFile: string; phase: string }
export interface ExportMarkdownResult { fileCount: number; totalSize: number; files: { relPath: string; size: number }[] }

export interface ElectronAPI {
  getPathForFile: (file: File) => string
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
  cleanupOrphanAttachments: () => Promise<{ removed: number }>
  exportBackupToZip: (zipPath: string, moduleIds?: string[]) => Promise<{ filePath: string; fileCount: number; totalSize: number }>
  importBackupPackage: (srcPath: string) => Promise<{ success: boolean; imported: number; skipped: number; attachments: number; message: string }>
  // weight tracker
  getWeightRecords: () => Promise<WeightRecord[]>
  getWeightSeries: () => Promise<string[]>
  createWeightRecord: (d: CreateWeightDTO) => Promise<WeightRecord>
  updateWeightRecord: (id: string, d: UpdateWeightDTO) => Promise<WeightRecord>
  deleteWeightRecord: (id: string) => Promise<void>
  // ai
  aiChat: (opts: { messages: AIChatMessage[] }) => Promise<AIChatResult>
  // fill popup
  isFillPopup: boolean
  fillPopupTheme: string
  fillPopupGetEntries: () => Promise<PasswordEntry[]>
  fillPopupCopy: (field: string, value: string) => Promise<void>
  fillPopupHide: () => Promise<void>
  onFillPopupRefresh: (cb: () => void) => () => void
}

declare global { interface Window { api: ElectronAPI } }
