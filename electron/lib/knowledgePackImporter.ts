import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { randomUUID, createHash } from 'crypto'
import { getDatabase, saveToDisk, getAttachmentsDir } from '../database/connection'
import { getPluginsRoot, auditWrite } from './pluginRegistry'
import { safePathInside } from './pathGuard'

/**
 * 内容型插件(knowledgePages)导入引擎。
 * 插件 zip 内携带 Markdown 页面集合,导入后在知识库批量创建 空间 → 笔记本 → 章节 → 页面。
 * 幂等:external_id + content_hash 判重;用户改过的页面默认跳过(可强制覆盖)。
 */

const PAGE_MAX_BYTES = 512 * 1024

interface KPPage { file: string; title: string; externalId: string; tags?: string[] }
interface KPChapter { name: string; pages: KPPage[] }
/** v2 多笔记本形态 */
interface KPNotebook { name: string; coverColor?: string; chapters: KPChapter[] }
/**
 * 兼容两种 manifest 形态:
 * - v1(单笔记本):{ notebook, coverColor?, chapters[] }
 * - v2(空间优先,多笔记本):{ space, notebooks:[{ name, chapters[] }] }
 * 解析后统一为 { spaceBase, notebooks }
 */
interface KPPackNormalized { spaceBase: string; notebooks: KPNotebook[] }
type KPPackRaw = {
  notebook?: unknown; space?: unknown; coverColor?: unknown; chapters?: unknown; notebooks?: unknown
}

interface MappingRow { external_id: string; page_id: string; content_hash: string; imported_at: string; space_id?: string }

function pluginDebugLog(line: string): void {
  try { appendFileSync(join(app.getPath('userData'), 'plugin-debug.log'), new Date().toISOString().slice(11, 23) + ' ' + line + '\n') } catch { /* ignore */ }
}

function parsePack(mf: { knowledgePages?: unknown }): KPPackNormalized | null {
  const kp = mf.knowledgePages as KPPackRaw | undefined
  if (!kp || typeof kp !== 'object') return null
  const isChapterArr = (v: unknown): v is KPChapter[] =>
    Array.isArray(v) && v.length > 0 && v.every(c => c && typeof c === 'object' && typeof (c as KPChapter).name === 'string' && Array.isArray((c as KPChapter).pages))
  // v2:space + notebooks[]
  if (Array.isArray(kp.notebooks) && kp.notebooks.length > 0) {
    const notebooks: KPNotebook[] = []
    for (const nb of kp.notebooks as unknown[]) {
      const n = nb as KPNotebook
      if (!n || typeof n !== 'object' || typeof n.name !== 'string' || !isChapterArr(n.chapters)) {
        pluginDebugLog(`[knowledgePack] 笔记本校验失败: name=${(n as KPNotebook)?.name} nameType=${typeof (n as KPNotebook)?.name} chaptersIsArr=${Array.isArray(n?.chapters)} chLen=${Array.isArray(n?.chapters) ? n.chapters.length : -1}`)
        return null
      }
      notebooks.push({ name: n.name, coverColor: typeof n.coverColor === 'string' ? n.coverColor : undefined, chapters: n.chapters })
    }
    const spaceBase = (typeof kp.space === 'string' && kp.space.trim()) || notebooks[0].name
    return { spaceBase, notebooks }
  }
  // v1:单笔记本
  if (typeof kp.notebook === 'string' && isChapterArr(kp.chapters)) {
    return { spaceBase: kp.notebook, notebooks: [{ name: kp.notebook, coverColor: typeof kp.coverColor === 'string' ? kp.coverColor : undefined, chapters: kp.chapters }] }
  }
  return null
}

