import { app, ipcMain } from 'electron'
import { join, resolve, sep } from 'path'
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'fs'
import { execFileSync } from 'child_process'

/**
 * 开发者工具 IPC(仅 DEV 可用)。
 *
 * 安全边界:打包版不注册任何 handler(app.isPackaged 守卫),channel 无接收方;
 * 渲染层入口另由 import.meta.env.DEV 条件渲染,正式版 bundle 中该模块被静态消除。
 * 文件操作严格限定在源码 docs 目录内,文件名经白名单净化,禁止路径穿越。
 */

const DOCS_REL = join('src', 'modules', 'help', 'docs')

function docsDir(): string {
  return join(app.getAppPath(), DOCS_REL)
}

interface HelpDocMeta {
  fileName: string
  title: string
  category: string
  icon: string
}

/** 与 docsLoader.ts 同源的 frontmatter 解析(主进程侧独立一份,避免跨进程引用渲染层代码) */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const text = raw.replace(/\r\n/g, '\n')
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!m) return null
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w ]*?)\s*:\s*(.+)$/)
    if (kv) meta[kv[1].trim()] = kv[2].trim()
  }
  return { meta, body: m[2] }
}

/** 文件名白名单:中英文、数字、连字符、下划线;去空白与非法字符,补 .md 后缀 */
function sanitizeFileName(input: string): string | null {
  const cleaned = input.replace(/\.md$/i, '').replace(/[\\/:*?"<>|\s]+/g, '')
  if (!cleaned) return null
  return `${cleaned}.md`
}

/** 只允许解析出 docs 目录内的合法路径,其余一律拒绝 */
function safeResolve(fileName: string): string | null {
  const clean = sanitizeFileName(fileName)
  if (!clean) return null
  const full = resolve(docsDir(), clean)
  const root = resolve(docsDir())
  if (!full.startsWith(root + sep)) return null
  return full
}

/** 文档在 git 里是否有未提交改动(未跟踪也算);git 不可用时静默返回空集 */
function gitDirtyFiles(): Set<string> {
  const dirty = new Set<string>()
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', DOCS_REL], {
      cwd: app.getAppPath(),
      encoding: 'utf-8',
    })
    for (const line of out.split('\n')) {
      const path = line.slice(3).trim()
      if (path) dirty.add(path.replace(/^.*[\\/]/, ''))
    }
  } catch { /* 非 git 仓库或 git 不可用 */ }
  return dirty
}

function readDocFile(fileName: string): HelpDocMeta & { body: string } | null {
  const full = safeResolve(fileName)
  if (!full || !existsSync(full)) return null
  const parsed = parseFrontmatter(readFileSync(full, 'utf-8'))
  if (!parsed) return null
  return {
    fileName: fileName,
    title: parsed.meta.title || '',
    category: parsed.meta.category || '',
    icon: parsed.meta.icon || 'FileText',
    body: parsed.body,
  }
}

export function registerDevtoolsHandlers(): void {
  if (app.isPackaged) return

  ipcMain.handle('devtools:helpDocs:list', () => {
    const dir = docsDir()
    const docs: HelpDocMeta[] = []
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.toLowerCase().endsWith('.md')) continue
        const doc = readDocFile(f)
        if (doc) docs.push(doc)
      }
    }
    docs.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
    return { docs, dirty: [...gitDirtyFiles()] }
  })

  ipcMain.handle('devtools:helpDocs:read', (_e, fileName: string) => {
    const full = safeResolve(String(fileName || ''))
    if (!full) return { error: '非法文件名' }
    const doc = readDocFile(String(fileName))
    if (!doc) return { error: '文档不存在或格式错误(缺少 frontmatter)' }
    return { ...doc, dirty: gitDirtyFiles().has(String(fileName).replace(/^.*[\\/]/, '')) }
  })

  ipcMain.handle('devtools:helpDocs:write', (_e, draft: { fileName: string; title: string; category: string; icon: string; body: string }) => {
    const title = String(draft?.title || '').replace(/[\r\n:]+/g, ' ').trim()
    const category = String(draft?.category || '').replace(/[\r\n:]+/g, ' ').trim()
    const icon = String(draft?.icon || '').replace(/[\r\n:]+/g, ' ').trim() || 'FileText'
    const body = String(draft?.body ?? '')
    if (!title || !category) return { error: 'title 与 category 不能为空' }

    const clean = sanitizeFileName(String(draft?.fileName || title))
    const full = clean && safeResolve(clean)
    if (!clean || !full) return { error: '文件名非法(仅允许中英文、数字、连字符、下划线)' }

    const content = `---\ntitle: ${title}\ncategory: ${category}\nicon: ${icon}\n---\n${body.startsWith('\n') ? body : '\n' + body}`
    try {
      writeFileSync(full, content, 'utf-8')
    } catch (err) {
      return { error: `写入失败: ${err instanceof Error ? err.message : String(err)}` }
    }
    return { ok: true, fileName: clean }
  })

  ipcMain.handle('devtools:helpDocs:delete', (_e, fileName: string) => {
    const full = safeResolve(String(fileName || ''))
    if (!full || !existsSync(full)) return { error: '文档不存在' }
    try {
      unlinkSync(full)
    } catch (err) {
      return { error: `删除失败: ${err instanceof Error ? err.message : String(err)}` }
    }
    return { ok: true }
  })
}
