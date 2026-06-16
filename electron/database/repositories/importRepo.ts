import { ipcMain, BrowserWindow, dialog } from 'electron'
import { readFileSync, copyFileSync } from 'fs'
import { basename, extname } from 'path'
import { getDatabase, saveToDisk, closeDatabase, initDatabase, getDbPath } from '../connection'

function fileNameBase(filePath: string): string {
  return basename(filePath).replace(/\.(md|txt|json)$/i, '')
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

export function registerImportHandlers(): void {
  // ===== .md/.txt existing =====
  ipcMain.handle('import:showOpenDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '支持的文件 (.md, .txt)', extensions: ['md', 'txt'] }],
      title: '导入文件到知识库'
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('import:readFiles', async (_e, paths: string[]) => {
    return paths.map(p => {
      try {
        const content = readFileSync(p, 'utf-8')
        return { path: p, baseName: fileNameBase(p), content }
      } catch (e) {
        return { path: p, baseName: fileNameBase(p), content: '', error: String(e) }
      }
    })
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
      title: '导入 KnowledgeRecorder 数据包'
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
