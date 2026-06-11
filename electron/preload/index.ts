import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ===== 窗口控制 =====
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximizeChange', (_e, maximized) => callback(maximized))
  },

  // ===== 博文 =====
  getEntries: (filter: unknown) => ipcRenderer.invoke('db:getEntries', filter),
  getEntryById: (id: string) => ipcRenderer.invoke('db:getEntryById', id),
  createEntry: (data: unknown) => ipcRenderer.invoke('db:createEntry', data),
  updateEntry: (id: string, data: unknown) => ipcRenderer.invoke('db:updateEntry', id, data),
  deleteEntry: (id: string) => ipcRenderer.invoke('db:deleteEntry', id),
  searchEntries: (query: string) => ipcRenderer.invoke('db:searchEntries', query),

  // ===== 标签 =====
  getTags: () => ipcRenderer.invoke('db:getTags'),
  createTag: (name: string, color?: string) => ipcRenderer.invoke('db:createTag', name, color),
  deleteTag: (id: string) => ipcRenderer.invoke('db:deleteTag', id),

  // ===== 数据库 =====
  getDbPath: () => ipcRenderer.invoke('db:getPath')
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
