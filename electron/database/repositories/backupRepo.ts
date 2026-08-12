import { ipcMain } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs'
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

const MODULE_OWNER_TYPES: Record<string, string[]> = {
  knowledge: ['knowledge_page'],
  moments: ['moments_post'],
}

function collectAttachments(moduleIds?: string[]): AttachmentRow[] {
  if (!moduleIds || moduleIds.length === 0) {
    return queryAll<AttachmentRow>('SELECT * FROM attachments WHERE trashed = 0')
  }
  const ownerTypes = new Set<string>(['user_profile'])
  for (const m of moduleIds) {
    for (const t of MODULE_OWNER_TYPES[m] || []) ownerTypes.add(t)
  }
  if (ownerTypes.size === 0) return []
  const placeholders = [...ownerTypes].map(() => '?').join(',')
  return queryAll<AttachmentRow>(
    `SELECT * FROM attachments WHERE trashed = 0 AND owner_type IN (${placeholders})`,
    [...ownerTypes]
  )
}

export function registerBackupHandlers(): void {
  // 单文件 zip：export.json + attachments/ 压缩为一个包
  ipcMain.handle('export:backupToZip', (_e, zipPath: string, moduleIds?: string[]) => {
    const data: Record<string, unknown> = buildAllData(moduleIds) as unknown as Record<string, unknown>
    const rows = collectAttachments(moduleIds)
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
    let zipPrefix = ''
    let jsonBuf: Buffer
    if (isDir) {
      jsonBuf = readFileSync(join(srcPath, 'export.json'))
    } else {
      files = unzipBuffer(readFileSync(srcPath))
      // 兼容带顶层目录的压缩包（例如用系统压缩工具打包的导出文件夹）
      let exportEntry: string | null = files.has('export.json') ? 'export.json' : null
      if (!exportEntry) {
        for (const p of files.keys()) {
          if (p.endsWith('/export.json') || p.endsWith('\\export.json')) {
            exportEntry = p
            break
          }
        }
      }
      if (!exportEntry) throw new Error('备份包中缺少 export.json，请选择本应用导出的备份包（zip），或解压后选择包含 export.json 的文件夹')
      jsonBuf = files.get(exportEntry)!
      zipPrefix = exportEntry.slice(0, -'export.json'.length).replace(/\\/g, '/')
    }
    const data = JSON.parse(jsonBuf.toString('utf-8')) as Record<string, unknown>
    const readAtt = (rel: string): Buffer | null => {
      if (isDir) {
        const p = join(srcPath, 'attachments', rel)
        return existsSync(p) ? readFileSync(p) : null
      }
      return files?.get(`${zipPrefix}attachments/${rel.replace(/\\/g, '/')}`) || null
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

    // 恢复用户资料（用户名 / 锁屏密码 / 头像路径）
    const u = data.user as { username?: string; avatarPath?: string; passwordHash?: string } | null | undefined
    if (u && (u.username !== undefined || u.avatarPath !== undefined || u.passwordHash !== undefined)) {
      db.run(
        `UPDATE user_profile SET username = ?, password_hash = ?, avatar_path = ?, updated_at = ? WHERE id = 'default'`,
        [u.username ?? '', u.passwordHash ?? '', u.avatarPath ?? '', new Date().toISOString()]
      )
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

}