function readMapping(pluginId: string): Map<string, MappingRow> {
  const db = getDatabase()
  const rows: MappingRow[] = []
  const stmt = db.prepare('SELECT external_id, page_id, content_hash, imported_at, space_id FROM knowledge_pack_imports WHERE plugin_id = ?')
  stmt.bind([pluginId])
  while (stmt.step()) rows.push(stmt.getAsObject() as MappingRow)
  stmt.free()
  return new Map(rows.map(r => [r.external_id, r]))
}

/** 读取插件包内 md 文本(svg 活动内容剥离在导入时处理) */
function readPageMd(pluginDir: string, file: string): { buf: Buffer } | { error: string } {
  const p = safePathInside(pluginDir, file)
  if (!p || !existsSync(p)) return { error: `页面文件缺失: ${file}` }
  const buf = readFileSync(p)
  if (buf.length > PAGE_MAX_BYTES) return { error: `页面超过 512KB 限制: ${file}` }
  return { buf }
}

const hashOf = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

/** 提取"独立成段"的内联 SVG 块 → 存为 assets/extracted-N.svg,替换为图片引用 */
function extractInlineSvgs(md: string): { md: string; extracted: { name: string; content: string }[] } {
  const extracted: { name: string; content: string }[] = []
  const lines = md.split('\n')
  const outLines: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*<svg[\s>]/i.test(line)) {
      // 收集到 </svg> 为止
      const block: string[] = []
      let closed = false
      while (i < lines.length) {
        block.push(lines[i])
        if (/<\/svg>/i.test(lines[i])) { closed = true; i++; break }
        i++
      }
      if (closed) {
        let content = block.join('\n')
        const hadScript = /<script/i.test(content)
        content = content.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        const name = `assets/extracted-${extracted.length + 1}.svg`
        extracted.push({ name, content })
        outLines.push(`![示意图](${name})`)
        if (hadScript) pluginDebugLog(`[knowledgePack] 内联 SVG 含脚本,已剥离 (${name})`)
        continue
      }
      // 未闭合,原样保留
      outLines.push(...block)
      continue
    }
    outLines.push(line)
    i++
  }
  return { md: outLines.join('\n'), extracted }
}

/** 剥离 svg 文本中的活动内容 */
function sanitizeSvgText(content: string): string {
  return content.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/**
 * 动画占位符 ```anim:<blockId>``` 处理(M2):
 * 改写为携带插件 id 的 fence —— 渲染层据此构造 plugin://<pid>/anims/player.html?id=<bid>
 * 沙箱 iframe 内嵌播放。首行文本作为 ariaLabel 说明保留。
 */
function transformAnimPlaceholders(md: string, pluginId: string): string {
  return md.replace(/```anim:([A-Za-z0-9._-]+)[ \t]*\n([\s\S]*?)```/g, (_m, id: string, body: string) => {
    const label = String(body).trim().split('\n')[0] || id
    return '```anim@' + pluginId + ':' + id + '\n' + label + '\n```'
  })
}

/** 页面正文导入前的统一预处理 */
function preprocessPageMd(raw: string, pluginId: string): string {
  return transformAnimPlaceholders(raw, pluginId)
}

/**
 * md 中的图片/内联 svg → 附件上传,返回改写后的 md 与附件 id 列表。
 * assetBaseDir = 页面 md 所在目录(相对引用以其为基准解析),最终仍受插件根目录约束。
 */
function processImages(md: string, pluginDir: string, pageFileDir: string, ownerId: string, stagedFiles: string[]): { md: string; attachmentIds: string[] } {
  const attachmentIds: string[] = []
  const attachmentsDir = getAttachmentsDir()

  const uploadAsset = (assetRel: string, contentOverride?: string): string | null => {
    let buf: Buffer
    let fileName: string
    if (contentOverride !== undefined) {
      buf = Buffer.from(contentOverride, 'utf-8')
      fileName = basename(assetRel)
    } else {
      // 相对引用基于 md 文件目录解析;再校验仍在插件目录内(防穿越)
      const src = safePathInside(pluginDir, join(pageFileDir, assetRel))
      if (!src || !existsSync(src)) return null
      buf = readFileSync(src)
      fileName = basename(src)
    }
    const ext = (assetRel.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase()
    const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }
    const mime = mimeMap[ext] || 'application/octet-stream'
    const id = randomUUID()
    const rel = join('knowledge_page', ownerId, `${id}.${ext}`)
    const dest = join(getAttachmentsDir(), rel)
    mkdirSync(resolve(dest, '..'), { recursive: true })
    writeFileSync(dest, buf)
    stagedFiles.push(dest)
    // 直接 INSERT(不经 run(),避免事务中途 saveToDisk 破坏原子性)
    getDatabase().run(
      `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, mime_type, size_bytes, created_at)
       VALUES (?, 'knowledge_page', ?, 0, ?, ?, ?, ?, ?)`,
      [id, ownerId, fileName, rel, mime, buf.length, new Date().toISOString()]
    )
    attachmentIds.push(id)
    return id
  }

  // 1) 内联 svg 提取
  const ex = extractInlineSvgs(md)
  let out = ex.md
  for (const item of ex.extracted) {
    const id = uploadAsset(item.name, sanitizeSvgText(item.content))
    if (!id) continue
    // 替换刚写入的引用(同名按序,最后一个匹配即可)
    out = out.replace(`](${item.name})`, `](attachment://${id})`)
  }

  // 2) 既有 assets 引用改写为 attachment://(支持 pages/<book>/ 下形如 ../../assets/<book>/x.svg 的相对引用)
  out = out.replace(/(!\[[^\]]*\]\()((?:\.\.\/)*assets\/[^)]+)(\))/g, (_m, pre: string, assetRel: string, post: string) => {
    const id = uploadAsset(assetRel)
    if (!id) return `${pre}${assetRel}${post}` // 找不到文件原样保留
    return `${pre}attachment://${id}${post}`
  })

  return { md: out, attachmentIds }
}

