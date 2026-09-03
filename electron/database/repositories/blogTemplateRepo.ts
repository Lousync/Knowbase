import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { readJson, writeJson } from '../../lib/kbStore/jsonStore'

/**
 * 博客模板 —— 用户自编辑的日记模板，写博客时可一键套用。
 * 去库化 P1：storageBlog=vault 时模板存 .knowbase/blog/templates.json。
 */

interface TemplateRow {
  id: string; name: string; content_md: string
  sort_order: number; created_at: string; updated_at: string
}

export interface BlogTemplateDto {
  id: string
  name: string
  contentMd: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

function rowToDto(r: TemplateRow): BlogTemplateDto {
  return {
    id: r.id,
    name: r.name,
    contentMd: r.content_md,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
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

// ===== vault 实现（.knowbase/blog/templates.json）=====
type Tpl = Omit<BlogTemplateDto, 'createdAt'> & { createdAt?: string }

function vaultRead(): BlogTemplateDto[] {
  const arr = readJson<Tpl[]>('blog', 'templates.json', [])
  const now = new Date().toISOString()
  return arr.map((t) => ({ ...t, createdAt: t.createdAt || now }))
}

function vaultWrite(list: BlogTemplateDto[]): void {
  writeJson('blog', 'templates.json', list)
}

export function registerBlogTemplateHandlers(getSettingValue?: (key: string) => unknown): void {
  const isVault = (): boolean => getSettingValue?.('storageBlog') === 'vault'

  ipcMain.handle('blogTpl:list', () => {
    if (isVault()) return vaultRead().sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt))
    return queryAll<TemplateRow>('SELECT * FROM blog_templates ORDER BY sort_order, updated_at DESC').map(rowToDto)
  })

  ipcMain.handle('blogTpl:create', (_e, data: { name: string; contentMd?: string }) => {
    const name = (data.name || '').trim()
    if (!name) return null
    if (isVault()) {
      const list = vaultRead()
      const now = new Date().toISOString()
      const tpl: BlogTemplateDto = {
        id: randomUUID(), name, contentMd: data.contentMd || '', sortOrder: list.length, createdAt: now, updatedAt: now,
      }
      vaultWrite([...list, tpl])
      return tpl
    }
    const id = randomUUID()
    getDatabase().run(
      'INSERT INTO blog_templates (id, name, content_md) VALUES (?, ?, ?)',
      [id, name, data.contentMd || '']
    )
    saveToDisk()
    return rowToDto(queryAll<TemplateRow>('SELECT * FROM blog_templates WHERE id = ?', [id])[0])
  })

  ipcMain.handle('blogTpl:update', (_e, id: string, data: { name?: string; contentMd?: string }) => {
    if (isVault()) {
      const list = vaultRead()
      const idx = list.findIndex((t) => t.id === id)
      if (idx < 0) return null
      const cur = list[idx]
      const next = {
        ...cur,
        name: data.name !== undefined && data.name.trim() ? data.name.trim() : cur.name,
        contentMd: data.contentMd !== undefined ? data.contentMd : cur.contentMd,
        updatedAt: new Date().toISOString(),
      }
      vaultWrite(list.map((t, i) => (i === idx ? next : t)))
      return next
    }
    const sets: string[] = ["updated_at = datetime('now', 'localtime')"]
    const params: unknown[] = []
    if (data.name !== undefined && data.name.trim()) { sets.push('name = ?'); params.push(data.name.trim()) }
    if (data.contentMd !== undefined) { sets.push('content_md = ?'); params.push(data.contentMd) }
    params.push(id)
    getDatabase().run(`UPDATE blog_templates SET ${sets.join(', ')} WHERE id = ?`, params)
    saveToDisk()
    const rows = queryAll<TemplateRow>('SELECT * FROM blog_templates WHERE id = ?', [id])
    return rows.length > 0 ? rowToDto(rows[0]) : null
  })

  ipcMain.handle('blogTpl:delete', (_e, id: string) => {
    if (isVault()) {
      vaultWrite(vaultRead().filter((t) => t.id !== id))
      return
    }
    getDatabase().run('DELETE FROM blog_templates WHERE id = ?', [id])
    saveToDisk()
  })
}
