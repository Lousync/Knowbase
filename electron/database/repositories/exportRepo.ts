import { ipcMain, dialog, BrowserWindow } from 'electron'
import { resolve } from 'path'
import { getDatabase } from '../connection'
import { writeFileSync, statSync } from 'fs'
import * as iconv from 'iconv-lite'
import { decryptPassword } from './passwordRepo'

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
interface MomentsRow { id: string; content_md: string; content_html: string | null; image_data_url: string | null; images_data_urls: string | null; attachment_ids: string | null; tags: string | null; album_id: string | null; is_pinned: number; show_in_timeline: number | null; created_at: string; updated_at: string }
interface AlbumRow { id: string; name: string; cover_data_url: string | null; cover_post_id: string | null; cover_index: number | null; created_at: string; updated_at: string }
interface ScriptRow { id: string; name: string; description: string; content: string; language: string; sort_order: number; created_at: string; updated_at: string }
interface WeightRow { id: string; weight: number; date: string; series: string; note: string; created_at: string }
interface RecycleRow { id: string; original_id: string; module: string; title: string; data: string; deleted_at: string }
interface KnowledgePageTagRow { page_id: string; tag_id: string }
interface HabitRow { id: string; name: string; color: string; icon: string; rule_type: string; rule_days: string; weekly_target: number; sort_order: number; archived: number; created_at: string; updated_at: string }
interface BookmarkCategoryRow { id: string; name: string; color: string; sort_order: number; created_at: string }
interface BookmarkItemRow { id: string; category_id: string; title: string; url: string; description: string; sort_order: number; created_at: string }

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
  return { id: r.id, title: r.title, url: r.url || '', username: r.username || '', account: r.account || '', password: decryptPassword(r.password), notes: r.notes || '', sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at }
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
  return { id: r.id, contentMd: r.content_md, contentHtml: r.content_html || '', imageDataUrls: images, attachmentIds, attachments: [], tags, albumId: r.album_id || '', isPinned: r.is_pinned === 1, showInTimeline: r.show_in_timeline !== 0, createdAt: r.created_at, updatedAt: r.updated_at }
}

function mapAlbum(r: AlbumRow) {
  return { id: r.id, name: r.name, photoCount: 0, cover: '', coverPostId: r.cover_post_id || '', coverIndex: r.cover_index || 0, createdAt: r.created_at, updatedAt: r.updated_at }
}

function mapHabit(r: HabitRow) {
  let ruleDays: number[] = []
  try {
    const arr = JSON.parse(r.rule_days)
    if (Array.isArray(arr)) ruleDays = arr.map(Number)
  } catch { /* fall through */ }
  return {
    id: r.id, name: r.name, color: r.color, icon: r.icon || 'check',
    ruleType: (r.rule_type === 'weekdays' || r.rule_type === 'flexible' ? r.rule_type : 'daily') as 'daily' | 'weekdays' | 'flexible',
    ruleDays, weeklyTarget: r.weekly_target ?? 3, sortOrder: r.sort_order ?? 0,
    archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
  }
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

  // Checkin（习惯打卡）+ Bookmark Nav（网址导航）
  const habitRows = sel('checkin') ? queryAll<HabitRow>('SELECT * FROM habits ORDER BY sort_order, created_at') : []
  const habitRecordRows = sel('checkin') ? queryAll<{ id: string; habit_id: string; date: string; source: string }>('SELECT id, habit_id, date, source FROM habit_records') : []
  const habitLinkRows = sel('checkin') ? queryAll<{ habit_id: string; source: string; threshold: number; enabled: number }>('SELECT habit_id, source, threshold, enabled FROM habit_links') : []
  const bmCatRows = sel('bookmarkNav') ? queryAll<BookmarkCategoryRow>('SELECT * FROM bookmark_categories ORDER BY sort_order, created_at') : []
  const bmItemRows = sel('bookmarkNav') ? queryAll<BookmarkItemRow>('SELECT * FROM bookmarks ORDER BY category_id, sort_order, created_at') : []

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
    checkin: {
      habits: habitRows.map(mapHabit),
      records: habitRecordRows.map(r => ({ id: r.id, habitId: r.habit_id, date: r.date, source: (r.source === 'auto' ? 'auto' : 'manual') as 'manual' | 'auto' })),
      links: habitLinkRows.map(l => ({ habitId: l.habit_id, source: l.source as 'blog' | 'pomodoro' | 'schedule' | 'knowledge', threshold: l.threshold, enabled: l.enabled === 1 }))
    },
    bookmarkNav: {
      categories: bmCatRows.map(c => ({ id: c.id, name: c.name, color: c.color, sortOrder: c.sort_order ?? 0, createdAt: c.created_at })),
      bookmarks: bmItemRows.map(b => ({ id: b.id, categoryId: b.category_id || '', title: b.title, url: b.url, description: b.description || '', sortOrder: b.sort_order ?? 0, createdAt: b.created_at }))
    },
    toolbox: {
      scripts: scripts.map(s => ({ id: s.id, name: s.name, description: s.description, content: s.content, language: s.language, sortOrder: s.sort_order, createdAt: s.created_at, updatedAt: s.updated_at })),
      weightRecords: weightRecords.map(w => ({ id: w.id, weight: w.weight, date: w.date, series: w.series, note: w.note, createdAt: w.created_at }))
    },
    recycleBin: {
      items: recycleItems.map(r => ({ id: r.id, originalId: r.original_id, module: r.module, title: r.title, data: r.data, deletedAt: r.deleted_at }))
    },
    // 内容型插件导入映射(换机恢复后「检查更新」不产生重复页面)
    knowledgePackImports: queryAll<{ plugin_id: string; external_id: string; page_id: string; content_hash: string; pack_version: string; space_id: string | null; imported_at: string }>(
      'SELECT plugin_id, external_id, page_id, content_hash, pack_version, space_id, imported_at FROM knowledge_pack_imports'
    ).map(r => ({ ...r })),
  }
}

// ===== 写路径授权 =====
// 只有近期由"保存对话框"返回的路径才允许被写入 IPC 使用——
// 防止渲染层被注入后用任意路径覆写系统文件(启动目录/计划任务等)。
const authorizedWritePaths = new Set<string>()

export function isWritePathAuthorized(p: string): boolean {
  try {
    const resolved = resolve(p)
    for (const ap of authorizedWritePaths) {
      if (resolve(ap) === resolved) return true
    }
  } catch { /* ignore */ }
  return false
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
    const filePath = result.canceled ? null : result.filePath ?? null
    if (filePath) authorizedWritePaths.add(filePath)
    return { filePath }
  })

  // ===== File I/O =====
  ipcMain.handle('export:writeTextFile', (_e, filePath: string, content: string, encoding: string = 'utf-8') => {
    if (!isWritePathAuthorized(filePath)) throw new Error('写入路径未经过保存对话框授权,已拒绝')
    const buf = encodeText(content, encoding)
    writeFileSync(filePath, buf)
    const size = statSync(filePath).size
    return { filePath, size }
  })
}
