import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { vaultBlogTags, vaultRemoveTagFromAll } from '../../lib/kbStore/blogVaultRepo'

interface TagRow {
  id: string
  name: string
  color: string
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

export function registerTagHandlers(getSettingValue?: (key: string) => unknown): void {
  // 去库化 P1：博客 tag 随读源走仓库。vault 约定 tag.id = name（同名即同 tag）
  const isVault = (): boolean => getSettingValue?.('storageBlog') === 'vault'

  // 获取所有标签
  ipcMain.handle('db:getTags', () => {
    if (isVault()) return vaultBlogTags()
    return queryAll<TagRow>('SELECT * FROM tags ORDER BY name')
  })

  // 创建标签
  ipcMain.handle('db:createTag', (_event, name: string, color?: string) => {
    if (isVault()) {
      const n = name.trim()
      const existing = vaultBlogTags().find((t) => t.name === n)
      return existing ?? { id: n, name: n, color: color || '#6b7280' }
    }
    const db = getDatabase()
    const existing = queryAll<TagRow>('SELECT * FROM tags WHERE name = ?', [name])
    if (existing.length > 0) return existing[0]

    const id = randomUUID()
    db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, name.trim(), color || '#6b7280'])
    saveToDisk()

    return { id, name: name.trim(), color: color || '#6b7280' }
  })

  // 删除标签
  ipcMain.handle('db:deleteTag', (_event, id: string) => {
    if (isVault()) {
      // vault 下 id = tag 名：从全部博文 frontmatter 移除该 tag
      vaultRemoveTagFromAll(id)
      return
    }
    const db = getDatabase()
    db.run('DELETE FROM tags WHERE id = ?', [id])
    saveToDisk()
  })
}
