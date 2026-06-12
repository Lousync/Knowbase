import type { ElectronAPI, Entry, EntryFilter, CreateEntryDTO, UpdateEntryDTO, Tag, CreateScheduleTodoDTO, UpdateScheduleTodoDTO, CreateKnowledgeCategoryDTO, UpdateKnowledgeCategoryDTO, CreateKnowledgePageDTO, UpdateKnowledgePageDTO, KnowledgeTag } from '../types'
const a = () => { if (!window.api) throw new Error('Electron API not available.'); return window.api }

export const minimize = () => a().minimize()
export const maximize = () => a().maximize()
export const close = () => a().close()
export const isMaximized = () => a().isMaximized()
export const onMaximizeChange = (cb: (v: boolean) => void) => a().onMaximizeChange(cb)
export const getSetting = (k: string) => a().getSetting(k)
export const setSetting = (k: string, v: unknown) => a().setSetting(k, v)
export const getEntries = (f: EntryFilter = {}) => a().getEntries(f)
export const getEntryById = (id: string) => a().getEntryById(id)
export const createEntry = (d: CreateEntryDTO) => a().createEntry(d)
export const updateEntry = (id: string, d: UpdateEntryDTO) => a().updateEntry(id, d)
export const deleteEntry = (id: string) => a().deleteEntry(id)
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

// Utility: parse [[wiki links]] from markdown
export function parseWikiLinks(md: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g
  const links: string[] = []
  let m
  while ((m = re.exec(md)) !== null) {
    const title = m[1].split('|')[0].trim()
    if (!links.includes(title)) links.push(title)
  }
  return links
}
