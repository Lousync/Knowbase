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
  taskType: 'deadline' | 'plan'; tagId: string | null
  status: 'pending' | 'done'; sortOrder: number
  createdAt: string; updatedAt: string
  tag?: ScheduleTag | null
}
export interface ScheduleTag { id: string; name: string; color: string }
export interface CreateScheduleTodoDTO {
  title: string; description?: string; date: string; time?: string
  quadrant?: number; taskType?: 'deadline' | 'plan'; tagId?: string
}
export interface UpdateScheduleTodoDTO {
  title?: string; description?: string; date?: string; time?: string | null
  quadrant?: number; taskType?: 'deadline' | 'plan'; tagId?: string | null; status?: string
}

export interface ElectronAPI {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (cb: (v: boolean) => void) => void
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
  createScheduleTodo: (d: CreateScheduleTodoDTO) => Promise<ScheduleTodo>
  updateScheduleTodo: (id: string, d: UpdateScheduleTodoDTO) => Promise<ScheduleTodo>
  deleteScheduleTodo: (id: string) => Promise<void>
  getScheduleTags: () => Promise<ScheduleTag[]>
  createScheduleTag: (n: string, c?: string) => Promise<ScheduleTag>
  deleteScheduleTag: (id: string) => Promise<void>
}

declare global { interface Window { api: ElectronAPI } }
