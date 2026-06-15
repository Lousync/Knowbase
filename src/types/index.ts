// ===== 共享类型 =====

export interface Entry {
  id: string; title: string; contentMd: string; contentHtml: string
  date: string; createdAt: string; updatedAt: string
  isPinned: boolean; wordCount: number; tags?: Tag[]
}
export interface EntryFilter { date?: string; tagId?: string; pinnedOnly?: boolean; limit?: number; offset?: number }
export interface CreateEntryDTO { title?: string; contentMd?: string; contentHtml?: string; date: string; tags?: string[] }
export interface UpdateEntryDTO { title?: string; contentMd?: string; contentHtml?: string; date?: string; isPinned?: boolean; tags?: string[] }
export interface Tag { id: string; name: string; color: string }
export type TabName = 'blog' | 'schedule' | 'knowledge' | 'export'
export interface AppSettings { showLineNumbers?: boolean }

// schedule
export interface ScheduleTodo {
  id: string; title: string; description: string; date: string
  time: string | null; quadrant: number
  taskType: 'deadline' | 'plan' | 'daily'; tagId: string | null
  status: 'pending' | 'done'; sortOrder: number
  endCriteria: string
  createdAt: string; updatedAt: string
  tag?: ScheduleTag | null
}
export interface ScheduleTag { id: string; name: string; color: string }
export interface CreateScheduleTodoDTO {
  title: string; description?: string; date: string; time?: string
  quadrant?: number; taskType?: 'deadline' | 'plan' | 'daily'; tagId?: string
  endCriteria?: string
}
export interface UpdateScheduleTodoDTO {
  title?: string; description?: string; date?: string; time?: string | null
  quadrant?: number; taskType?: 'deadline' | 'plan' | 'daily'; tagId?: string | null
  status?: string; endCriteria?: string
}

// knowledge
export interface KnowledgeCategory {
  id: string; name: string; parentId: string | null; sortOrder: number
  children?: KnowledgeCategory[]
}
export interface KnowledgePage {
  id: string; title: string; contentMd: string; contentHtml: string
  categoryId: string | null; isStarred: boolean; sortOrder: number
  createdAt: string; updatedAt: string
  tags?: KnowledgeTag[]
  backlinks?: KnowledgePage[]
}
export interface KnowledgeTag { id: string; name: string; color: string }
export interface CreateKnowledgeCategoryDTO { name: string; parentId?: string | null }
export interface UpdateKnowledgeCategoryDTO { name?: string; parentId?: string | null; sortOrder?: number }
export interface CreateKnowledgePageDTO { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null; tags?: string[] }
export interface UpdateKnowledgePageDTO { title?: string; contentMd?: string; contentHtml?: string; categoryId?: string | null; tags?: string[] }

// import
export interface ImportFileResult {
  path: string
  baseName: string
  content: string
  error?: string
}

// recycle bin
export interface RecycleBinItem {
  id: string
  originalId: string
  module: 'blog' | 'knowledge'
  title: string
  data: any
  deletedAt: string
}

// export
export interface BlogExportData { entries: (Entry & { tags: Tag[] })[]; tags: Tag[] }
export interface ScheduleExportData { todos: (ScheduleTodo & { tag: ScheduleTag | null })[]; tags: ScheduleTag[] }
export interface KnowledgeExportData { categories: KnowledgeCategory[]; pages: (KnowledgePage & { tags: KnowledgeTag[]; backlinks: string[] })[]; tags: KnowledgeTag[] }
export interface AllExportData {
  exportVersion: string; exportedAt: string
  blog: BlogExportData; schedule: ScheduleExportData; knowledge: KnowledgeExportData
}

export interface ExportFileResult { filePath: string; size: number }
export interface ExportMarkdownProgress { current: number; total: number; currentFile: string; phase: string }
export interface ExportMarkdownResult { fileCount: number; totalSize: number; files: { relPath: string; size: number }[] }

export interface ElectronAPI {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (cb: (v: boolean) => void) => void
  setAlwaysOnTop: (onTop: boolean) => Promise<boolean>
  isAlwaysOnTop: () => Promise<boolean>
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<void>
  getEntries: (f: EntryFilter) => Promise<Entry[]>
  getEntryById: (id: string) => Promise<(Entry & { tags: Tag[] }) | null>
  createEntry: (d: CreateEntryDTO) => Promise<Entry>
  updateEntry: (id: string, d: UpdateEntryDTO) => Promise<Entry>
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
  // import
  showImportOpenDialog: () => Promise<string[]>
  readImportFiles: (paths: string[]) => Promise<ImportFileResult[]>
  showImportDataDialog: () => Promise<string[]>
  readImportFile: (filePath: string) => Promise<string | null>
  executeImport: (data: object) => Promise<{ success: boolean; imported: number; skipped: number; message: string }>
  importDb: (srcPath: string) => Promise<{ success: boolean; message: string }>
  // recycle bin
  getRecycleBinItems: () => Promise<RecycleBinItem[]>
  restoreRecycleBinItem: (id: string) => Promise<void>
  permanentlyDeleteRecycleBinItem: (id: string) => Promise<void>
  emptyRecycleBin: () => Promise<void>
  purgeExpiredRecycleBinItems: () => Promise<void>
  exportAllBlogData: () => Promise<BlogExportData>
  exportAllScheduleData: () => Promise<ScheduleExportData>
  exportAllKnowledgeData: () => Promise<KnowledgeExportData>
  exportAllData: () => Promise<AllExportData>
  showExportSaveDialog: (opts: { defaultName: string; filters: { name: string; extensions: string[] }[] }) => Promise<{ filePath: string | null }>
  showExportOpenDirDialog: () => Promise<{ dirPath: string | null }>
  writeExportTextFile: (filePath: string, content: string, encoding?: string) => Promise<ExportFileResult>
  copyDbFile: (destPath: string) => Promise<ExportFileResult>
  writeMarkdownExport: (dirPath: string, files: { relPath: string; content: string }[], encoding?: string) => Promise<ExportMarkdownResult>
  onMarkdownExportProgress: (cb: (p: ExportMarkdownProgress) => void) => () => void
}

declare global { interface Window { api: ElectronAPI } }
