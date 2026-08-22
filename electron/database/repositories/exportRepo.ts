import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDatabase } from '../connection'
import { writeFileSync, statSync } from 'fs'
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
interface PageRow { id: string; title: string; content_md: string; content_html: string | null; category_id: string | null; is_starred: number; sort_order: number; file_type: string; attachment_id: string | null; created_at: string; updated_at: string }
interface PasswordRow { id: string; title: string; url: string | null; username: string | null; account: string | null; password: string; notes: string | null; sort_order: number; created_at: string; updated_at: string }
interface MomentsRow { id: string; content_md: string; content_html: string | null; image_data_url: string | null; images_data_urls: string | null; attachment_ids: string | null; tags: string | null; album_id: string | null; is_pinned: number; created_at: string; updated_at: string }
interface AlbumRow { id: string; name: string; cover_data_url: string | null; cover_post_id: string | null; cover_index: number | null; created_at: string; updated_at: string }
interface ScriptRow { id: string; name: string; description: string; content: string; language: string; sort_order: number; created_at: string; updated_at: string }
interface WeightRow { id: string; weight: number; date: string; series: string; note: string; created_at: string }
interface RecycleRow { id: string; original_id: string; module: string; title: string; data: string; deleted_at: string }
interface KnowledgePageTagRow { page_id: string; tag_id: string }

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
  return { id: r.id, title: r.title, contentMd: r.content_md, contentHtml: r.content_html || '', categoryId: r.category_id, isStarred: !!r.is_starred, sortOrder: r.sort_order, fileType: r.file_type || '', attachmentId: r.attachment_id || null, createdAt: r.created_at, updatedAt: r.updated_at }
}

function mapPassword(r: PasswordRow) {
  return { id: r.id, title: r.title, url: r.url || '', username: r.username || '', account: r.account || '', password: r.password, notes: r.notes || '', sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at }
}

function mapMoments(r: MomentsRow) {
  let images: string[] = []
  if (r.images_data_urls) {
    try {
      const arr = JSON.parse(r.images_data_urls)
      if (Array.isArray(arr)) images = arr.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
    } catch { /* fall through */ }
  }
  if (images.length === 0 && r.image_data_url) images = [r.image_data_url]
  let tags: string[] = []
  if (r.tags) {
    try {
      const arr = JSON.parse(r.tags)
      if (Array.isArray(arr)) tags = arr.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
    } catch { /* fall through */ }
  }
  let attachmentIds: string[] = []
  if (r.attachment_ids) {
    try {
      const arr = JSON.parse(r.attachment_ids)
      if (Array.isArray(arr)) attachmentIds = arr.filter((v: unknown): v is string => typeof v === 'string')
    } catch { /* fall through */ }
  }
  return { id: r.id, contentMd: r.content_md, contentHtml: r.content_html || '', imageDataUrls: images, attachmentIds, attachments: [], tags, albumId: r.album_id || '', isPinned: r.is_pinned === 1, createdAt: r.created_at, updatedAt: r.updated_at }
}

function mapAlbum(r: AlbumRow) {
  return { id: r.id, name: r.name, photoCount: 0, cover: '', coverPostId: r.cover_post_id || '', coverIndex: r.cover_index || 0, createdAt: r.created_at, updatedAt: r.updated_at }
}

