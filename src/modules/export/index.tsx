import { useState, useCallback } from 'react'
import { Download, FileJson, FileText, Database, Check, Settings, History, FileArchive, XCircle, Loader2 } from 'lucide-react'
import { exportAllData, exportAllBlogData, exportAllScheduleData, exportAllKnowledgeData, showExportSaveDialog, showExportOpenDirDialog, writeExportTextFile, copyDbFile, writeMarkdownExport } from '../../lib/ipc'

// ---- types ----
interface ModuleOption {
  id: 'blog' | 'schedule' | 'knowledge'
  label: string
  icon: React.ReactNode
  count: string
}

interface FormatOption {
  id: 'json' | 'markdown' | 'sqlite'
  label: string
  desc: string
  icon: React.ReactNode
}

interface ExportRecord {
  date: string
  modules: string
  format: string
  success: boolean
}

const MODULES: ModuleOption[] = [
  { id: 'blog', label: '博客', icon: <FileText size={16} />, count: '文章 + 标签' },
  { id: 'schedule', label: '日程', icon: <Database size={16} />, count: '待办 + 四象限' },
  { id: 'knowledge', label: '知识库', icon: <FileArchive size={16} />, count: '页面 + 分类 + 链接' },
]

const FORMATS: FormatOption[] = [
  { id: 'json', label: 'JSON 单文件', desc: '完整保留关联数据，可重新导入', icon: <FileJson size={14} /> },
  { id: 'markdown', label: 'Markdown 文件集', desc: '每篇文章/页面一个 .md 文件，导出到文件夹', icon: <FileText size={14} /> },
  { id: 'sqlite', label: 'SQLite 原始文件', desc: '直接复制 knowledge.db', icon: <Database size={14} /> },
]

type ExportStatus = 'idle' | 'loading' | 'success' | 'error'

// ---- Markdown helpers ----
function sanitizeFilename(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'untitled'
}

function toYaml(obj: Record<string, unknown>): string {
  let y = '---\n'
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      y += `${k}:\n${v.map((i: unknown) => `  - ${JSON.stringify(i)}`).join('\n')}\n`
    } else {
      y += `${k}: ${JSON.stringify(v)}\n`
    }
  }
  y += '---\n\n'
  return y
}

