/**
 * Help doc format: Markdown files in `<项目根>/resources/help/` with YAML frontmatter.
 *
 *  ---
 *  title: 键盘快捷键
 *  category: 操作指南
 *  icon: Keyboard
 *  weight: 30          # 可选：排序权重（缺省 100，越小越靠前；《快速上手》= 0）
 *  keywords: [快捷键, 热键]   # 可选：给 AI 检索用的口语别名，渲染层不消费
 *  ---
 *  # 键盘快捷键
 *  ...
 *
 *  To add a new doc: drop a .md file there with the frontmatter above. That's it.
 *  ⚠️ 文件必须是 LF 换行（CRLF 会让 frontmatter 解析全灭）。
 */

export interface HelpDoc {
  id: string
  category: string
  title: string
  icon: string          // lucide icon name, e.g. "Keyboard"
  md: string            // raw markdown body
  /** 排序权重（frontmatter.weight，缺省 100） */
  weight: number
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
  // 文档源在项目根的 resources/help/（不在 src 下）——渲染层与主进程读同一份，
  // 避免"人看的"和"喂 AI 的"两套文档漂移（见 docs/ai-learn-center-design.md §7.3）。
  // 以 `/` 开头 = 相对 Vite 项目根，比多级 ../ 更稳。
  const modules = import.meta.glob('/resources/help/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

  const docs: HelpDoc[] = []

  for (const [path, loader] of Object.entries(modules)) {
    const raw = await loader()
    const parsed = parseFrontmatter(raw)
    if (!parsed) continue

    const id = path.replace(/^.*[\\/]/, '').replace(/\.md$/, '')
    const w = Number(parsed.meta.weight)
    docs.push({
      id,
      category: parsed.meta.category || '未分类',
      title: parsed.meta.title || id,
      icon: parsed.meta.icon || 'FileText',
      md: parsed.body,
      weight: Number.isFinite(w) ? w : 100,
    })
  }

  // 插件贡献的帮助文档(虚拟合并,失败静默)
  try {
    const { getPluginHelpDocs } = await import('../../lib/pluginService')
    const pluginDocs = await getPluginHelpDocs()
    for (const d of pluginDocs) {
      docs.push({ id: d.id, category: d.category, title: d.title, icon: d.icon, md: d.md, weight: 100 })
    }
  } catch { /* 插件文档加载失败不影响内置文档 */ }

  // 排序：weight 优先（《快速上手》=0 自然置顶），再按分类与标题
  docs.sort((a, b) => a.weight - b.weight || a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
  return docs
}