function pushProgress(pluginId: string, current: number, total: number, title: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('knowledgePack:progress', { pluginId, current, total, title })
  }
}

// ---------- 状态查询 ----------

export function getPackState(pluginId: string): {
  ok: boolean
  state?: 'not-imported' | 'imported' | 'update-available'
  version?: string
  chapters?: number
  totalPages?: number
  newPages?: number
  changedPages?: number
  lastImportedAt?: string
  spaceId?: string | null
  notebookCount?: number
  spaceName?: string
  message?: string
} {
  try {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(pluginId)) return { ok: false, message: '插件 id 非法' }
    const pluginDir = join(getPluginsRoot(), pluginId)
    if (!existsSync(pluginDir)) return { ok: false, message: '插件未安装' }
    const parsed = readPackManifest(pluginDir)
    if ('error' in parsed) return { ok: false, message: parsed.error }
    const pack = parsed.pack
    const totalPages = pack.notebooks.reduce((n, nb) => n + nb.chapters.reduce((m, c) => m + c.pages.length, 0), 0)
    const chapterTotal = pack.notebooks.reduce((n, nb) => n + nb.chapters.length, 0)

    const mapping = readMapping(pluginId)
    if (mapping.size === 0) {
      return { ok: true, state: 'not-imported', version: parsed.version, chapters: chapterTotal, totalPages, notebookCount: pack.notebooks.length, spaceName: pack.spaceBase }
    }

    // 与当前包内容比对:新增页 / 内容变化页(映射存在但页面已被删除 → 计入待重建)
    let newPages = 0, changedPages = 0
    let spaceId: string | null = null
    let lastImportedAt = ''
    for (const notebook of pack.notebooks) {
      for (const chapter of notebook.chapters) {
        for (const page of chapter.pages) {
          const buf = readPageMd(pluginDir, page.file)
          const hash = 'buf' in buf ? hashOf(buf.buf) : ''
          const row = mapping.get(page.externalId)
          if (!row) { newPages++; continue }
          const alive = getDatabase().exec('SELECT 1 FROM knowledge_pages WHERE id = ?', [row.page_id])
          if (alive.length === 0) { newPages++; continue }
          if (row.content_hash !== hash) changedPages++
          if (!lastImportedAt || row.imported_at > lastImportedAt) lastImportedAt = row.imported_at
          spaceId = row.space_id || spaceId
        }
      }
    }
    const state = newPages > 0 || changedPages > 0 ? 'update-available' : 'imported'
    return { ok: true, state, version: parsed.version, chapters: chapterTotal, totalPages, newPages, changedPages, lastImportedAt, spaceId, notebookCount: pack.notebooks.length, spaceName: pack.spaceBase }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) }
  }
}