// ---- Export pipeline ----
async function runJsonExport(moduleIds: Set<string>) {
  const isAll = moduleIds.has('blog') && moduleIds.has('schedule') && moduleIds.has('knowledge')

  const { filePath } = await showExportSaveDialog({
    defaultName: isAll ? `knowledge-recorder-${new Date().toISOString().slice(0, 10)}.json` : 'export.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  })
  if (!filePath) return { cancelled: true }

  let data: unknown
  if (isAll) {
    data = await exportAllData()
  } else {
    const parts: Record<string, unknown> = {}
    if (moduleIds.has('blog')) parts.blog = await exportAllBlogData()
    if (moduleIds.has('schedule')) parts.schedule = await exportAllScheduleData()
    if (moduleIds.has('knowledge')) parts.knowledge = await exportAllKnowledgeData()
    data = { exportVersion: '1.0', exportedAt: new Date().toISOString(), ...parts }
  }

  await writeExportTextFile(filePath, JSON.stringify(data, null, 2))
  return { cancelled: false, filePath }
}

async function runMarkdownExport(moduleIds: Set<string>) {
  const { dirPath } = await showExportOpenDirDialog()
  if (!dirPath) return { cancelled: true }

  const files: { relPath: string; content: string }[] = []

  // Blog → .md files with YAML frontmatter
  if (moduleIds.has('blog')) {
    const { entries, tags } = await exportAllBlogData()
    const entryDates: string[] = []

    for (const e of entries) {
      const [y, m] = e.date.split('-')
      const fname = sanitizeFilename(`${e.date}-${e.title || 'untitled'}`)
      const relPath = `blog/${y}/${m}/${fname}.md`
      entryDates.push(e.date)

      const frontmatter = toYaml({
        title: e.title,
        date: e.date,
        tags: e.tags?.map(t => t.name) || [],
        wordCount: e.wordCount,
        pinned: e.isPinned || undefined
      })
      files.push({ relPath, content: frontmatter + e.contentMd })
    }

    // Blog index
    const tagList = tags.map(t => `- **${t.name}**`).join('\n')
    let blogIndex = `# 博客归档\n\n导出时间：${new Date().toISOString().slice(0, 10)}\n\n## 标签列表\n${tagList || '(无)'}\n\n## 文章\n\n`
    for (const e of entries) {
      blogIndex += `- **${e.date}** — [${e.title || '无标题'}](blog/${e.date.slice(0, 4)}/${e.date.slice(5, 7)}/${sanitizeFilename(`${e.date}-${e.title || 'untitled'}`)}.md)${e.isPinned ? ' 📌' : ''}\n`
    }
    blogIndex += `\n共 ${entries.length} 篇文章\n`
    files.push({ relPath: 'blog/index.md', content: blogIndex })
  }

  // Knowledge → .md files
  if (moduleIds.has('knowledge')) {
    const { categories, pages, tags } = await exportAllKnowledgeData()

    for (const p of pages) {
      const cat = categories.find(c => c.id === p.categoryId)
      const fname = sanitizeFilename(p.title || 'untitled')
      const relPath = `knowledge/pages/${fname}.md`

      const frontmatter = toYaml({
        title: p.title,
        category: cat?.name || undefined,
        starred: p.isStarred || undefined,
        tags: p.tags?.map(t => t.name) || [],
        backlinks: p.backlinks || [],
        updated: p.updatedAt?.slice(0, 10)
      })
      files.push({ relPath, content: frontmatter + p.contentMd })
    }

    // Knowledge index
    const catMap = new Map<string, { name: string; children: string[] }>()
    for (const c of categories) {
      catMap.set(c.id, { name: c.name, children: [] })
    }
    for (const c of categories) {
      if (c.parentId && catMap.has(c.parentId)) {
        catMap.get(c.parentId)!.children.push(c.id)
      }
    }

    function renderCatTree(parentId: string | null, depth: number): string {
      const cats = categories.filter(c => c.parentId === parentId)
      if (cats.length === 0) return ''
      let s = ''
      for (const c of cats) {
        s += `${'  '.repeat(depth)}- 📁 **${c.name}**\n`
        const catPages = pages.filter(p => p.categoryId === c.id)
        for (const p of catPages) {
          const fname = sanitizeFilename(p.title || 'untitled')
          s += `${'  '.repeat(depth + 1)}- [${p.title || '无标题'}](pages/${fname}.md)${p.isStarred ? ' ⭐' : ''}\n`
        }
        s += renderCatTree(c.id, depth + 1)
      }
      return s
    }

    let knowledgeIndex = `# 知识库\n\n导出时间：${new Date().toISOString().slice(0, 10)}\n\n## 分类与页面\n\n`
    knowledgeIndex += renderCatTree(null, 0)

    const uncategorized = pages.filter(p => !p.categoryId)
    if (uncategorized.length > 0) {
      knowledgeIndex += `\n## 未分类\n\n`
      for (const p of uncategorized) {
        const fname = sanitizeFilename(p.title || 'untitled')
        knowledgeIndex += `- [${p.title || '无标题'}](pages/${fname}.md)${p.isStarred ? ' ⭐' : ''}\n`
      }
    }

    knowledgeIndex += `\n## 标签\n\n`
    for (const t of tags) knowledgeIndex += `- **${t.name}**\n`

    knowledgeIndex += `\n共 ${pages.length} 个页面，${categories.length} 个分类\n`
    files.push({ relPath: 'knowledge/index.md', content: knowledgeIndex })
  }

  // Schedule → markdown table
  if (moduleIds.has('schedule')) {
    const { todos, tags } = await exportAllScheduleData()

    const QUAD_NAMES: Record<number, string> = { 0: '紧急重要', 1: '重要不紧急', 2: '紧急不重要', 3: '不重要不紧急' }
    const tagNameMap = new Map(tags.map(t => [t.id, t.name]))

    let md = `# 日程数据\n\n导出时间：${new Date().toISOString().slice(0, 10)}\n\n`
    md += `| 日期 | 标题 | 类型 | 状态 | 四象限 | 标签 | 截止时间 |\n`
    md += `|------|------|------|------|--------|------|----------|\n`
    for (const t of todos) {
      md += `| ${t.date} | ${t.title} | ${t.taskType === 'deadline' ? '截止' : '计划'} | ${t.status === 'done' ? '✅' : '⏳'} | ${QUAD_NAMES[t.quadrant] || t.quadrant} | ${t.tag?.name || tagNameMap.get(t.tagId || '') || '-'} | ${t.time || '-'} |\n`
    }
    md += `\n共 ${todos.length} 条待办，${todos.filter(t => t.status === 'done').length} 已完成\n`

    // Tag list
    if (tags.length > 0) {
      md += `\n## 标签\n\n`
      for (const t of tags) md += `- **${t.name}**\n`
    }

    files.push({ relPath: 'schedule/todos.md', content: md })
  }

  await writeMarkdownExport(dirPath, files)
  return { cancelled: false, dirPath }
}

async function runSqliteExport() {
  const { filePath } = await showExportSaveDialog({
    defaultName: `knowledge-recorder-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  })
  if (!filePath) return { cancelled: true }

  await copyDbFile(filePath)
  return { cancelled: false, filePath }
}

// ---- Component ----
export function ExportModule() {
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(['blog', 'schedule', 'knowledge']))
  const [format, setFormat] = useState<string>('json')
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [history, setHistory] = useState<ExportRecord[]>([])

  const isSqlite = format === 'sqlite'
  const canExport = selectedModules.size > 0 || isSqlite
  const allChecked = selectedModules.size === MODULES.length

  const toggleAll = () => {
    if (allChecked) setSelectedModules(new Set())
    else setSelectedModules(new Set(MODULES.map(m => m.id)))
  }

  const toggleModule = (id: string) => {
    const next = new Set(selectedModules)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedModules(next)
  }

  const handleExport = useCallback(async () => {
    if (!canExport) return
    setStatus('loading')
    setStatusMessage('正在导出...')

    try {
      let result: { cancelled: boolean; filePath?: string | null; dirPath?: string | null }

      if (format === 'sqlite') {
        result = await runSqliteExport()
      } else if (format === 'markdown') {
        result = await runMarkdownExport(selectedModules)
      } else {
        result = await runJsonExport(selectedModules)
      }

      if (result.cancelled) {
        setStatus('idle')
        setStatusMessage('')
        return
      }

      const dest = result.filePath || result.dirPath || ''
      const isDir = !!result.dirPath

      setStatus('success')
      setStatusMessage(`导出成功${isDir ? '，文件已写入' : '：'}${dest.slice(-40)}`)

      // Add to history
      const moduleLabel = isSqlite ? '原始数据库' : selectedModules.size === 3 ? '全部模块' : MODULES.filter(m => selectedModules.has(m.id)).map(m => m.label).join('+')
      setHistory(prev => [{
        date: new Date().toISOString().slice(0, 10),
        modules: moduleLabel,
        format: FORMATS.find(f => f.id === format)?.label || format,
        success: true
      }, ...prev.slice(0, 9)])

      // Auto-clear success after 5s
      setTimeout(() => { setStatus('idle'); setStatusMessage('') }, 5000)
    } catch (e: unknown) {
      setStatus('error')
      setStatusMessage(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [selectedModules, format, canExport])

  const statusIcon = status === 'loading' ? <Loader2 size={16} className="animate-spin" />
    : status === 'success' ? <Check size={16} />
    : status === 'error' ? <XCircle size={16} />
    : null

  return (
    <div className="flex h-full bg-[#1e1e1e]">
      {/* Left: Config panel */}
      <div className="w-56 shrink-0 bg-[#252526] border-r border-[#3c3c3c] flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-[#3c3c3c]">
          <div className="flex items-center gap-2 text-[12px] text-[#969696]">
            <Settings size={14} />
            <span className="font-semibold uppercase tracking-wide">导出配置</span>
          </div>
        </div>

        {/* Module checkboxes */}
        <div className="px-3 py-3 border-b border-[#3c3c3c]">
          <label className={`flex items-center gap-2 py-1 text-[12px] cursor-pointer transition-colors ${isSqlite ? 'text-[#555] cursor-not-allowed' : 'text-[#969696] hover:text-[#cccccc]'}`}>
            <input type="checkbox" checked={allChecked && !isSqlite} onChange={toggleAll} disabled={isSqlite} className="accent-[#007acc]" />
            全选
          </label>
          <div className="my-1 border-t border-[#2d2d2d]" />
          {MODULES.map(m => (
            <label key={m.id} className={`flex items-center gap-2 py-1.5 text-[12px] cursor-pointer transition-colors ${isSqlite ? 'text-[#555] cursor-not-allowed' : 'text-[#969696] hover:text-[#cccccc]'}`}>
              <input type="checkbox" checked={selectedModules.has(m.id)} onChange={() => toggleModule(m.id)} disabled={isSqlite} className="accent-[#007acc]" />
              <span className={isSqlite ? 'text-[#555]' : 'text-[#969696]'}>{m.icon}</span>
              <div className="flex flex-col">
                <span className={isSqlite ? 'text-[#555]' : 'text-[#cccccc] text-[13px]'}>{m.label}</span>
                <span className="text-[10px] text-[#6a6a6a]">{m.count}</span>
              </div>
            </label>
          ))}
          {isSqlite && (
            <p className="text-[10px] text-[#555] mt-2">SQLite 格式导出完整数据库，无需选择模块</p>
          )}
        </div>

        {/* Format radio */}
        <div className="px-3 py-3">
          <div className="text-[11px] font-semibold text-[#6a6a6a] uppercase tracking-wide mb-2">导出格式</div>
          {FORMATS.map(f => (
            <label
              key={f.id}
              onClick={() => setFormat(f.id)}
              className={`flex items-start gap-2 py-2 px-2 rounded cursor-pointer transition-colors ${
                format === f.id ? 'bg-[#094771]' : 'hover:bg-[#2a2d2e]'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                format === f.id ? 'border-[#007acc]' : 'border-[#6a6a6a]'
              }`}>
                {format === f.id && <div className="w-2 h-2 rounded-full bg-[#007acc]" />}
              </div>
              <div>
                <div className="text-[12px] text-[#cccccc] flex items-center gap-1.5">
                  <span className="text-[#6a6a6a]">{f.icon}</span>
                  {f.label}
                </div>
                <div className="text-[10px] text-[#6a6a6a] mt-0.5">{f.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Right: Preview + Action + History */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
          {/* Summary card */}
          <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-full max-w-sm">
            <div className="text-[11px] font-semibold text-[#6a6a6a] uppercase tracking-wide mb-3">导出预览</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#969696]">选中模块</span>
                <span className="text-[#cccccc]">
                  {isSqlite ? '数据库完整导出' : `${selectedModules.size} / ${MODULES.length}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#969696]">导出格式</span>
                <span className="text-[#cccccc]">{FORMATS.find(f => f.id === format)?.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#969696]">输出方式</span>
                <span className="text-[#cccccc]">{format === 'markdown' ? '选择文件夹' : '选择保存位置'}</span>
              </div>
            </div>
          </div>

          {/* Export button + status */}
          <div className="flex flex-col items-center gap-3">
            <button
              disabled={!canExport || status === 'loading'}
              onClick={handleExport}
              className="flex items-center gap-2 px-8 py-3 bg-[#007acc] text-white text-[14px] font-medium rounded-lg hover:bg-[#1a8ad4] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {status === 'loading' ? '导出中...' : '执行导出'}
            </button>

            {statusMessage && (
              <div className={`flex items-center gap-2 text-[12px] px-3 py-1.5 rounded ${
                status === 'success' ? 'text-[#4ec9b0] bg-[#1e2a2a]'
                : status === 'error' ? 'text-[#e81123] bg-[#2a1e1e]'
                : 'text-[#007acc] bg-[#1e1e2a]'
              }`}>
                {statusIcon}
                <span className="truncate max-w-[300px]">{statusMessage}</span>
              </div>
            )}
          </div>
        </div>

        {/* History footer */}
        <div className="border-t border-[#3c3c3c] bg-[#252526] px-6 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#6a6a6a] uppercase tracking-wide mb-2">
            <History size={13} />
            导出历史
          </div>
          {history.length === 0 ? (
            <p className="text-[11px] text-[#555] py-2">暂无导出记录</p>
          ) : (
            <div className="space-y-0.5">
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-[12px] py-1">
                  <div className="flex items-center gap-2">
                    <Check size={12} className={h.success ? 'text-[#4ec9b0]' : 'text-[#e81123]'} />
                    <span className="text-[#cccccc]">{h.modules}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[#6a6a6a]">
                    <span>{h.format}</span>
                    <span>{h.date}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
