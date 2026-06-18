import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function getTrashExportDir(): string {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  let configured = ''
  try {
    if (existsSync(settingsPath)) {
      const s = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      configured = s.trashExportDir || ''
    }
  } catch { /* ignore malformed settings */ }

  if (configured && existsSync(configured)) return configured

  const fallback = join(app.getPath('documents'), 'Knowbase', '回收站')
  mkdirSync(fallback, { recursive: true })
  return fallback
}

async function getTrash() {
  return (await import('trash')).default
}

// ---- helpers ----
function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '_').replace(/\.+$/, '').trim() || '未命名'
}

function uniqueDir(baseDir: string, name: string): string {
  let candidate = join(baseDir, safeName(name))
  let n = 1
  while (existsSync(candidate)) {
    candidate = join(baseDir, `${safeName(name)} (${n})`)
    n++
  }
  return candidate
}

// ---- write file with YAML frontmatter ----
function writeMarkdownFile(dir: string, entry: any): string[] {
  const files: string[] = []
  const fileName = safeName(entry.title || '未命名') + '.md'
  let n = 1
  let filePath = join(dir, fileName)
  while (existsSync(filePath)) {
    filePath = join(dir, `${safeName(entry.title || '未命名')} (${n}).md`)
    n++
  }

  let frontmatter = ''
  if (entry.tags && entry.tags.length > 0) {
    frontmatter = '---\n'
    frontmatter += `title: "${entry.title}"\n`
    frontmatter += `date: ${entry.date || entry.createdAt || ''}\n`
    frontmatter += 'tags:\n'
    for (const t of entry.tags) {
      frontmatter += `  - ${t.name}\n`
    }
    frontmatter += '---\n\n'
  }

  const content = frontmatter + (entry.contentMd || '')
  writeFileSync(filePath, content, 'utf-8')
  files.push(filePath)
  return files
}

// ---- recursively write a category tree snapshot ----
function writeCategoryTree(dir: string, data: any): string[] {
  const files: string[] = []
  mkdirSync(dir, { recursive: true })

  // Write direct pages
  for (const page of (data.pages || [])) {
    files.push(...writeMarkdownFile(dir, page))
  }

  // Write children (sub-categories + their pages)
  for (const child of (data.children || [])) {
    const childDir = uniqueDir(dir, child.category?.name || '子目录')
    writeCategoryTree(childDir, child)
  }

  return files
}

// ---- main export: write snapshot, then trash to OS recycle bin ----
export async function trashItem(binId: string, item: { module: string; title: string; data: any }): Promise<string[]> {
  const rootDir = uniqueDir(getTrashExportDir(), `knowbase-trash-${Date.now()}`)
  mkdirSync(rootDir, { recursive: true })

  try {
    const files: string[] = []

    if (item.module === 'blog' || item.module === 'knowledge') {
      // Single page / blog entry → write directly
      const data = item.data
      files.push(...writeMarkdownFile(rootDir, data))
    } else if (item.module === 'knowledge_category') {
      // Category tree → label with category name, write structure
      const catName = item.data?.category?.name || item.title || '知识目录'
      const catDir = uniqueDir(rootDir, catName)
      mkdirSync(catDir, { recursive: true })
      writeCategoryTree(catDir, item.data)
    }

    // Move to OS recycle bin
    await (await getTrash())([rootDir])

    return []
  } catch (e) {
    // If trash fails, files remain in temp
    throw e
  }
}

export async function trashAll(items: Array<{ binId: string; module: string; title: string; data: any }>): Promise<void> {
  const rootDir = uniqueDir(getTrashExportDir(), `knowbase-trash-${Date.now()}`)
  mkdirSync(rootDir, { recursive: true })

  for (const item of items) {
    try {
      if (item.module === 'blog' || item.module === 'knowledge') {
        writeMarkdownFile(rootDir, item.data)
      } else if (item.module === 'knowledge_category') {
        const catName = item.data?.category?.name || item.title || '知识目录'
        const catDir = uniqueDir(rootDir, catName)
        mkdirSync(catDir, { recursive: true })
        writeCategoryTree(catDir, item.data)
      }
    } catch (e) {
      console.error(`Failed to export item ${item.binId}:`, e)
    }
  }

  // Move entire temp dir to OS recycle bin
  await (await getTrash())([rootDir])
}
