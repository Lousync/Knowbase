import { contextBridge, ipcRenderer, webUtils } from 'electron'

const isFillPopup = process.argv.includes('--fill-popup-window')
const fillTheme = isFillPopup
  ? (process.argv.find(a => a.startsWith('--theme=')) || '--theme=dark').split('=')[1]
  : 'dark'

/** 日程与打卡小窗：主进程创建面板窗口时通过 additionalArguments 注入 */
const isDayPanel = process.argv.includes('--day-panel-window')

const api = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  copyImage: (src: { path?: string; dataUrl?: string }) => ipcRenderer.invoke('clipboard:copyImage', src),
  clearClipboardIfEqual: (text: string) => ipcRenderer.invoke('clipboard:clearIfEqual', text),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
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
  getKnowledgeBacklinkContext: (pageId: string) => ipcRenderer.invoke('knowledge:getBacklinkContext', pageId),
  getKnowledgeManualLinks: (pageId: string) => ipcRenderer.invoke('knowledge:getManualLinks', pageId),
  addKnowledgeManualLink: (pageId: string, targetId: string) => ipcRenderer.invoke('knowledge:addManualLink', pageId, targetId),
  removeKnowledgeManualLink: (a: string, b: string) => ipcRenderer.invoke('knowledge:removeManualLink', a, b),
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
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (url: string, name: string, size?: number) => ipcRenderer.invoke('update:download', url, name, size),
  installUpdate: (filePath: string) => ipcRenderer.invoke('update:install', filePath),
  updatePauseDownload: () => ipcRenderer.invoke('update:pauseDownload'),
  updateCancelDownload: () => ipcRenderer.invoke('update:cancelDownload'),
  onUpdateDownloadProgress: (cb: (p: { percent: number; receivedBytes: number; totalBytes: number }) => void) => {
    const handler = (_e: unknown, p: { percent: number; receivedBytes: number; totalBytes: number }) => cb(p)
    ipcRenderer.on('update:download-progress', handler)
    return () => { ipcRenderer.removeListener('update:download-progress', handler) }
  },
  pluginFetchRegistry: () => ipcRenderer.invoke('plugin:fetchRegistry'),
  pluginInstall: (url: string, grantedCapabilities?: string[]) => ipcRenderer.invoke('plugin:install', url, grantedCapabilities),
  onPluginDownloadProgress: (cb: (p: { key: string; received: number; total: number; percent: number; host?: string }) => void) => {
    const handler = (_e: unknown, p: { key: string; received: number; total: number; percent: number; host?: string }) => cb(p)
    ipcRenderer.on('plugin:download-progress', handler)
    return () => { ipcRenderer.removeListener('plugin:download-progress', handler) }
  },
  pluginInstallFromFile: (grantedCapabilities?: string[]) => ipcRenderer.invoke('plugin:installFromFile', grantedCapabilities),
  pluginInstallBundledSample: (filename: string, grantedCapabilities?: string[]) => ipcRenderer.invoke('plugin:installBundledSample', filename, grantedCapabilities),
  pluginListInstalled: () => ipcRenderer.invoke('plugin:listInstalled'),
  pluginSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('plugin:setEnabled', id, enabled),
  pluginUninstall: (id: string) => ipcRenderer.invoke('plugin:uninstall', id),
  pluginGetContribution: (id: string, key: string) => ipcRenderer.invoke('plugin:getContribution', id, key),
  pluginListViews: (slot: unknown) => ipcRenderer.invoke('plugin:listViews', slot),
  pluginListDeleteFxSkins: () => ipcRenderer.invoke('plugin:listDeleteFxSkins'),
  // C 级模块插件:自有数据表读写(结构化 CRUD,主进程校验 data 能力)
  pluginDataQuery: (pluginId: string, table: string, opts: unknown) => ipcRenderer.invoke('pluginData:query', pluginId, table, opts),
  pluginDataInsert: (pluginId: string, table: string, row: unknown) => ipcRenderer.invoke('pluginData:insert', pluginId, table, row),
  pluginDataUpdate: (pluginId: string, table: string, rowId: string | number, patch: unknown) => ipcRenderer.invoke('pluginData:update', pluginId, table, rowId, patch),
  pluginDataDelete: (pluginId: string, table: string, rowId: string | number) => ipcRenderer.invoke('pluginData:delete', pluginId, table, rowId),
  // AI tools (ToolRegistry)
  aiToolsList: () => ipcRenderer.invoke('aiTools:list'),
  aiToolsInvoke: (name: string, args?: unknown) => ipcRenderer.invoke('aiTools:invoke', name, args),
  aiToolsGetUsage: () => ipcRenderer.invoke('aiTools:getUsage'),
  aiToolsGetRecentAudit: (limit?: number) => ipcRenderer.invoke('aiTools:getRecentAudit', limit),
  // MCP servers
  mcpListServers: () => ipcRenderer.invoke('mcp:listServers'),
  mcpAddServer: (draft: unknown) => ipcRenderer.invoke('mcp:addServer', draft),
  mcpUpdateServer: (id: string, patch: unknown) => ipcRenderer.invoke('mcp:updateServer', id, patch),
  mcpRemoveServer: (id: string) => ipcRenderer.invoke('mcp:removeServer', id),
  mcpToggleServer: (id: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggleServer', id, enabled),
  mcpListTools: (id: string) => ipcRenderer.invoke('mcp:listTools', id),
  mcpRefreshTools: (id: string) => ipcRenderer.invoke('mcp:refreshTools', id),
  mcpTestConnection: (draft: unknown) => ipcRenderer.invoke('mcp:testConnection', draft),
  // Skills
  aiToolsListSkills: () => ipcRenderer.invoke('aiTools:listSkills'),
  aiToolsCopySkillPrompt: (pluginId: string, skillId: string) => ipcRenderer.invoke('aiTools:copySkillPrompt', pluginId, skillId),
  // Model gateway + agent
  llmListProviders: () => ipcRenderer.invoke('llm:listProviders'),
  llmSaveProvider: (draft: unknown) => ipcRenderer.invoke('llm:saveProvider', draft),
  llmRemoveProvider: (id: string) => ipcRenderer.invoke('llm:removeProvider', id),
  llmToggleProvider: (id: string, enabled: boolean) => ipcRenderer.invoke('llm:toggleProvider', id, enabled),
  llmTestConnection: (draft: unknown) => ipcRenderer.invoke('llm:testConnection', draft),
  llmRefreshModels: (id: string) => ipcRenderer.invoke('llm:refreshModels', id),
  llmAddModel: (id: string, model: string) => ipcRenderer.invoke('llm:addModel', id, model),
  llmSetDefaultModel: (value: string) => ipcRenderer.invoke('llm:setDefaultModel', value),
  llmTestModel: (providerId: string, model: string) => ipcRenderer.invoke('llm:testModel', { providerId, model }),
  llmGetUsage: () => ipcRenderer.invoke('llm:getUsage'),
  // 划词翻译 / 离线词典
  dictLookup: (word: string) => ipcRenderer.invoke('dict:lookup', word),
  dictStatus: () => ipcRenderer.invoke('dict:status'),
  translateInvoke: (req: unknown) => ipcRenderer.invoke('translate:invoke', req),
  // 单词本
  wordbookAdd: (word: string) => ipcRenderer.invoke('wordbook:add', word),
  wordbookRemove: (word: string) => ipcRenderer.invoke('wordbook:remove', word),
  wordbookSetMastered: (word: string, mastered: boolean) => ipcRenderer.invoke('wordbook:setMastered', word, mastered),
  wordbookList: (status?: string) => ipcRenderer.invoke('wordbook:list', status),
  wordbookGetToday: () => ipcRenderer.invoke('wordbook:getToday'),
  wordbookAnswer: (word: string, feedback: string) => ipcRenderer.invoke('wordbook:answer', word, feedback),
  wordbookSetBook: (book: string) => ipcRenderer.invoke('wordbook:setBook', book),
  wordbookStats: () => ipcRenderer.invoke('wordbook:stats'),
  wordbookCheck: (word: string) => ipcRenderer.invoke('wordbook:check', word),
  wordbookMarkKnown: (word: string) => ipcRenderer.invoke('wordbook:markKnown', word),
  wordbookBookWords: (book: string, query: string, offset: number, limit: number, orderBy?: string) => ipcRenderer.invoke('wordbook:bookWords', book, query, offset, limit, orderBy),
  wordbookRootClusters: () => ipcRenderer.invoke('wordbook:rootClusters'),
  wordbookSynonymClusters: () => ipcRenderer.invoke('wordbook:synonymClusters'),
  wordbookRelations: (word: string) => ipcRenderer.invoke('wordbook:relations', word),
  wordbookGroupsList: () => ipcRenderer.invoke('wordbook:groups:list'),
  wordbookGroupsCreate: (name: string) => ipcRenderer.invoke('wordbook:groups:create', name),
  wordbookGroupsRename: (id: string, name: string) => ipcRenderer.invoke('wordbook:groups:rename', id, name),
  wordbookGroupsDelete: (id: string) => ipcRenderer.invoke('wordbook:groups:delete', id),
  wordbookGroupsAddWord: (id: string, word: string) => ipcRenderer.invoke('wordbook:groups:addWord', id, word),
  wordbookGroupsRemoveWord: (id: string, word: string) => ipcRenderer.invoke('wordbook:groups:removeWord', id, word),
  wordbookGroupsWords: (id: string) => ipcRenderer.invoke('wordbook:groups:words', id),
  wordbookCustomQueue: (label: string, words: string[]) => ipcRenderer.invoke('wordbook:customQueue', label, words),
  // PDF 工具箱
  pdfMerge: (files: Array<{ name: string; data: Uint8Array }>) => ipcRenderer.invoke('pdf:merge', files),
  pdfOrganize: (payload: { data: Uint8Array; pages: number[]; rotations?: Record<string, number> }) => ipcRenderer.invoke('pdf:organize', payload),
  pdfExport: (payload: { data: Uint8Array; defaultName: string; kind?: 'pdf' | 'txt' }) => ipcRenderer.invoke('pdf:export', payload),
  agentChat: (req: { sessionId: string; message: string; context?: unknown; chatId?: string }) => ipcRenderer.invoke('agent:chat', req),
  agentRegenerate: (req: { sessionId: string; context?: unknown; chatId?: string }) => ipcRenderer.invoke('agent:regenerate', req),
  agentEditMessage: (req: { sessionId: string; messageId: string; message: string; context?: unknown; chatId?: string }) => ipcRenderer.invoke('agent:editMessage', req),
  agentDeleteMessage: (messageId: string) => ipcRenderer.invoke('agent:deleteMessage', messageId),
  agentAbort: (chatId: string) => ipcRenderer.invoke('agent:abort', chatId),
  agentSessions: () => ipcRenderer.invoke('agent:sessions'),
  agentNewSession: (title?: string) => ipcRenderer.invoke('agent:newSession', title),
  agentMessages: (sessionId: string) => ipcRenderer.invoke('agent:messages', sessionId),
  agentRenameSession: (id: string, title: string) => ipcRenderer.invoke('agent:renameSession', id, title),
  agentDeleteSession: (id: string) => ipcRenderer.invoke('agent:deleteSession', id),
  llmCcSwitchList: () => ipcRenderer.invoke('llm:ccswitch:list'),
  llmCcSwitchImport: (ids: string[]) => ipcRenderer.invoke('llm:ccswitch:import', ids),
  // 插件安全分级 + 内容包导入
  pluginSetGranted: (id: string, caps: string[]) => ipcRenderer.invoke('plugin:setGranted', id, caps),
  pluginAuditList: (id?: string) => ipcRenderer.invoke('plugin:auditList', id),
  pluginAuditClear: (id?: string) => ipcRenderer.invoke('plugin:auditClear', id),
  pluginAuditWrite: (id: string, action: string, detail?: unknown) => ipcRenderer.invoke('plugin:auditWrite', id, action, detail),
  pluginGetAllowedLevels: () => ipcRenderer.invoke('plugin:getAllowedLevels'),
  pluginSetAllowedLevels: (levels: unknown) => ipcRenderer.invoke('plugin:setAllowedLevels', levels),
  knowledgePackGetState: (pluginId: string) => ipcRenderer.invoke('knowledgePack:getImportState', pluginId),
  knowledgePackImport: (pluginId: string, overwriteModified: boolean, forceExternalIds?: string[]) => ipcRenderer.invoke('knowledgePack:importPack', pluginId, overwriteModified, forceExternalIds ?? []),
  onKnowledgePackProgress: (cb: (p: { pluginId: string; current: number; total: number; title: string }) => void) => {
    const handler = (_e: unknown, p: { pluginId: string; current: number; total: number; title: string }) => cb(p)
    ipcRenderer.on('knowledgePack:progress', handler)
    return () => { ipcRenderer.removeListener('knowledgePack:progress', handler) }
  },
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
  showExportSaveDialog: (opts: unknown) => ipcRenderer.invoke('export:showSaveDialog', opts),
  writeExportTextFile: (filePath: string, content: string, encoding?: string) => ipcRenderer.invoke('export:writeTextFile', filePath, content, encoding),

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
  // attachments
  uploadAttachments: (data: unknown) => ipcRenderer.invoke('attachment:uploadMany', data),
  uploadAttachmentFromPath: (data: unknown) => ipcRenderer.invoke('attachment:uploadFromPath', data),
  getAttachmentsByOwner: (ownerType: string, ownerId: string) => ipcRenderer.invoke('attachment:getByOwner', ownerType, ownerId),
  deleteAttachment: (id: string) => ipcRenderer.invoke('attachment:delete', id),
  getAttachmentPath: (id: string) => ipcRenderer.invoke('attachment:getPath', id),
  readAttachmentBase64: (id: string) => ipcRenderer.invoke('attachment:readBase64', id),
  readAttachmentBase64ByFileName: (fileName: string) => ipcRenderer.invoke('attachment:readBase64ByFileName', fileName),
  cleanupOrphanAttachments: () => ipcRenderer.invoke('attachment:cleanupOrphans'),
  exportBackupToZip: (zipPath: string, moduleIds?: string[]) => ipcRenderer.invoke('export:backupToZip', zipPath, moduleIds),
  importBackupPackage: (srcPath: string) => ipcRenderer.invoke('import:importBackupPackage', srcPath),
  // weight tracker
  getWeightRecords: () => ipcRenderer.invoke('weight:getAll'),
  getWeightSeries: () => ipcRenderer.invoke('weight:getSeries'),
  createWeightRecord: (data: unknown) => ipcRenderer.invoke('weight:create', data),
  updateWeightRecord: (id: string, data: unknown) => ipcRenderer.invoke('weight:update', id, data),
  deleteWeightRecord: (id: string) => ipcRenderer.invoke('weight:delete', id),
  // checkin
  habitGetAll: () => ipcRenderer.invoke('habit:getAll'),
  createHabit: (data: unknown) => ipcRenderer.invoke('habit:create', data),
  updateHabit: (id: string, data: unknown) => ipcRenderer.invoke('habit:update', id, data),
  deleteHabit: (id: string) => ipcRenderer.invoke('habit:delete', id),
  toggleHabitCheck: (habitId: string, date: string) => ipcRenderer.invoke('habit:toggleCheck', habitId, date),
  reorderHabits: (orderedIds: string[]) => ipcRenderer.invoke('habit:reorder', orderedIds),
  habitLinkSave: (habitId: string, link: unknown) => ipcRenderer.invoke('habitLink:save', habitId, link),
  habitLinkRemove: (habitId: string) => ipcRenderer.invoke('habitLink:remove', habitId),
  onHabitAutoChecked: (cb: (items: unknown) => void) => {
    const listener = (_e: unknown, items: unknown) => cb(items)
    ipcRenderer.on('habit:autoChecked', listener)
    return () => ipcRenderer.removeListener('habit:autoChecked', listener)
  },
  // bookmark nav
  bookmarkGetAll: () => ipcRenderer.invoke('bookmark:getAll'),
  createBookmarkCategory: (data: unknown) => ipcRenderer.invoke('bookmark:createCategory', data),
  updateBookmarkCategory: (id: string, data: unknown) => ipcRenderer.invoke('bookmark:updateCategory', id, data),
  deleteBookmarkCategory: (id: string) => ipcRenderer.invoke('bookmark:deleteCategory', id),
  reorderBookmarkCategories: (orderedIds: string[]) => ipcRenderer.invoke('bookmark:reorderCategories', orderedIds),
  createBookmarkItem: (data: unknown) => ipcRenderer.invoke('bookmark:createBookmark', data),
  updateBookmarkItem: (id: string, data: unknown) => ipcRenderer.invoke('bookmark:updateBookmark', id, data),
  deleteBookmarkItem: (id: string) => ipcRenderer.invoke('bookmark:deleteBookmark', id),
  openBookmarkUrl: (url: string) => ipcRenderer.invoke('bookmark:openUrl', url),
  pickBookmarkImportFile: () => ipcRenderer.invoke('bookmark:pickImportFile'),
  // remote supervise
  superviseGetConfig: () => ipcRenderer.invoke('supervise:getConfig'),
  superviseSaveConfig: (partial: unknown) => ipcRenderer.invoke('supervise:saveConfig', partial),
  superviseTest: () => ipcRenderer.invoke('supervise:test'),
  superviseGetHistory: (limit?: number) => ipcRenderer.invoke('supervise:getHistory', limit),
  superviseRetry: (id: number) => ipcRenderer.invoke('supervise:retry', id),
  superviseRetryAllFailed: () => ipcRenderer.invoke('supervise:retryAllFailed'),
  superviseSendDailyNow: () => ipcRenderer.invoke('supervise:sendDailyNow'),
  superviseClearHistory: () => ipcRenderer.invoke('supervise:clearHistory'),
  // period summary (weekly / monthly)
  createPomodoroSession: (minutes: number) => ipcRenderer.invoke('pomodoro:createSession', minutes),
  getBlogPeriodStats: (start: string, end: string) => ipcRenderer.invoke('blog:periodStats', start, end),
  // blog templates
  listBlogTemplates: () => ipcRenderer.invoke('blogTpl:list'),
  createBlogTemplate: (d: unknown) => ipcRenderer.invoke('blogTpl:create', d),
  updateBlogTemplate: (id: string, d: unknown) => ipcRenderer.invoke('blogTpl:update', id, d),
  deleteBlogTemplate: (id: string) => ipcRenderer.invoke('blogTpl:delete', id),

  // quiz records (收藏 + 错题本，全知识包通用)
  quizRecordGetByPage: (pageId: string) => ipcRenderer.invoke('quizRecord:getByPage', pageId),
  quizRecordReport: (pageId: string, quizNo: number, correct: boolean, meta: unknown) => ipcRenderer.invoke('quizRecord:report', pageId, quizNo, correct, meta),
  quizRecordToggleFavorite: (pageId: string, quizNo: number, meta: unknown) => ipcRenderer.invoke('quizRecord:toggleFavorite', pageId, quizNo, meta),
  quizRecordList: (opts: unknown) => ipcRenderer.invoke('quizRecord:list', opts),
  quizRecordRemove: (pageId: string, quizNo: number) => ipcRenderer.invoke('quizRecord:remove', pageId, quizNo),
  quizRecordSetCollections: (recordId: string, collectionIds: string[]) => ipcRenderer.invoke('quizRecord:setCollections', recordId, collectionIds),
  quizRecordSetNote: (recordId: string, note: string) => ipcRenderer.invoke('quizRecord:setNote', recordId, note),
  quizRecordSetTags: (recordId: string, tagIds: string[]) => ipcRenderer.invoke('quizRecord:setTags', recordId, tagIds),
  quizRecordAddTags: (recordIds: string[], tagIds: string[]) => ipcRenderer.invoke('quizRecord:addTags', recordIds, tagIds),
  quizRecordStats: (opts: unknown) => ipcRenderer.invoke('quizRecord:stats', opts),
  quizTagList: () => ipcRenderer.invoke('quizTag:list'),
  quizTagCreate: (name: string, kind: unknown) => ipcRenderer.invoke('quizTag:create', name, kind),
  quizTagDelete: (tagId: string) => ipcRenderer.invoke('quizTag:delete', tagId),
  quizCollectionList: () => ipcRenderer.invoke('quizCollection:list'),
  quizCollectionCreate: (name: string) => ipcRenderer.invoke('quizCollection:create', name),
  quizCollectionRename: (id: string, name: string) => ipcRenderer.invoke('quizCollection:rename', id, name),
  quizCollectionDelete: (id: string) => ipcRenderer.invoke('quizCollection:delete', id),
  // quiz data migration (P2: main tables ⇄ plugin namespace tables)
  quizMigrateStatus: () => ipcRenderer.invoke('quizMigrate:status'),
  quizMigrateExport: () => ipcRenderer.invoke('quizMigrate:export'),
  quizMigrateToPlugin: (opts: unknown) => ipcRenderer.invoke('quizMigrate:toPlugin', opts),
  quizMigrateFromPlugin: () => ipcRenderer.invoke('quizMigrate:fromPlugin'),
  quizMigrateDropPluginData: () => ipcRenderer.invoke('quizMigrate:dropPluginData'),
  // plugin-mode quiz report (write to plugin namespace tables)
  quizPluginReport: (pluginId: string, pageId: string, quizNo: number, correct: boolean, meta: unknown) => ipcRenderer.invoke('quiz:pluginReport', pluginId, pageId, quizNo, correct, meta),
  quizPluginToggleFavorite: (pluginId: string, pageId: string, quizNo: number) => ipcRenderer.invoke('quiz:pluginToggleFavorite', pluginId, pageId, quizNo),

  // fill popup
  isFillPopup,
  isDayPanel,
  // 日程与打卡小窗（独立伴随窗口，主窗口 TitleBar 按钮 / Ctrl+Alt+S 开关）
  dayPanelToggle: () => ipcRenderer.invoke('daypanel:toggle'),
  dayPanelClose: () => ipcRenderer.invoke('daypanel:close'),
  dayPanelDock: () => ipcRenderer.invoke('daypanel:dock'),
  dayPanelGetState: () => ipcRenderer.invoke('daypanel:get-state') as Promise<{ visible: boolean; docked: boolean }>,
  dayPanelOpenInMain: (tab: string) => ipcRenderer.send('daypanel:open-in-main', tab),
  onDayPanelVisibleChange: (cb: (visible: boolean) => void) => {
    const handler = (_e: unknown, v: boolean) => cb(v)
    ipcRenderer.on('daypanel:visible-changed', handler)
    return () => { ipcRenderer.removeListener('daypanel:visible-changed', handler) }
  },
  // 磁吸气泡提示：自由摆放状态下拖近主窗口 → 主进程推送 near=true/false
  onDayPanelSnapHint: (cb: (h: { near: boolean }) => void) => {
    const handler = (_e: unknown, h: { near: boolean }) => cb(h)
    ipcRenderer.on('daypanel:snap-hint', handler)
    return () => { ipcRenderer.removeListener('daypanel:snap-hint', handler) }
  },
  // 磁吸完成提示：自动吸附/按钮回吸附后推送
  onDayPanelSnapChanged: (cb: (h: { docked: boolean }) => void) => {
    const handler = (_e: unknown, h: { docked: boolean }) => cb(h)
    ipcRenderer.on('daypanel:snap-changed', handler)
    return () => { ipcRenderer.removeListener('daypanel:snap-changed', handler) }
  },
  // 主窗口接收小窗指令（如切换模块 Tab）
  onMainCommand: (cb: (payload: { type: string; tab?: string }) => void) => {
    const handler = (_e: unknown, p: { type: string; tab?: string }) => cb(p)
    ipcRenderer.on('main:command', handler)
    return () => { ipcRenderer.removeListener('main:command', handler) }
  },
  // 跨窗口数据同步：本窗口数据变更后上报 → 主进程广播给其它窗口（kb:data-changed）
  dataNotify: (payload: { scope: string }) => ipcRenderer.send('data:notify', payload),
  onDataChanged: (cb: (payload: { scope: string }) => void) => {
    const handler = (_e: unknown, p: { scope: string }) => cb(p)
    ipcRenderer.on('kb:data-changed', handler)
    return () => { ipcRenderer.removeListener('kb:data-changed', handler) }
  },
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

// 开发者工具(仅 DEV):主进程侧对 app.isPackaged 守卫,打包版 handler 不存在,调用必然被拒
const devtoolsApi = {
  helpDocsList: () => ipcRenderer.invoke('devtools:helpDocs:list'),
  helpDocsRead: (fileName: string) => ipcRenderer.invoke('devtools:helpDocs:read', fileName),
  helpDocsWrite: (doc: { fileName: string; title: string; category: string; icon: string; body: string }) =>
    ipcRenderer.invoke('devtools:helpDocs:write', doc),
  helpDocsDelete: (fileName: string) => ipcRenderer.invoke('devtools:helpDocs:delete', fileName),
}
contextBridge.exposeInMainWorld('devtoolsApi', devtoolsApi)
export type DevtoolsElectronAPI = typeof devtoolsApi

// AI 测试桥上报通道(仅 DEV):与 devtoolsApi 同款约定 —— 打包版主进程侧
// 不注册 handler(app.isPackaged 守卫),调用必然被拒,不影响生产行为。
const devbridgeApi = {
  report: (payload: unknown) => ipcRenderer.invoke('devbridge:report', payload),
}
contextBridge.exposeInMainWorld('devbridgeApi', devbridgeApi)
export type DevbridgeElectronAPI = typeof devbridgeApi
