import { contextBridge, ipcRenderer } from 'electron'

const api = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (v: boolean) => void) => {
    ipcRenderer.on('window:maximizeChange', (_e, v) => cb(v))
  },
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getEntries: (filter: unknown) => ipcRenderer.invoke('db:getEntries', filter),
  getEntryById: (id: string) => ipcRenderer.invoke('db:getEntryById', id),
  createEntry: (data: unknown) => ipcRenderer.invoke('db:createEntry', data),
  updateEntry: (id: string, data: unknown) => ipcRenderer.invoke('db:updateEntry', id, data),
  deleteEntry: (id: string) => ipcRenderer.invoke('db:deleteEntry', id),
  searchEntries: (query: string) => ipcRenderer.invoke('db:searchEntries', query),
  getTags: () => ipcRenderer.invoke('db:getTags'),
  createTag: (name: string, color?: string) => ipcRenderer.invoke('db:createTag', name, color),
  deleteTag: (id: string) => ipcRenderer.invoke('db:deleteTag', id),
  getDbPath: () => ipcRenderer.invoke('db:getPath'),

  // schedule
  getScheduleTodos: (date: string) => ipcRenderer.invoke('schedule:getTodos', date),
  getScheduleDates: (yearMonth: string) => ipcRenderer.invoke('schedule:getDatesWithTodos', yearMonth),
  getScheduleMonthTodos: (yearMonth: string) => ipcRenderer.invoke('schedule:getMonthTodos', yearMonth),
  getScheduleDeadlineCounts: (yearMonth: string) => ipcRenderer.invoke('schedule:getDeadlineCounts', yearMonth),
  createScheduleTodo: (data: unknown) => ipcRenderer.invoke('schedule:createTodo', data),
  updateScheduleTodo: (id: string, data: unknown) => ipcRenderer.invoke('schedule:updateTodo', id, data),
  deleteScheduleTodo: (id: string) => ipcRenderer.invoke('schedule:deleteTodo', id),
  getScheduleTags: () => ipcRenderer.invoke('schedule:getTags'),
  createScheduleTag: (name: string, color?: string) => ipcRenderer.invoke('schedule:createTag', name, color),
  deleteScheduleTag: (id: string) => ipcRenderer.invoke('schedule:deleteTag', id),

  // knowledge (Scheme A)
  getKnowledgeCategories: () => ipcRenderer.invoke('knowledge:getCategories'),
  createKnowledgeCategory: (data: unknown) => ipcRenderer.invoke('knowledge:createCategory', data),
  updateKnowledgeCategory: (id: string, data: unknown) => ipcRenderer.invoke('knowledge:updateCategory', id, data),
  deleteKnowledgeCategory: (id: string) => ipcRenderer.invoke('knowledge:deleteCategory', id),
  getKnowledgePages: (categoryId?: string | null) => ipcRenderer.invoke('knowledge:getPages', categoryId),
  getKnowledgePageById: (id: string) => ipcRenderer.invoke('knowledge:getPageById', id),
  createKnowledgePage: (data: unknown) => ipcRenderer.invoke('knowledge:createPage', data),
  updateKnowledgePage: (id: string, data: unknown) => ipcRenderer.invoke('knowledge:updatePage', id, data),
  deleteKnowledgePage: (id: string) => ipcRenderer.invoke('knowledge:deletePage', id),
  searchKnowledgePages: (q: string) => ipcRenderer.invoke('knowledge:searchPages', q),
  getKnowledgeBacklinks: (pageId: string) => ipcRenderer.invoke('knowledge:getBacklinks', pageId),
  updateKnowledgeLinks: (pageId: string, linkedTitles: string[]) => ipcRenderer.invoke('knowledge:updateLinks', pageId, linkedTitles),
  getKnowledgeTags: () => ipcRenderer.invoke('knowledge:getTags'),
  createKnowledgeTag: (n: string, c?: string) => ipcRenderer.invoke('knowledge:createTag', n, c),
  deleteKnowledgeTag: (id: string) => ipcRenderer.invoke('knowledge:deleteTag', id),
  toggleKnowledgeStar: (id: string) => ipcRenderer.invoke('knowledge:toggleStar', id),
  getKnowledgeStarredPages: () => ipcRenderer.invoke('knowledge:getStarredPages'),
  moveKnowledgePage: (id: string, direction: string) => ipcRenderer.invoke('knowledge:movePage', id, direction),

  // export
  exportAllBlogData: () => ipcRenderer.invoke('export:getAllBlogData'),
  exportAllScheduleData: () => ipcRenderer.invoke('export:getAllScheduleData'),
  exportAllKnowledgeData: () => ipcRenderer.invoke('export:getAllKnowledgeData'),
  exportAllData: () => ipcRenderer.invoke('export:getAllData')
}

contextBridge.exposeInMainWorld('api', api)
export type ElectronAPI = typeof api