export function buildAllData(moduleIds?: string[]) {
  const sel = (id: string) => !moduleIds || moduleIds.length === 0 || moduleIds.includes(id)

  // Blog
  const entries = sel('blog') ? queryAll<EntryRow>('SELECT * FROM entries ORDER BY date DESC') : []
  const blogTags = sel('blog') ? queryAll<TagRow>('SELECT * FROM tags ORDER BY name') : []
  const etRows = sel('blog') ? queryAll<{ entry_id: string; tag_id: string }>('SELECT * FROM entry_tags') : []
  const blogTagMap = new Map<string, TagRow[]>()
  for (const et of etRows) {
    const t = blogTags.find(tg => tg.id === et.tag_id)
    if (t) {
      if (!blogTagMap.has(et.entry_id)) blogTagMap.set(et.entry_id, [])
      blogTagMap.get(et.entry_id)!.push(t)
    }
  }

  // Schedule
  const todos = sel('schedule') ? queryAll<TodoRow>('SELECT * FROM schedule_todos ORDER BY date DESC, sort_order, created_at') : []
  const scheduleTags = sel('schedule') ? queryAll<ScheduleTagRow>('SELECT * FROM schedule_tags ORDER BY name') : []
  const sTagMap = new Map(scheduleTags.map(t => [t.id, t]))

  // Knowledge
  const categories = sel('knowledge') ? queryAll<CategoryRow>('SELECT * FROM knowledge_categories ORDER BY sort_order, name') : []
  const pages = sel('knowledge') ? queryAll<PageRow>('SELECT * FROM knowledge_pages ORDER BY sort_order, updated_at DESC') : []
  const knowledgeTags = sel('knowledge') ? queryAll<TagRow>('SELECT * FROM knowledge_tags ORDER BY name') : []
  const linkRows = sel('knowledge') ? queryAll<{ source_page_id: string; target_page_id: string }>('SELECT * FROM knowledge_links') : []
  const backlinkMap = new Map<string, string[]>()
  for (const l of linkRows) {
    const page = pages.find(p => p.id === l.source_page_id)
    if (page) {
      if (!backlinkMap.has(l.target_page_id)) backlinkMap.set(l.target_page_id, [])
      backlinkMap.get(l.target_page_id)!.push(page.title)
    }
  }
  const kptRows = sel('knowledge') ? queryAll<KnowledgePageTagRow>('SELECT * FROM knowledge_page_tags') : []
  const pageTagMap = new Map<string, TagRow[]>()
  for (const kpt of kptRows) {
    const t = knowledgeTags.find(tg => tg.id === kpt.tag_id)
    if (t) {
      if (!pageTagMap.has(kpt.page_id)) pageTagMap.set(kpt.page_id, [])
      pageTagMap.get(kpt.page_id)!.push(t)
    }
  }

  // Password Vault + Moments
  const pwdEntries = sel('passwordVault') ? queryAll<PasswordRow>('SELECT * FROM toolbox_passwords ORDER BY sort_order, updated_at DESC') : []
  const moments = sel('moments') ? queryAll<MomentsRow>('SELECT * FROM moments_posts ORDER BY is_pinned DESC, created_at DESC') : []
  const albums = sel('moments') ? queryAll<AlbumRow>('SELECT * FROM moments_albums ORDER BY created_at DESC') : []

  // Toolbox + Recycle bin (app-level, always included)
  const scripts = queryAll<ScriptRow>('SELECT * FROM toolbox_scripts ORDER BY sort_order, created_at')
  const weightRecords = queryAll<WeightRow>('SELECT * FROM toolbox_weight_records ORDER BY date DESC, created_at DESC')
  const recycleItems = queryAll<RecycleRow>('SELECT * FROM recycle_bin ORDER BY deleted_at DESC')

  // User profile (app-level, always included so a restore is complete)
  const userRow = queryAll<{ username: string; avatar_path: string; password_hash: string; created_at: string; updated_at: string }>(
    "SELECT username, avatar_path, password_hash, created_at, updated_at FROM user_profile WHERE id = 'default'"
  )[0] ?? null

  return {
    exportVersion: '2.0',
    exportedAt: new Date().toISOString(),
    user: userRow
      ? { username: userRow.username, avatarPath: userRow.avatar_path, passwordHash: userRow.password_hash, createdAt: userRow.created_at, updatedAt: userRow.updated_at }
      : null,
    blog: {
      entries: entries.map(e => ({ ...mapEntry(e), tags: blogTagMap.get(e.id) || [] })),
      tags: blogTags
    },
    schedule: {
      todos: todos.map(t => ({ ...mapTodo(t), tag: t.tag_id ? sTagMap.get(t.tag_id) || null : null })),
      tags: scheduleTags
    },
    knowledge: {
      categories: categories.map(c => ({ id: c.id, name: c.name, parentId: c.parent_id, sortOrder: c.sort_order, categoryType: (c.category_type === 'notebook' || c.category_type === 'space' ? c.category_type : 'folder') as 'notebook' | 'folder' | 'space' })),
      pages: pages.map(p => ({ ...mapPage(p), tags: pageTagMap.get(p.id) || [], backlinks: backlinkMap.get(p.id) || [] })),
      tags: knowledgeTags
    },
    passwordVault: {
      entries: pwdEntries.map(mapPassword)
    },
    moments: {
      posts: moments.map(mapMoments),
      albums: albums.map(mapAlbum)
    },
    toolbox: {
      scripts: scripts.map(s => ({ id: s.id, name: s.name, description: s.description, content: s.content, language: s.language, sortOrder: s.sort_order, createdAt: s.created_at, updatedAt: s.updated_at })),
      weightRecords: weightRecords.map(w => ({ id: w.id, weight: w.weight, date: w.date, series: w.series, note: w.note, createdAt: w.created_at }))
    },
    recycleBin: {
      items: recycleItems.map(r => ({ id: r.id, originalId: r.original_id, module: r.module, title: r.title, data: r.data, deletedAt: r.deleted_at }))
    },
  }
}

export function registerExportHandlers(): void {
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

  // ===== File I/O =====
  ipcMain.handle('export:writeTextFile', (_e, filePath: string, content: string, encoding: string = 'utf-8') => {
    const buf = encodeText(content, encoding)
    writeFileSync(filePath, buf)
    const size = statSync(filePath).size
    return { filePath, size }
  })
}
