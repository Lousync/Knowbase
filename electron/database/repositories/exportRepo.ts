import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { getDatabase, getDbPath } from '../connection'
import { writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import * as iconv from 'iconv-lite'

function encodeText(content: string, encoding: string): Buffer {
  if (encoding === 'utf-8' || encoding === 'utf8') return Buffer.from(content, 'utf-8')
  try { return iconv.encode(content, encoding) as Buffer }
  catch { return Buffer.from(content, 'utf-8') }
}

// ---- row types ----
interface EntryRow { id: string; title: string; content_md: string; content_html: string | null; date: string; created_at: string; updated_at: string; is_pinned: number; word_count: number }
interface TagRow { id: string; name: string; color: string }
interface TodoRow { id: string; title: string; description: string | null; date: string; time: string | null; quadrant: number; task_type: string; tag_id: string | null; status: string; sort_order: number; end_criteria: string | null; created_at: string; updated_at: string }
interface ScheduleTagRow { id: string; name: string; color: string }
interface CategoryRow { id: string; name: string; parent_id: string | null; sort_order: number; category_type: string }
interface PageRow { id: string; title: string; content_md: string; content_html: string | null; category_id: string | null; is_starred: number; sort_order: number; created_at: string; updated_at: string }

// ---- helpers ----
function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

// ---- mappers ----
function mapEntry(r: EntryRow) {
  return { id: r.id, title: r.title, contentMd: r.content_md, contentHtml: r.content_html || '', date: r.date, createdAt: r.created_at, updatedAt: r.updated_at, isPinned: r.is_pinned === 1, wordCount: r.word_count }
}

function mapTodo(r: TodoRow) {
  return { id: r.id, title: r.title, description: r.description || '', date: r.date, time: r.time || null, quadrant: r.quadrant, taskType: r.task_type as 'deadline' | 'plan', tagId: r.tag_id, status: r.status as 'pending' | 'done', sortOrder: r.sort_order, endCriteria: r.end_criteria || '', createdAt: r.created_at, updatedAt: r.updated_at }
}

function mapPage(r: PageRow) {
  return { id: r.id, title: r.title, contentMd: r.content_md, contentHtml: r.content_html || '', categoryId: r.category_id, isStarred: !!r.is_starred, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at }
}

export function registerExportHandlers(): void {
  // ===== Blog: all entries with tags =====
  ipcMain.handle('export:getAllBlogData', () => {
    const entries = queryAll<EntryRow>('SELECT * FROM entries ORDER BY date DESC')
    const tags = queryAll<TagRow>('SELECT * FROM tags ORDER BY name')

    // Build entry-tag map
    const etRows = queryAll<{ entry_id: string; tag_id: string }>('SELECT * FROM entry_tags')
    const tagMap = new Map<string, TagRow[]>()
    for (const et of etRows) {
      const t = tags.find(tg => tg.id === et.tag_id)
      if (t) {
        if (!tagMap.has(et.entry_id)) tagMap.set(et.entry_id, [])
        tagMap.get(et.entry_id)!.push(t)
      }
    }

    return {
      entries: entries.map(e => ({ ...mapEntry(e), tags: tagMap.get(e.id) || [] })),
      tags
    }
  })

  // ===== Schedule: all todos with tags =====
  ipcMain.handle('export:getAllScheduleData', () => {
    const todos = queryAll<TodoRow>('SELECT * FROM schedule_todos ORDER BY date DESC, sort_order, created_at')
    const tags = queryAll<ScheduleTagRow>('SELECT * FROM schedule_tags ORDER BY name')
    const tagMap = new Map(tags.map(t => [t.id, t]))

    return {
      todos: todos.map(t => ({ ...mapTodo(t), tag: t.tag_id ? tagMap.get(t.tag_id) || null : null })),
      tags
    }
  })

  // ===== Knowledge: categories + pages with backlinks =====
  ipcMain.handle('export:getAllKnowledgeData', () => {
    const categories = queryAll<CategoryRow>('SELECT * FROM knowledge_categories ORDER BY sort_order, name')
    const pages = queryAll<PageRow>('SELECT * FROM knowledge_pages ORDER BY sort_order, updated_at DESC')
    const tags = queryAll<TagRow>('SELECT * FROM knowledge_tags ORDER BY name')

    // Build backlinks map
    const linkRows = queryAll<{ source_page_id: string; target_page_id: string }>('SELECT * FROM knowledge_links')
    const backlinkMap = new Map<string, string[]>()
    for (const l of linkRows) {
      const page = pages.find(p => p.id === l.source_page_id)
      if (page) {
        if (!backlinkMap.has(l.target_page_id)) backlinkMap.set(l.target_page_id, [])
        backlinkMap.get(l.target_page_id)!.push(page.title)
      }
    }

    return {
      categories: categories.map(c => ({ id: c.id, name: c.name, parentId: c.parent_id, sortOrder: c.sort_order, categoryType: (c.category_type === 'notebook' ? 'notebook' : 'folder') as 'notebook' | 'folder' })),
      pages: pages.map(p => ({ ...mapPage(p), tags: [] as TagRow[], backlinks: backlinkMap.get(p.id) || [] })),
      tags
    }
  })

  // ===== Combined: all three domains =====
  ipcMain.handle('export:getAllData', () => {
    // Blog
    const entries = queryAll<EntryRow>('SELECT * FROM entries ORDER BY date DESC')
    const blogTags = queryAll<TagRow>('SELECT * FROM tags ORDER BY name')
    const etRows = queryAll<{ entry_id: string; tag_id: string }>('SELECT * FROM entry_tags')
    const blogTagMap = new Map<string, TagRow[]>()
    for (const et of etRows) {
      const t = blogTags.find(tg => tg.id === et.tag_id)
      if (t) {
        if (!blogTagMap.has(et.entry_id)) blogTagMap.set(et.entry_id, [])
        blogTagMap.get(et.entry_id)!.push(t)
      }
    }

    // Schedule
    const todos = queryAll<TodoRow>('SELECT * FROM schedule_todos ORDER BY date DESC, sort_order, created_at')
    const scheduleTags = queryAll<ScheduleTagRow>('SELECT * FROM schedule_tags ORDER BY name')
    const sTagMap = new Map(scheduleTags.map(t => [t.id, t]))

    // Knowledge
    const categories = queryAll<CategoryRow>('SELECT * FROM knowledge_categories ORDER BY sort_order, name')
    const pages = queryAll<PageRow>('SELECT * FROM knowledge_pages ORDER BY sort_order, updated_at DESC')
    const knowledgeTags = queryAll<TagRow>('SELECT * FROM knowledge_tags ORDER BY name')
    const linkRows = queryAll<{ source_page_id: string; target_page_id: string }>('SELECT * FROM knowledge_links')
    const backlinkMap = new Map<string, string[]>()
    for (const l of linkRows) {
      const page = pages.find(p => p.id === l.source_page_id)
      if (page) {
        if (!backlinkMap.has(l.target_page_id)) backlinkMap.set(l.target_page_id, [])
        backlinkMap.get(l.target_page_id)!.push(page.title)
      }
    }

    return {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      blog: {
        entries: entries.map(e => ({ ...mapEntry(e), tags: blogTagMap.get(e.id) || [] })),
        tags: blogTags
      },
      schedule: {
        todos: todos.map(t => ({ ...mapTodo(t), tag: t.tag_id ? sTagMap.get(t.tag_id) || null : null })),
        tags: scheduleTags
      },
      knowledge: {
        categories: categories.map(c => ({ id: c.id, name: c.name, parentId: c.parent_id, sortOrder: c.sort_order, categoryType: (c.category_type === 'notebook' ? 'notebook' : 'folder') as 'notebook' | 'folder' })),
        pages: pages.map(p => ({ ...mapPage(p), tags: [] as TagRow[], backlinks: backlinkMap.get(p.id) || [] })),
        tags: knowledgeTags
      }
    }
  })

  // ===== File dialogs =====
  ipcMain.handle('export:showSaveDialog', async (_e, opts: { defaultName: string; filters: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { filePath: null }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: opts.defaultName,
      filters: opts.filters
    })
    return { filePath: result.canceled ? null : result.filePath ?? null }
  })

  ipcMain.handle('export:showOpenDirDialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { dirPath: null }
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出目录'
    })
    return { dirPath: result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] }
  })

  // ===== File I/O =====
  ipcMain.handle('export:writeTextFile', (_e, filePath: string, content: string, encoding: string = 'utf-8') => {
    const buf = encodeText(content, encoding)
    writeFileSync(filePath, buf)
    const size = statSync(filePath).size
    return { filePath, size }
  })

  ipcMain.handle('export:copyDbFile', (_e, destPath: string) => {
    copyFileSync(getDbPath(), destPath)
    const size = statSync(destPath).size
    return { filePath: destPath, size }
  })

  // ===== Markdown batch export: writes multiple files into a directory =====
  ipcMain.handle('export:writeMarkdownExport', (event, dirPath: string, files: { relPath: string; content: string }[], encoding: string = 'utf-8') => {
    const results: { relPath: string; size: number }[] = []
    let totalSize = 0

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const fullPath = join(dirPath, f.relPath)
      const targetDir = join(fullPath, '..')
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
      const buf = encodeText(f.content, encoding)
      writeFileSync(fullPath, buf)

      const size = statSync(fullPath).size
      results.push({ relPath: f.relPath, size })
      totalSize += size

      event.sender.send('export:markdownProgress', {
        current: i + 1,
        total: files.length,
        currentFile: f.relPath,
        phase: '写入文件'
      })
    }

    return { fileCount: files.length, totalSize, files: results }
  })
}
