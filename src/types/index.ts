// ===== 共享类型定义 =====

export interface Entry {
  id: string
  title: string
  contentMd: string
  contentHtml: string
  date: string
  createdAt: string
  updatedAt: string
  isPinned: boolean
  wordCount: number
  tags?: Tag[]
}

export interface EntryFilter {
  date?: string
  tagId?: string
  pinnedOnly?: boolean
  limit?: number
  offset?: number
}

export interface CreateEntryDTO {
  title?: string
  contentMd?: string
  contentHtml?: string
  date: string
  tags?: string[]
}

export interface UpdateEntryDTO {
  title?: string
  contentMd?: string
  contentHtml?: string
  date?: string
  isPinned?: boolean
  tags?: string[]
}

export interface Tag {
  id: string
  name: string
  color: string
}

export type TabName = 'blog' | 'schedule' | 'knowledge' | 'export'

export interface ElectronAPI {
  // 窗口控制
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (maximized: boolean) => void) => void

  // 博文
  getEntries: (filter: EntryFilter) => Promise<Entry[]>
  getEntryById: (id: string) => Promise<(Entry & { tags: Tag[] }) | null>
  createEntry: (data: CreateEntryDTO) => Promise<Entry>
  updateEntry: (id: string, data: UpdateEntryDTO) => Promise<Entry>
  deleteEntry: (id: string) => Promise<void>
  searchEntries: (query: string) => Promise<Entry[]>

  // 标签
  getTags: () => Promise<Tag[]>
  createTag: (name: string, color?: string) => Promise<Tag>
  deleteTag: (id: string) => Promise<void>

  // 数据库
  getDbPath: () => Promise<string>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
