import { ipcMain, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, statSync } from 'fs'
import { getAttachmentsDir, getDatabase, saveToDisk } from '../connection'
import { buildAllData } from './exportRepo'
import { executeImportData } from './importRepo'
import { zipBuffer, unzipBuffer, ZipEntry } from '../../lib/zip'

interface AttachmentRow {
  id: string
  owner_type: string
  owner_id: string
  position: number
  file_name: string
  file_path: string
  thumb_path: string
  mime_type: string
  size_bytes: number
  trashed: number
  trash_path: string
  created_at: string
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function collectAttachments(): AttachmentRow[] {
  return queryAll<AttachmentRow>('SELECT * FROM attachments WHERE trashed = 0')
}

function copyAttachmentFiles(rows: AttachmentRow[], srcDir: string, destDir: string): void {
  for (const r of rows) {
    for (const rel of [r.file_path, r.thumb_path]) {
      if (!rel) continue
      const src = join(srcDir, rel)
      if (!existsSync(src)) continue
      const dest = join(destDir, 'attachments', rel)
      mkdirSync(join(dest, '..'), { recursive: true })
      copyFileSync(src, dest)
    }
  }
}

export function registerBackupHandlers(): void {
  // 目录包：export.json + attachments/
  ipcMain.handle('export:backupToDir', (_e, dirPath: string) => {
    const data: Record<string, unknown> = buildAllData() as unknown as Record<string, unknown>
    const rows = collectAttachments()
    data._attachments = rows
    mkdirSync(join(dirPath, 'attachments'), { recursive: true })
    writeFileSync(join(dirPath, 'export.json'), JSON.stringify(data, null, 2))
    copyAttachmentFiles(rows, getAttachmentsDir(), dirPath)
    let totalSize = statSync(join(dirPath, 'export.json')).size
    for (const r of rows) {
      for (const rel of [r.file_path, r.thumb_path]) {
        if (!rel) continue
        const f = join(dirPath, 'attachments', rel)
        if (existsSync(f)) totalSize += statSync(f).size
      }
    }
    return { dirPath, fileCount: rows.length + 1, totalSize }
  })

  // 单文件 zip：export.json + attachments/ 压缩为一个包
  ipcMain.handle('export:backupToZip', (_e, zipPath: string) => {
    const data: Record<string, unknown> = buildAllData() as unknown as Record<string, unknown>
    const rows = collectAttachments()
    data._attachments = rows
    const entries: ZipEntry[] = [{ path: 'export.json', data: Buffer.from(JSON.stringify(data, null, 2), 'utf-8') }]
    let totalSize = entries[0].data.length
    for (const r of rows) {
      for (const rel of [r.file_path, r.thumb_path]) {
        if (!rel) continue
        const src = join(getAttachmentsDir(), rel)
        if (!existsSync(src)) continue
        const buf = readFileSync(src)
        entries.push({ path: `attachments/${rel.replace(/\\/g, '/')}`, data: buf })
        totalSize += buf.length
      }
    }
    writeFileSync(zipPath, zipBuffer(entries))
    return { filePath: zipPath, fileCount: entries.length, totalSize }
  })

  // 导入备份包（文件夹或 .zip）
  ipcMain.handle('import:importBackupPackage', (_e, srcPath: string) => {
    const isDir = existsSync(srcPath) && statSync(srcPath).isDirectory()
    let files: Map<string, Buffer> | null = null
    let jsonBuf: Buffer
    if (isDir) {
      jsonBuf = readFileSync(join(srcPath, 'export.json'))
    } else {
      files = unzipBuffer(readFileSync(srcPath))
      const j = files.get('export.json')
      if (!j) throw new Error('备份包中缺少 export.json')
      jsonBuf = j
    }
    const data = JSON.parse(jsonBuf.toString('utf-8')) as Record<string, unknown>
    const readAtt = (rel: string): Buffer | null => {
      if (isDir) {
        const p = join(srcPath, 'attachments', rel)
        return existsSync(p) ? readFileSync(p) : null
      }
      return files?.get(`attachments/${rel.replace(/\\/g, '/')}`) || null
    }

    // 恢复附件文件与记录（幂等）
    const db = getDatabase()
    let attRestored = 0
    for (const att of (data._attachments || []) as AttachmentRow[]) {
      const buf = readAtt(att.file_path)
      if (buf) {
        const dest = join(getAttachmentsDir(), att.file_path)
        mkdirSync(join(dest, '..'), { recursive: true })
        writeFileSync(dest, buf)
      }
      if (att.thumb_path) {
        const tb = readAtt(att.thumb_path)
        if (tb) {
          const tdest = join(getAttachmentsDir(), att.thumb_path)
          mkdirSync(join(tdest, '..'), { recursive: true })
          writeFileSync(tdest, tb)
        }
      }
      const existing = db.exec('SELECT id FROM attachments WHERE id = ?', [att.id])
      if (existing.length === 0 || !existing[0].values || existing[0].values.length === 0) {
        db.run(
          `INSERT INTO attachments (id, owner_type, owner_id, position, file_name, file_path, thumb_path, mime_type, size_bytes, trashed, trash_path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)`,
          [att.id, att.owner_type, att.owner_id, att.position, att.file_name, att.file_path, att.thumb_path || '', att.mime_type || '', att.size_bytes || 0, att.created_at || new Date().toISOString()]
        )
        attRestored++
      }
    }

    // 业务数据合并导入
    const result = executeImportData(data)
    saveToDisk()
    return {
      success: result.success,
      imported: result.imported,
      skipped: result.skipped,
      attachments: attRestored,
      message: result.success ? `成功导入 ${result.imported} 条记录、${attRestored} 个附件${result.skipped > 0 ? `，跳过 ${result.skipped} 条已有记录` : ''}` : result.message,
    }
  })

  ipcMain.handle('import:showBackupDialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: '选择备份包（备份文件夹或 .zip）',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: '备份包', extensions: ['zip'] }],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
}
