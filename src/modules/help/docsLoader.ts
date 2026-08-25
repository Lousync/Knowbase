/** Help doc format: Markdown files in docs/ with YAML frontmatter.
 *
 *  ---
 *  title: 键盘快捷键
 *  category: 操作指南
 *  icon: Keyboard
 *  ---
 *  # 键盘快捷键
 *  ...
 *
 *  To add a new doc: drop a .md file in docs/ with frontmatter above. That's it.
 */

export interface HelpDoc {
  id: string
  category: string
  title: string
  icon: string          // lucide icon name, e.g. "Keyboard"
  md: string            // raw markdown body
}

/** Parse YAML frontmatter from a markdown string */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  // 统一 CRLF → LF：kv 正则的 (.+)$ 吃不到行尾 \r，会导致所有字段解析失败
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

/** Load all help .md files via Vite glob import */
export async function loadHelpDocs(): Promise<HelpDoc[]> {
  // Vite glob: returns Record<string, () => Promise<{ default: string }>> for ?raw imports
  const modules = import.meta.glob('./docs/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

  const docs: HelpDoc[] = []

  for (const [path, loader] of Object.entries(modules)) {
    const raw = await loader()
    const parsed = parseFrontmatter(raw)
    if (!parsed) continue

    const id = path.replace(/^.*[\\/]/, '').replace(/\.md$/, '')
    docs.push({
      id,
      category: parsed.meta.category || '未分类',
      title: parsed.meta.title || id,
      icon: parsed.meta.icon || 'FileText',
      md: parsed.body,
    })
  }

  // 插件贡献的帮助文档(虚拟合并,失败静默)
  try {
    const { getPluginHelpDocs } = await import('../../lib/pluginService')
    const pluginDocs = await getPluginHelpDocs()
    for (const d of pluginDocs) {
      docs.push({ id: d.id, category: d.category, title: d.title, icon: d.icon, md: d.md })
    }
  } catch { /* 插件文档加载失败不影响内置文档 */ }

  // Sort by category then title
  docs.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
  return docs
}
