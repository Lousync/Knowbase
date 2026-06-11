import type { ElectronAPI, Entry, EntryFilter, CreateEntryDTO, UpdateEntryDTO, Tag } from '../types'

function api(): ElectronAPI {
  if (!window.api) throw new Error('Electron API not available.')
  return window.api
}

// ===== 窗口控制 =====
export const minimize = () => api().minimize()
export const maximize = () => api().maximize()
export const close = () => api().close()
export const isMaximized = () => api().isMaximized()
export const onMaximizeChange = (cb: (v: boolean) => void) => api().onMaximizeChange(cb)

// ===== 博文 =====
export const getEntries = (f: EntryFilter = {}) => api().getEntries(f)
export const getEntryById = (id: string) => api().getEntryById(id)
export const createEntry = (d: CreateEntryDTO) => api().createEntry(d)
export const updateEntry = (id: string, d: UpdateEntryDTO) => api().updateEntry(id, d)
export const deleteEntry = (id: string) => api().deleteEntry(id)
export const searchEntries = (q: string) => api().searchEntries(q)

// ===== 标签 =====
export const getTags = () => api().getTags()
export const createTag = (n: string, c?: string) => api().createTag(n, c)
export const deleteTag = (id: string) => api().deleteTag(id)

// ===== 数据库 =====
export const getDbPath = () => api().getDbPath()
