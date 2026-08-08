import { contextBridge, ipcRenderer } from 'electron'

const isFillPopup = process.argv.includes('--fill-popup-window')
const fillTheme = isFillPopup
  ? (process.argv.find(a => a.startsWith('--theme=')) || '--theme=dark').split('=')[1]
  : 'dark'

const api = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (v: boolean) => void) => {
    ipcRenderer.on('window:maximizeChange', (_e, v) => cb(v))
  },
  setAlwaysOnTop: (onTop: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', onTop),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:isAlwaysOnTop'),
  reloadWindow: () => ipcRenderer.invoke('window:reload'),
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  openDirDialog: () => ipcRenderer.invoke('dialog:openDir'),
  clearAllData: () => ipcRenderer.invoke('db:clearAllData'),
  getEntries: (filter: unknown) => ipcRenderer.invoke('db:getEntries', filter),
  getEntryById: (id: string) => ipcRenderer.invoke('db:getEntryById', id),
  createEntry: (data: unknown) => ipcRenderer.invoke('db:createEntry', data),
  updateEntry: (id: string, data: unknown) => ipcRenderer.invoke('db:updateEntry', id, data),
  deleteEntry: (id: string) => ipcRenderer.invoke('db:deleteEntry', id),
  toggleEntryStar: (id: string) => ipcRenderer.invoke('db:toggleEntryStar', id),
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
  getScheduleSubtasks: (parentId: string) => ipcRenderer.invoke('schedule:getSubtasks', parentId),
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
  reorderKnowledgePage: (id: string, targetIndex: number) => ipcRenderer.invoke('knowledge:reorderPage', id, targetIndex),
  moveKnowledgeCategory: (id: string, direction: string) => ipcRenderer.invoke('knowledge:moveCategory', id, direction),
  duplicateKnowledgePage: (data: unknown) => ipcRenderer.invoke('knowledge:duplicatePage', data),
  duplicateKnowledgeCategory: (data: unknown) => ipcRenderer.invoke('knowledge:duplicateCategory', data),

  // import
  showImportOpenDialog: () => ipcRenderer.invoke('import:showOpenDialog'),
  readImportFiles: (paths: string[]) => ipcRenderer.invoke('import:readFiles', paths),
  importPdf: (base64: string, fileName: string) => ipcRenderer.invoke('import:importPdf', base64, fileName),
  importPdfFile: (filePath: string) => ipcRenderer.invoke('import:importPdfFile', filePath),
  importBinary: (base64: string, fileName: string, fileType: string) => ipcRenderer.invoke('import:importBinary', base64, fileName, fileType),
  importBinaryFile: (filePath: string, fileType: string) => ipcRenderer.invoke('import:importBinaryFile', filePath, fileType),
  showFolderDialog: () => ipcRenderer.invoke('import:showFolderDialog'),
  importFolder: (folderPath: string, parentCategoryId: string | null) => ipcRenderer.invoke('import:importFolder', folderPath, parentCategoryId),
  openExternal: (filePath: string) => ipcRenderer.invoke('app:openExternal', filePath),
  showImportDataDialog: () => ipcRenderer.invoke('import:showDataDialog'),
  readImportFile: (filePath: string) => ipcRenderer.invoke('import:readFile', filePath),
  executeImport: (data: unknown) => ipcRenderer.invoke('import:executeImport', data),
  importDb: (srcPath: string) => ipcRenderer.invoke('import:importDb', srcPath),
  previewUserFromDb: (filePath: string) => ipcRenderer.invoke('import:previewUserFromDb', filePath),
  getAttachmentsPath: () => ipcRenderer.invoke('app:getAttachmentsPath'),

  // recycle bin
  getRecycleBinItems: () => ipcRenderer.invoke('recycleBin:getItems'),
  restoreRecycleBinItem: (id: string) => ipcRenderer.invoke('recycleBin:restoreItem', id),
  restoreRecycleBinPartial: (id: string, path: string) => ipcRenderer.invoke('recycleBin:restorePartial', id, path),
  trashRecycleBinItem: (id: string) => ipcRenderer.invoke('recycleBin:trashToOS', id),
  trashAllRecycleBin: () => ipcRenderer.invoke('recycleBin:trashAllToOS'),
  trashRecycleBinPartial: (id: string, path: string) => ipcRenderer.invoke('recycleBin:trashPartialToOS', id, path),
  emptyRecycleBin: () => ipcRenderer.invoke('recycleBin:emptyAll'),
  purgeExpiredRecycleBinItems: () => ipcRenderer.invoke('recycleBin:purgeExpired'),

  // user
  getUserProfile: () => ipcRenderer.invoke('user:getProfile'),
  setUserUsername: (username: string) => ipcRenderer.invoke('user:setUsername', username),
  setUserPassword: (password: string) => ipcRenderer.invoke('user:setPassword', password),
  verifyUserPassword: (password: string) => ipcRenderer.invoke('user:verifyPassword', password),
  verifyImportPassword: (password: string, storedHash: string) => ipcRenderer.invoke('user:verifyImportPassword', password, storedHash),
  hasUserPassword: () => ipcRenderer.invoke('user:hasPassword'),
  changeUserPassword: (oldPassword: string, newPassword: string) => ipcRenderer.invoke('user:changePassword', oldPassword, newPassword),
  clearUserPassword: (password: string) => ipcRenderer.invoke('user:clearPassword', password),
  pickAvatarFile: () => ipcRenderer.invoke('user:pickAvatar'),
  saveAvatar: (sourcePath: string) => ipcRenderer.invoke('user:saveAvatar', sourcePath),
  getAvatarBase64: () => ipcRenderer.invoke('user:getAvatarBase64'),
  getUserStats: () => ipcRenderer.invoke('user:getStats'),
  getUserExportData: () => ipcRenderer.invoke('user:getExportData'),
  restoreUserFromImport: (data: unknown) => ipcRenderer.invoke('user:restoreFromImport', data),

  // export
  exportAllBlogData: () => ipcRenderer.invoke('export:getAllBlogData'),
  exportAllScheduleData: () => ipcRenderer.invoke('export:getAllScheduleData'),
  exportAllKnowledgeData: () => ipcRenderer.invoke('export:getAllKnowledgeData'),
  exportAllPasswordVaultData: () => ipcRenderer.invoke('export:getAllPasswordVaultData'),
  exportAllMomentsData: () => ipcRenderer.invoke('export:getAllMomentsData'),
  exportAllData: () => ipcRenderer.invoke('export:getAllData'),
  showExportSaveDialog: (opts: unknown) => ipcRenderer.invoke('export:showSaveDialog', opts),
  showExportOpenDirDialog: () => ipcRenderer.invoke('export:showOpenDirDialog'),
  writeExportTextFile: (filePath: string, content: string, encoding?: string) => ipcRenderer.invoke('export:writeTextFile', filePath, content, encoding),
  copyDbFile: (destPath: string) => ipcRenderer.invoke('export:copyDbFile', destPath),
  writeMarkdownExport: (dirPath: string, files: unknown, encoding?: string) => ipcRenderer.invoke('export:writeMarkdownExport', dirPath, files, encoding),
  onMarkdownExportProgress: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on('export:markdownProgress', handler)
    return () => ipcRenderer.removeListener('export:markdownProgress', handler)
  },

  // toolbox - scripts CRUD
  getToolboxScripts: () => ipcRenderer.invoke('toolbox:getScripts'),
  getToolboxScriptById: (id: string) => ipcRenderer.invoke('toolbox:getScriptById', id),
  createToolboxScript: (data: unknown) => ipcRenderer.invoke('toolbox:createScript', data),
  updateToolboxScript: (id: string, data: unknown) => ipcRenderer.invoke('toolbox:updateScript', id, data),
  deleteToolboxScript: (id: string) => ipcRenderer.invoke('toolbox:deleteScript', id),
  reorderToolboxScripts: (ids: string[]) => ipcRenderer.invoke('toolbox:reorderScripts', ids),

  // password vault
  getPasswordEntries: () => ipcRenderer.invoke('passwordVault:getAll'),
  getPasswordEntryById: (id: string) => ipcRenderer.invoke('passwordVault:getById', id),
  createPasswordEntry: (data: unknown) => ipcRenderer.invoke('passwordVault:create', data),
  updatePasswordEntry: (id: string, data: unknown) => ipcRenderer.invoke('passwordVault:update', id, data),
  deletePasswordEntry: (id: string) => ipcRenderer.invoke('passwordVault:delete', id),

  // moments
  getMomentsPosts: () => ipcRenderer.invoke('moments:getAll'),
  getMomentsPostById: (id: string) => ipcRenderer.invoke('moments:getById', id),
  createMomentsPost: (data: unknown) => ipcRenderer.invoke('moments:create', data),
  updateMomentsPost: (id: string, data: unknown) => ipcRenderer.invoke('moments:update', id, data),
  deleteMomentsPost: (id: string) => ipcRenderer.invoke('moments:delete', id),
  toggleMomentsPin: (id: string) => ipcRenderer.invoke('moments:togglePin', id),
  getMomentsAlbums: () => ipcRenderer.invoke('moments:getAlbums'),
  createMomentsAlbum: (name: string) => ipcRenderer.invoke('moments:createAlbum', name),
  renameMomentsAlbum: (id: string, name: string) => ipcRenderer.invoke('moments:renameAlbum', id, name),
  deleteMomentsAlbum: (id: string) => ipcRenderer.invoke('moments:deleteAlbum', id),
  setMomentsPostAlbum: (postId: string, albumId: string) => ipcRenderer.invoke('moments:setPostAlbum', postId, albumId),
  setMomentsAlbumCover: (albumId: string, postId: string, index: number) => ipcRenderer.invoke('moments:setAlbumCover', albumId, postId, index),
  // weight tracker
  getWeightRecords: () => ipcRenderer.invoke('weight:getAll'),
  getWeightSeries: () => ipcRenderer.invoke('weight:getSeries'),
  createWeightRecord: (data: unknown) => ipcRenderer.invoke('weight:create', data),
  updateWeightRecord: (id: string, data: unknown) => ipcRenderer.invoke('weight:update', id, data),
  deleteWeightRecord: (id: string) => ipcRenderer.invoke('weight:delete', id),

  // ai
  aiChat: (opts: unknown) => ipcRenderer.invoke('ai:chat', opts),

  // fill popup
  isFillPopup,
  fillPopupTheme: fillTheme,
  fillPopupGetEntries: () => ipcRenderer.invoke('fillPopup:getEntries'),
  fillPopupCopy: (field: string, value: string) => ipcRenderer.invoke('fillPopup:copy', field, value),
  fillPopupHide: () => ipcRenderer.invoke('fillPopup:hide'),
  onFillPopupRefresh: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('fillPopup:refresh', handler)
    return () => ipcRenderer.removeListener('fillPopup:refresh', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
export type ElectronAPI = typeof api
