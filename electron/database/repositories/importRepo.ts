import { ipcMain, BrowserWindow, dialog } from 'electron'
import { readFileSync, writeFileSync, unlinkSync, existsSync, copyFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { getDatabase, saveToDisk, closeDatabase, initDatabase, getDbPath, getAttachmentsDir, getSqlJs, validateDatabaseBuffer } from '../connection'
import { randomUUID } from 'crypto'
import { registerAttachment } from './attachmentRepo'
import { encryptExistingPasswords } from './passwordRepo'

const TEXT_EXTS = ['md', 'txt', 'json', 'cpp', 'c', 'h', 'hpp', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'java', 'rs', 'go', 'sh', 'bat', 'xml', 'yaml', 'yml', 'sql', 'r', 'rb', 'php', 'swift', 'kt', 'lua', 'ini', 'cfg', 'toml']

function fileNameBase(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase()
  return basename(filePath).replace(new RegExp(`\\.${ext}$`, 'i'), '')
}

function mimeFromExt(ext: string): string {
  const m: Record<string, string> = {
    pdf: 'application/pdf', xmind: 'application/octet-stream',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
    md: 'text/markdown', txt: 'text/plain', json: 'application/json',
  }
  return m[ext] || 'application/octet-stream'
}

function extToFileType(ext: string): string {
  const extLower = ext.toLowerCase()
  const mapping: Record<string, string> = {
    'md': 'md', 'txt': 'txt', 'json': 'json',
    'cpp': 'cpp', 'c': 'c', 'h': 'c', 'hpp': 'cpp',
    'py': 'py', 'js': 'js', 'jsx': 'jsx', 'ts': 'ts', 'tsx': 'tsx',
    'html': 'html', 'css': 'css',
    'java': 'java', 'rs': 'rs', 'go': 'go',
    'sh': 'sh', 'bat': 'bat', 'xml': 'xml',
    'yaml': 'yaml', 'yml': 'yaml', 'sql': 'sql',
    'r': 'r', 'rb': 'rb', 'php': 'php', 'swift': 'swift', 'kt': 'kt',
    'lua': 'lua', 'ini': 'ini', 'cfg': 'ini', 'toml': 'toml',
    'xmind': 'xmind',
  }
  return mapping[extLower] || extLower
}

// ==== Helpers ====
function exists(table: string, id: string): boolean {
  const db = getDatabase()
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`)
  stmt.bind([id])
  const row = stmt.step()
  stmt.free()
  return row
}

// ===== Peek into a .db file to extract user_profile info =====
ipcMain.handle('import:previewUserFromDb', async (_e, filePath: string) => {
  try {
    const buf = readFileSync(filePath)
    const SqlJs = getSqlJs()
    const tempDb = new SqlJs.Database(buf)

    const stmt = tempDb.prepare("SELECT * FROM user_profile WHERE id = 'default'")
    let profile: { username: string; avatar_path: string; password_hash: string } | null = null
    if (stmt.step()) {
      const row = stmt.getAsObject() as { id: string; username: string; avatar_path: string; password_hash: string; created_at: string; updated_at: string }
      profile = { username: row.username, avatar_path: row.avatar_path, password_hash: row.password_hash }
    }
    stmt.free()

    // Quick stats
    const blogCount = (tempDb.exec('SELECT COUNT(*) as c FROM entries')[0]?.values?.[0]?.[0] as number) || 0
    const scheduleCount = (tempDb.exec('SELECT COUNT(*) as c FROM schedule_todos')[0]?.values?.[0]?.[0] as number) || 0
    const knowledgeCount = (tempDb.exec('SELECT COUNT(*) as c FROM knowledge_pages')[0]?.values?.[0]?.[0] as number) || 0

    tempDb.close()
    return { profile, stats: { blogCount, scheduleCount, knowledgeCount } }
  } catch (e: any) {
    return { error: String(e) }
  }
})

export function registerImportHandlers(): void {
  // ===== 导入文件对话框 =====
  ipcMain.handle('import:showOpenDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文本/代码/PDF/XMind文件', extensions: [...TEXT_EXTS, 'pdf', 'xmind'] },
      ],
      title: '导入文件到知识库'
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('import:readFiles', async (_e, paths: string[]) => {
    return paths.map(p => {
      const ext = extname(p).slice(1).toLowerCase()
      if (ext === 'pdf' || ext === 'xmind') {
        return { path: p, baseName: fileNameBase(p), content: '', fileType: ext, error: `${ext.toUpperCase()} files are imported via import:import${ext.charAt(0).toUpperCase() + ext.slice(1)}File` }
      }
      try {
        const content = readFileSync(p, 'utf-8')
        return { path: p, baseName: fileNameBase(p), content, fileType: extToFileType(ext) }
      } catch (e) {
        return { path: p, baseName: fileNameBase(p), content: '', fileType: '', error: String(e) }
      }
    })
  })

  // ===== PDF import =====
  ipcMain.handle('import:importPdf', async (_e, base64: string, fileName: string) => {
    try {
      const id = randomUUID()
      const pdfFileName = `${id}.pdf`
      const pdfPath = join(getAttachmentsDir(), pdfFileName)
      const buf = Buffer.from(base64, 'base64')
      writeFileSync(pdfPath, buf)

      const now = new Date().toISOString()
      const db = getDatabase()
      const attachmentId = registerAttachment({ ownerType: 'knowledge_page', ownerId: id, fileName, relPath: pdfFileName, mime: 'application/pdf', size: buf.length })
      const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS NULL')
      const sortOrder = (maxOrder.length > 0 && maxOrder[0].values?.[0]?.[0] as number) ?? 0
      db.run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, attachment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, fileName.replace(/\.pdf$/i, ''), pdfFileName, '', null, sortOrder, 'pdf', attachmentId, now, now]
      )
      saveToDisk()

      // Return basic page info
      return { id, title: fileName.replace(/\.pdf$/i, ''), fileType: 'pdf' }
    } catch (e: any) {
      return { error: String(e) }
    }
  })

  // ===== Generic binary import (XMind etc., drag-drop) =====
  ipcMain.handle('import:importBinary', async (_e, base64: string, fileName: string, fileType: string) => {
    try {
      const id = randomUUID()
      const ext = fileType.toLowerCase()
      const storeName = `${id}.${ext}`
      const storePath = join(getAttachmentsDir(), storeName)
      const buf = Buffer.from(base64, 'base64')
      writeFileSync(storePath, buf)

      const now = new Date().toISOString()
      const db = getDatabase()
      const attachmentId = registerAttachment({ ownerType: 'knowledge_page', ownerId: id, fileName, relPath: storeName, mime: mimeFromExt(ext), size: buf.length })
      const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS NULL')
      const sortOrder = (maxOrder.length > 0 && maxOrder[0].values?.[0]?.[0] as number) ?? 0
      db.run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, attachment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, fileName.replace(new RegExp(`\\.${ext}$`, 'i'), ''), storeName, '', null, sortOrder, ext, attachmentId, now, now]
      )
      saveToDisk()
      return { id, title: fileName.replace(new RegExp(`\\.${ext}$`, 'i'), ''), fileType: ext }
    } catch (e: any) {
      return { error: String(e) }
    }
  })

  // ===== PDF import from file path (dialog) =====
  ipcMain.handle('import:importPdfFile', async (_e, filePath: string) => {
    try {
      const id = randomUUID()
      const pdfFileName = `${id}.pdf`
      const pdfPath = join(getAttachmentsDir(), pdfFileName)
      copyFileSync(filePath, pdfPath)

      const now = new Date().toISOString()
      const db = getDatabase()
      const attachmentId = registerAttachment({ ownerType: 'knowledge_page', ownerId: id, fileName: basename(filePath), relPath: pdfFileName, mime: 'application/pdf', size: readFileSync(pdfPath).length })
      const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS NULL')
      const sortOrder = (maxOrder.length > 0 && maxOrder[0].values?.[0]?.[0] as number) ?? 0
      const title = basename(filePath).replace(/\.pdf$/i, '')
      db.run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, attachment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, pdfFileName, '', null, sortOrder, 'pdf', attachmentId, now, now]
      )
      saveToDisk()
      return { id, title, fileType: 'pdf' }
    } catch (e: any) {
      return { error: String(e) }
    }
  })

  // ===== Generic binary file import (XMind etc.) =====
  ipcMain.handle('import:importBinaryFile', async (_e, filePath: string, fileType: string) => {
    try {
      const ext = fileType.toLowerCase()
      const id = randomUUID()
      const storeName = `${id}.${ext}`
      const storePath = join(getAttachmentsDir(), storeName)
      copyFileSync(filePath, storePath)

      const now = new Date().toISOString()
      const db = getDatabase()
      const attachmentId = registerAttachment({ ownerType: 'knowledge_page', ownerId: id, fileName: basename(filePath), relPath: storeName, mime: mimeFromExt(ext), size: readFileSync(storePath).length })
      const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS NULL')
      const sortOrder = (maxOrder.length > 0 && maxOrder[0].values?.[0]?.[0] as number) ?? 0
      const title = basename(filePath).replace(new RegExp(`\\.${ext}$`, 'i'), '')
      db.run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, attachment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, storeName, '', null, sortOrder, ext, attachmentId, now, now]
      )
      saveToDisk()
      return { id, title, fileType: ext }
    } catch (e: any) {
      return { error: String(e) }
    }
  })

  // ===== Folder import =====
  ipcMain.handle('import:showFolderDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择要导入的文件夹'
    })
    return result.canceled ? [] : result.filePaths
  })

  // Recursively import a folder as a category tree
  function importFolderRecursive(folderPath: string, parentCategoryId: string | null): { id: string; name: string; fileCount: number; folderCount: number } | { error: string } {
    const folderName = basename(folderPath)
    const db = getDatabase()
    const now = new Date().toISOString()

    const catId = randomUUID()
    const parentParam = parentCategoryId || null
    const maxOrderRes = db.exec(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_categories WHERE parent_id IS ?',
      [parentParam]
    )
    const so = (maxOrderRes.length > 0 && maxOrderRes[0].values?.[0]?.[0] as number) ?? 0
    db.run(
      'INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, ?, ?, ?)',
      [catId, folderName, parentParam, so, 'folder']
    )

    const entries = readdirSync(folderPath)
    const folders: string[] = []
    const files: string[] = []
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = join(folderPath, entry)
      try {
        const s = statSync(full)
        if (s.isDirectory()) folders.push(entry)
        else files.push(entry)
      } catch { /* skip */ }
    }

    // Process subfolders
    let totalFolders = 0, totalFiles = 0
    for (const f of folders) {
      const skipDirs = ['node_modules', '.git', '__pycache__', '.vscode', '.idea', 'dist', 'build', 'out', '.claude']
      if (skipDirs.includes(f.toLowerCase())) continue
      const subPath = join(folderPath, f)
      const result = importFolderRecursive(subPath, catId)
      if (!('error' in result)) {
        totalFolders += 1 + result.folderCount
        totalFiles += result.fileCount
      }
    }

    // Process files
    let pageOrder = 0
    for (const f of files) {
      const ext = extname(f).slice(1).toLowerCase()
      const filePath = join(folderPath, f)
      const ft = extToFileType(ext)
      const isText = TEXT_EXTS.includes(ext)
      const isBinary = ext === 'pdf' || ext === 'xmind'

      const pageId = randomUUID()
      const title = f.replace(new RegExp(`\\.${ext}$`, 'i'), '')

      if (isBinary) {
        const storeName = `${pageId}.${ext}`
        const storePath = join(getAttachmentsDir(), storeName)
        copyFileSync(filePath, storePath)
        const attachmentId = registerAttachment({ ownerType: 'knowledge_page', ownerId: pageId, fileName: f, relPath: storeName, mime: mimeFromExt(ext), size: statSync(storePath).size })
        db.run(
          `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, attachment_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pageId, title, storeName, '', catId, pageOrder, ext, attachmentId, now, now]
        )
        pageOrder++; totalFiles++
      } else if (isText) {
        try {
          const content = readFileSync(filePath, 'utf-8')
          db.run(
            `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [pageId, title, content, '', catId, pageOrder, ft, now, now]
          )
          pageOrder++; totalFiles++
        } catch { /* skip */ }
      }
    }

    saveToDisk()
    return { id: catId, name: folderName, fileCount: totalFiles, folderCount: totalFolders }
  }

  ipcMain.handle('import:importFolder', async (_e, folderPath: string, parentCategoryId: string | null) => {
    try {
      return importFolderRecursive(folderPath, parentCategoryId)
    } catch (e: any) {
      console.error('[importFolder] failed:', e)
      return { error: String(e) }
    }
  })

  // ===== Data import (JSON + db auto-detect) =====
  ipcMain.handle('import:showDataDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: '支持的文件（备份包 zip / JSON / 数据库）', extensions: ['zip', 'json', 'db'] },
      ],
      title: '导入 Knowbase 数据'
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('import:readFile', async (_e, filePath: string) => {
    try { return readFileSync(filePath, 'utf-8') }
    catch { return null }
  })

  // ===== All-or-nothing db file replacement =====
  ipcMain.handle('import:importDb', async (_e, srcPath: string) => {
    try {
      // 预检:目标必须是可正常打开的合法 SQLite 库,避免用损坏/伪造文件覆盖唯一数据库
      const buffer = readFileSync(srcPath)
      if (!validateDatabaseBuffer(buffer)) {
        return { success: false, message: '所选文件不是有效的 Knowbase 数据库文件' }
      }
      // 替换前备份当前库,失败时还原
      const dbPath = getDbPath()
      const preImportBak = `${dbPath}.pre-import`
      if (existsSync(dbPath)) copyFileSync(dbPath, preImportBak)
      closeDatabase()
      try {
        copyFileSync(srcPath, dbPath)
        await initDatabase()
        return { success: true, message: '数据库已替换，应用数据已全部更新' }
      } catch (e: any) {
        // 替换后的库初始化失败 → 从备份还原原库
        try { if (existsSync(preImportBak)) copyFileSync(preImportBak, dbPath) } catch { /* ignore */ }
        try { await initDatabase() } catch { /* 原库也无法打开(极端情况),损坏文件已留存 */ }
        return { success: false, message: `数据库导入失败: ${e.message}` }
      }
    } catch (e: any) {
      return { success: false, message: `数据库导入失败: ${e.message}` }
    }
  })

  ipcMain.handle('import:executeImport', (_e, data: any) => executeImportData(data))
}

export function executeImportData(data: any): { success: boolean; imported: number; skipped: number; message: string } {
  const db = getDatabase()
  let imported = 0, skipped = 0
  // 事务包裹:任何一条插入失败即整体回滚,避免"半更新"状态被 saveToDisk 固化
  db.run('BEGIN')
  try {
      // --- Blog ---
      if (data.blog) {
        for (const tag of data.blog.tags || []) {
          if (exists('tags', tag.id)) { skipped++; continue }
          db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [tag.id, tag.name, tag.color])
          imported++
        }
        for (const entry of data.blog.entries || []) {
          if (exists('entries', entry.id)) { skipped++; continue }
          db.run(
            `INSERT INTO entries (id, title, content_md, content_html, date, created_at, updated_at, is_pinned, word_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entry.id, entry.title, entry.contentMd, entry.contentHtml, entry.date,
             entry.createdAt, entry.updatedAt, entry.isPinned ? 1 : 0, entry.wordCount]
          )
          for (const tag of entry.tags || []) {
            try { db.run('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [entry.id, tag.id]) } catch { /* skip */ }
          }
          imported++
        }
      }
      // --- Schedule ---
      if (data.schedule) {
        for (const tag of data.schedule.tags || []) {
          if (exists('schedule_tags', tag.id)) { skipped++; continue }
          db.run('INSERT INTO schedule_tags (id, name, color) VALUES (?, ?, ?)', [tag.id, tag.name, tag.color])
          imported++
        }
        for (const todo of data.schedule.todos || []) {
          if (exists('schedule_todos', todo.id)) { skipped++; continue }
          db.run(
            `INSERT INTO schedule_todos (id, title, description, date, time, quadrant, task_type, tag_id, status, sort_order, end_criteria, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [todo.id, todo.title, todo.description, todo.date, todo.time, todo.quadrant,
             todo.taskType, todo.tagId, todo.status, todo.sortOrder, todo.endCriteria,
             todo.createdAt, todo.updatedAt]
          )
          imported++
        }
      }
      // --- Knowledge ---
      if (data.knowledge) {
        for (const tag of data.knowledge.tags || []) {
          if (exists('knowledge_tags', tag.id)) { skipped++; continue }
          db.run('INSERT INTO knowledge_tags (id, name, color) VALUES (?, ?, ?)', [tag.id, tag.name, tag.color])
          imported++
        }
        for (const cat of data.knowledge.categories || []) {
          if (exists('knowledge_categories', cat.id)) { skipped++; continue }
          const ct = cat.categoryType === 'notebook' || cat.categoryType === 'space' ? cat.categoryType : 'folder'
          let parentId = cat.parentId ?? null
          if (parentId === null && ct !== 'space') {
            const space = db.exec(
              `SELECT id FROM knowledge_categories
               WHERE category_type = 'space' AND parent_id IS NULL
               ORDER BY sort_order LIMIT 1`
            )
            parentId = space.length > 0 && space[0].values?.[0]?.[0] ? String(space[0].values[0][0]) : null
          }
          db.run('INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, ?, ?, ?)',
            [cat.id, cat.name, parentId, cat.sortOrder, ct])
          imported++
        }
        for (const page of data.knowledge.pages || []) {
          if (exists('knowledge_pages', page.id)) { skipped++; continue }
          db.run(
            `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, file_type, attachment_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [page.id, page.title, page.contentMd, page.contentHtml, page.categoryId,
             page.isStarred ? 1 : 0, page.sortOrder, page.fileType || '', page.attachmentId || null, page.createdAt, page.updatedAt]
          )
          for (const tag of page.tags || []) {
            try { db.run('INSERT INTO knowledge_page_tags (page_id, tag_id) VALUES (?, ?)', [page.id, tag.id]) } catch { /* skip */ }
          }
          imported++
        }
        // restore backlinks
        for (const page of data.knowledge.pages || []) {
          for (const linkedTitle of page.backlinks || []) {
            const stmt = db.prepare('SELECT id FROM knowledge_pages WHERE title = ? LIMIT 1')
            stmt.bind([linkedTitle])
            if (stmt.step()) {
              const target = stmt.getAsObject() as { id: string }
              try {
                db.run('INSERT OR IGNORE INTO knowledge_links (id, source_page_id, target_page_id) VALUES (?, ?, ?)',
                  [page.id + '|' + target.id, page.id, target.id])
              } catch { /* skip */ }
            }
            stmt.free()
          }
        }
      }
      // --- Password Vault ---
      if (data.passwordVault) {
        for (const entry of data.passwordVault.entries || []) {
          if (exists('toolbox_passwords', entry.id)) { skipped++; continue }
          db.run(
            `INSERT INTO toolbox_passwords (id, title, url, username, account, password, notes, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entry.id, entry.title, entry.url, entry.username, entry.account || '', entry.password, entry.notes, entry.sortOrder, entry.createdAt, entry.updatedAt]
          )
          imported++
        }
      }
      // --- Moments ---
      if (data.moments) {
        for (const album of data.moments.albums || []) {
          if (exists('moments_albums', album.id)) { skipped++; continue }
          db.run(
            'INSERT INTO moments_albums (id, name, cover_data_url, cover_post_id, cover_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [album.id, album.name, '', album.coverPostId || '', album.coverIndex || 0, album.createdAt, album.updatedAt]
          )
          imported++
        }
        for (const post of data.moments.posts || []) {
          if (exists('moments_posts', post.id)) { skipped++; continue }
          const images = Array.isArray(post.imageDataUrls)
            ? post.imageDataUrls
            : (post.imageDataUrl ? [post.imageDataUrl] : [])
          const tags = Array.isArray(post.tags) ? post.tags.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0) : []
          const attachmentIds = Array.isArray(post.attachmentIds) ? post.attachmentIds : []
          db.run(
            `INSERT INTO moments_posts (id, content_md, content_html, images_data_urls, attachment_ids, tags, album_id, is_pinned, show_in_timeline, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [post.id, post.contentMd || '', post.contentHtml || '', JSON.stringify(images), JSON.stringify(attachmentIds), JSON.stringify(tags), post.albumId || '',
             post.isPinned ? 1 : 0, post.showInTimeline === false ? 0 : 1, post.createdAt, post.updatedAt]
          )
          imported++
        }
      }
      // --- Checkin（习惯打卡）---
      if (data.checkin) {
        for (const h of data.checkin.habits || []) {
          if (exists('habits', h.id)) { skipped++; continue }
          const ruleDays = Array.isArray(h.ruleDays) && h.ruleDays.length > 0 ? h.ruleDays : [1, 2, 3, 4, 5]
          db.run(
            `INSERT INTO habits (id, name, color, icon, rule_type, rule_days, weekly_target, sort_order, archived, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [h.id, h.name, h.color || '#3B82F6', h.icon || 'check',
             h.ruleType === 'weekdays' || h.ruleType === 'flexible' ? h.ruleType : 'daily',
             JSON.stringify(ruleDays), Math.min(7, Math.max(1, h.weeklyTarget ?? 3)),
             h.sortOrder ?? Date.now(), h.archived ? 1 : 0,
             h.createdAt || new Date().toISOString(), h.updatedAt || h.createdAt || new Date().toISOString()]
          )
          imported++
        }
        for (const r of data.checkin.records || []) {
          if (exists('habit_records', r.id)) { skipped++; continue }
          try {
            db.run('INSERT INTO habit_records (id, habit_id, date) VALUES (?, ?, ?)', [r.id, r.habitId, r.date])
            imported++
          } catch { skipped++ } // UNIQUE(habit_id, date) 冲突兜底
        }
      }
      // --- Bookmark Nav（网址导航）---
      if (data.bookmarkNav) {
        for (const c of data.bookmarkNav.categories || []) {
          if (exists('bookmark_categories', c.id)) { skipped++; continue }
          db.run(
            'INSERT INTO bookmark_categories (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
            [c.id, c.name, c.color || '#3B82F6', c.sortOrder ?? 0, c.createdAt || new Date().toISOString()]
          )
          imported++
        }
        for (const b of data.bookmarkNav.bookmarks || []) {
          if (exists('bookmarks', b.id)) { skipped++; continue }
          db.run(
            'INSERT INTO bookmarks (id, category_id, title, url, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [b.id, b.categoryId || '', b.title, b.url, b.description || '', b.sortOrder ?? 0, b.createdAt || new Date().toISOString()]
          )
          imported++
        }
      }
      // --- Toolbox (scripts + weight records) ---
      if (data.toolbox) {
        for (const script of data.toolbox.scripts || []) {
          if (exists('toolbox_scripts', script.id)) { skipped++; continue }
          db.run(
            `INSERT INTO toolbox_scripts (id, name, description, content, language, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [script.id, script.name, script.description || '', script.content || '', script.language || 'plaintext', script.sortOrder || 0, script.createdAt, script.updatedAt]
          )
          imported++
        }
        for (const rec of data.toolbox.weightRecords || []) {
          if (exists('toolbox_weight_records', rec.id)) { skipped++; continue }
          db.run(
            `INSERT INTO toolbox_weight_records (id, weight, date, series, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [rec.id, rec.weight, rec.date, rec.series || 'default', rec.note || '', rec.createdAt]
          )
          imported++
        }
      }
      // --- Recycle bin ---
      if (data.recycleBin) {
        for (const item of data.recycleBin.items || []) {
          if (exists('recycle_bin', item.id)) { skipped++; continue }
          db.run(
            `INSERT INTO recycle_bin (id, original_id, module, title, data, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [item.id, item.originalId, item.module, item.title, item.data || '', item.deletedAt || new Date().toISOString()]
          )
          imported++
        }
      }
      // --- 知识内容包导入映射(保持「检查更新」幂等,不计入 imported 计数) ---
      if (Array.isArray(data.knowledgePackImports)) {
        for (const m of data.knowledgePackImports) {
          if (!m || typeof m.plugin_id !== 'string' || typeof m.external_id !== 'string') continue
          try {
            db.run(
              `INSERT OR REPLACE INTO knowledge_pack_imports (plugin_id, external_id, page_id, content_hash, pack_version, space_id, imported_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [m.plugin_id, m.external_id, m.page_id, m.content_hash || '', m.pack_version || '', m.space_id || null, m.imported_at || new Date().toISOString()]
            )
          } catch { /* 跳过非法条目 */ }
        }
      }
      db.run('COMMIT')
      // 导入的密码为明文 JSON,统一走一次加密(幂等)再落盘
      encryptExistingPasswords()
      saveToDisk()
      return { success: true, imported, skipped, message: `成功导入 ${imported} 条记录${skipped > 0 ? `，跳过 ${skipped} 条已有记录` : ''}` }
  } catch (e: any) {
    try { db.run('ROLLBACK') } catch { /* ignore */ }
    return { success: false, imported: 0, skipped: 0, message: `导入出错(已回滚，数据未变更): ${e.message}` }
  }
}
