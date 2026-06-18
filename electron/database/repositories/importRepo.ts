import { ipcMain, BrowserWindow, dialog } from 'electron'
import { readFileSync, writeFileSync, unlinkSync, existsSync, copyFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { getDatabase, saveToDisk, closeDatabase, initDatabase, getDbPath, getAttachmentsDir, getSqlJs } from '../connection'
import { randomUUID } from 'crypto'

const TEXT_EXTS = ['md', 'txt', 'json', 'cpp', 'c', 'h', 'hpp', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'java', 'rs', 'go', 'sh', 'bat', 'xml', 'yaml', 'yml', 'sql', 'r', 'rb', 'php', 'swift', 'kt', 'lua', 'ini', 'cfg', 'toml']

function fileNameBase(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase()
  return basename(filePath).replace(new RegExp(`\\.${ext}$`, 'i'), '')
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
        { name: '文本/代码/PDF文件', extensions: [...TEXT_EXTS, 'pdf'] },
      ],
      title: '导入文件到知识库'
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('import:readFiles', async (_e, paths: string[]) => {
    return paths.map(p => {
      const ext = extname(p).slice(1).toLowerCase()
      if (ext === 'pdf') {
        return { path: p, baseName: fileNameBase(p), content: '', fileType: 'pdf', error: 'PDF files are imported via import:importPdf' }
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
      const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS NULL')
      const sortOrder = (maxOrder.length > 0 && maxOrder[0].values?.[0]?.[0] as number) ?? 0
      db.run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, fileName.replace(/\.pdf$/i, ''), pdfFileName, '', null, sortOrder, 'pdf', now, now]
      )
      saveToDisk()

      const rows = db.exec('SELECT * FROM knowledge_pages WHERE id = ?')
      // Return basic page info
      return { id, title: fileName.replace(/\.pdf$/i, ''), fileType: 'pdf' }
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
      const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM knowledge_pages WHERE category_id IS NULL')
      const sortOrder = (maxOrder.length > 0 && maxOrder[0].values?.[0]?.[0] as number) ?? 0
      const title = basename(filePath).replace(/\.pdf$/i, '')
      db.run(
        `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, sort_order, file_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, pdfFileName, '', null, sortOrder, 'pdf', now, now]
      )
      saveToDisk()
      return { id, title, fileType: 'pdf' }
    } catch (e: any) {
      return { error: String(e) }
    }
  })

  // ===== Data import (JSON + db auto-detect) =====
  ipcMain.handle('import:showDataDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: '支持的数据文件 (.json, .db)', extensions: ['json', 'db'] },
      ],
      title: '导入 Knowbase 数据包'
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
      closeDatabase()
      copyFileSync(srcPath, getDbPath())
      await initDatabase()
      return { success: true, message: '数据库已替换，应用数据已全部更新' }
    } catch (e: any) {
      // Try to reopen original database on failure
      try { await initDatabase() } catch { /* db was already closed */ }
      return { success: false, message: `数据库导入失败: ${e.message}` }
    }
  })

  ipcMain.handle('import:executeImport', async (_e, data: any) => {
    const db = getDatabase()
    let imported = 0, skipped = 0
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
          const ct = cat.categoryType === 'notebook' ? 'notebook' : 'folder'
          db.run('INSERT INTO knowledge_categories (id, name, parent_id, sort_order, category_type) VALUES (?, ?, ?, ?, ?)',
            [cat.id, cat.name, cat.parentId, cat.sortOrder, ct])
          imported++
        }
        for (const page of data.knowledge.pages || []) {
          if (exists('knowledge_pages', page.id)) { skipped++; continue }
          db.run(
            `INSERT INTO knowledge_pages (id, title, content_md, content_html, category_id, is_starred, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [page.id, page.title, page.contentMd, page.contentHtml, page.categoryId,
             page.isStarred ? 1 : 0, page.sortOrder, page.createdAt, page.updatedAt]
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
      saveToDisk()
      return { success: true, imported, skipped, message: `成功导入 ${imported} 条记录${skipped > 0 ? `，跳过 ${skipped} 条已有记录` : ''}` }
    } catch (e: any) {
      return { success: false, imported, skipped, message: `导入出错: ${e.message}` }
    }
  })
}