function readPackManifest(pluginDir: string): { pack: KPPackNormalized; version: string } | { error: string } {
  const mfPath = join(pluginDir, 'plugin.json')
  if (!existsSync(mfPath)) return { error: 'plugin.json 缺失' }
  let mf: any
  try { mf = JSON.parse(readFileSync(mfPath, 'utf-8')) } catch { return { error: 'plugin.json 解析失败' } }
  // 注意:parsePack 接收 contributes 子对象,knowledgePages 声明在 contributes 下
  const pack = parsePack((mf.contributes ?? {}) as { knowledgePages?: unknown })
  if (!pack) return { error: 'manifest 缺少有效的 knowledgePages 贡献' }
  return { pack, version: String(mf.version || '') }
}

// ---------- 导入 ----------

export function importPack(pluginId: string, overwriteModified: boolean): {
  ok: boolean
  created?: number; updated?: number; skipped?: number; conflicts?: { title: string; reason: string }[]
  spaceId?: string | null
  message?: string
} {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(pluginId)) return { ok: false, message: '插件 id 非法' }
  const pluginDir = join(getPluginsRoot(), pluginId)
  if (!existsSync(pluginDir)) return { ok: false, message: '插件未安装' }
  const mfParsed = readPackManifest(pluginDir)
  if ('error' in mfParsed) return { ok: false, message: mfParsed.error }
  const pack = mfParsed.pack
  const packVersion = mfParsed.version

  const db = getDatabase()
  const mapping = readMapping(pluginId)
  const stagedFiles: string[] = []   // 事务回滚时清理的附件文件
  const stagedAttachmentIds: string[] = []
  const now = new Date().toISOString()

  // 展平页面用于进度(跨全部笔记本)
  const flat: { chapter: KPChapter; page: KPPage }[] = []
  for (const nb of pack.notebooks) for (const ch of nb.chapters) for (const pg of ch.pages) flat.push({ chapter: ch, page: pg })
  const total = flat.length

  // ===== 预扫描:缓存包内 md、统计待处理页、探测可复用的既有导入空间 =====
  const rawCache = new Map<string, { buf?: Buffer; error?: string }>()
  let liveSpaceId: string | null = null
  let pendingCount = 0
  const esc = (s: string) => s.replace(/'/g, "''")
  for (const f of flat) {
    const r0 = readPageMd(pluginDir, f.page.file)
    if ('error' in r0) { rawCache.set(f.page.externalId, { error: r0.error }); continue }
    rawCache.set(f.page.externalId, { buf: r0.buf })
    const row0 = mapping.get(f.page.externalId)
    if (!row0) { pendingCount++; continue }
    const alive = getDatabase().exec('SELECT 1 FROM knowledge_pages WHERE id = ?', [row0.page_id])
    if (alive.length === 0) { pendingCount++; continue }
    if (row0.content_hash !== hashOf(r0.buf)) { pendingCount++; continue }
    // 记录一个仍然存在的既往空间(供复用)
    if (!liveSpaceId && row0.space_id) {
      const sp = getDatabase().exec(
        `SELECT 1 FROM knowledge_categories WHERE id = '${esc(row0.space_id)}' AND category_type = 'space' LIMIT 1`
      )
      if (sp.length > 0) liveSpaceId = row0.space_id
    }
  }

  db.run('BEGIN')
  let created = 0, updated = 0, skipped = 0
  const conflicts: { title: string; reason: string }[] = []
  let spaceId: string | null = null
  try {
    // 无任何待处理页 → 不再新建空壳空间,直接返回
    if (pendingCount === 0) {
      db.run('COMMIT')
      return { ok: true, created: 0, updated: 0, skipped: total, conflicts, spaceId: liveSpaceId }
    }

    // 1) 顶层空间:
    //    - 既有导入的空间仍存在 → 复用(更新语义:内容落入同一空间,不产生重复壳)
    //    - 否则新建(空间优先原则;同名已存在时追加后缀)
    if (liveSpaceId) {
      spaceId = liveSpaceId
    } else {
      const pluginName = getPluginName(pluginId)
      let spaceName = pack.spaceBase
      const spaceExists = (name: string) => getDatabase().exec(
        `SELECT id FROM knowledge_categories WHERE name = '${esc(name)}' AND category_type = 'space' AND parent_id IS NULL LIMIT 1`
      ).length > 0
      let suffix = 0
      while (spaceExists(spaceName)) { suffix++; spaceName = suffix === 1 ? `${pack.spaceBase}(${pluginName})` : `${pack.spaceBase}(${pluginName}-${suffix})` }
      spaceId = randomUUID()
      const maxOrder = getDatabase().exec("SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id IS NULL")
      db.run(
        'INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, NULL, ?, ?)',
        [spaceId, spaceName, (maxOrder[0]?.values?.[0]?.[0] as number) ?? 0, 'space']
      )
    }

    // 2) 笔记本(v2 支持多笔记本)+ 章节 + 页面;复用空间时按名称挂靠既有结构
    const findChild = (parentId: string, name: string, type: string): string | null => {
      const hit = getDatabase().exec(
        `SELECT id FROM knowledge_categories WHERE parent_id = '${esc(parentId)}' AND name = '${esc(name)}' AND category_type = '${type}' LIMIT 1`
      )
      return hit.length > 0 ? String(hit[0].values[0][0]) : null
    }
    let done = 0
    for (const notebook of pack.notebooks) {
      let notebookId = findChild(spaceId!, notebook.name, 'notebook')
      if (!notebookId) {
        notebookId = randomUUID()
        const nbOrder = getDatabase().exec(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id = ?',
          [spaceId]
        )
        db.run(
          'INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, ?, ?, ?)',
          [notebookId, notebook.name, spaceId, (nbOrder[0]?.values?.[0]?.[0] as number) ?? 0, 'notebook']
        )
      }

      for (const chapter of notebook.chapters) {
        let chapterId = findChild(notebookId, chapter.name, 'folder')
        if (!chapterId) {
          chapterId = randomUUID()
          const chOrder = getDatabase().exec(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id = ?',
            [notebookId]
          )
          db.run(
            'INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, ?, ?, ?)',
            [chapterId, chapter.name, notebookId, (chOrder[0]?.values?.[0]?.[0] as number) ?? 0, 'folder']
          )
        }

      for (const page of chapter.pages) {
        done++
        pushProgress(pluginId, done, total, page.title)
        const row = mapping.get(page.externalId)
        // 映射存在但页面已被用户删除 → 视为全新导入(否则会误判"无变化"而跳过)
        let livePageId: string | null = null
        if (row) {
          const alive = getDatabase().exec('SELECT 1 FROM knowledge_pages WHERE id = ?', [row.page_id])
          if (alive.length > 0) livePageId = row.page_id
        }
        const mdRes = readPageMd(pluginDir, page.file)
        if ('error' in mdRes) { conflicts.push({ title: page.title, reason: mdRes.error }); skipped++; continue }
        const hash = hashOf(mdRes.buf)

        if (row && livePageId) {
          if (row.content_hash === hash) { skipped++; continue }
          // 用户本地改过(updated_at 晚于上次导入)→ 默认跳过
          const pageRow = getDatabase().exec('SELECT updated_at FROM knowledge_pages WHERE id = ?', [livePageId])
          const userModified = pageRow.length > 0 && String(pageRow[0].values[0][0]) > row.imported_at
          if (userModified && !overwriteModified) {
            conflicts.push({ title: page.title, reason: '本地已修改' })
            skipped++
            continue
          }
          // 覆盖/静默更新
          const { md, attachmentIds } = processImages(preprocessPageMd(mdRes.buf.toString('utf-8'), pluginId), pluginDir, dirname(page.file), livePageId, stagedFiles)
          stagedAttachmentIds.push(...attachmentIds)
          db.run(
            'UPDATE knowledge_pages SET content_md = ?, updated_at = ? WHERE id = ?',
            [md, now, livePageId]
          )
          db.run(
            `INSERT OR REPLACE INTO knowledge_pack_imports (plugin_id, external_id, page_id, content_hash, pack_version, space_id, imported_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [pluginId, page.externalId, livePageId, hash, packVersion, spaceId, now]
          )
          updated++
          continue
        }

        // 新页面(先预生成 pageId,附件直接归属)
        const pageId = randomUUID()
        const { md, attachmentIds } = processImages(preprocessPageMd(mdRes.buf.toString('utf-8'), pluginId), pluginDir, dirname(page.file), pageId, stagedFiles)
        stagedAttachmentIds.push(...attachmentIds)
        const pgOrder = getDatabase().exec(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id = ?',
          [chapterId]
        )
        db.run(
          `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, created_at, updated_at)
           VALUES (?, ?, ?, '', ?, ?, 'md', ?, ?)`,
          [pageId, page.title, md, chapterId, (pgOrder[0]?.values?.[0]?.[0] as number) ?? 0, now, now]
        )
        // 标签
        for (const tag of page.tags || []) {
          if (typeof tag !== 'string' || !tag.trim()) continue
          const exist = getDatabase().exec('SELECT id FROM knowledge_tags WHERE name = ?', [tag.trim()])
          let tagId: string
          if (exist.length > 0 && exist[0].values?.[0]?.[0]) tagId = String(exist[0].values[0][0])
          else { tagId = randomUUID(); db.run('INSERT INTO knowledge_tags (id, name, color) VALUES (?, ?, ?)', [tagId, tag.trim(), '#6b7280']) }
          db.run('INSERT OR IGNORE INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [pageId, tagId])
        }
        db.run(
          `INSERT OR REPLACE INTO knowledge_pack_imports (plugin_id, external_id, page_id, content_hash, pack_version, space_id, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pluginId, page.externalId, pageId, hash, packVersion, spaceId, now]
        )
        created++
      }
      }
    }

    db.run('COMMIT')
  } catch (e: any) {
    try { db.run('ROLLBACK') } catch { /* ignore */ }
    // 清理已落盘的孤儿附件
    for (const f of stagedFiles) { try { if (existsSync(f)) rmSync(f, { force: true }) } catch { /* ignore */ } }
    return { ok: false, message: `导入失败(已回滚): ${e?.message || e}`, conflicts }
  }

  saveToDisk()
  auditWrite(pluginId, 'pack.import', { version: packVersion, created, updated, skipped, overwriteModified })
  return { ok: true, created, updated, skipped, conflicts, spaceId }
}

function getPluginName(pluginId: string): string {
  try {
    const mf = JSON.parse(readFileSync(join(getPluginsRoot(), pluginId, 'plugin.json'), 'utf-8'))
    return typeof mf.name === 'string' ? mf.name : pluginId
  } catch { return pluginId }
}

function rmSyncFor(f: string): void {
  // 延迟引入避免循环依赖顾虑(仅标准 fs)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('fs').rmSync(f, { force: true })
}
