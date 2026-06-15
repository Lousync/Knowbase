import { useState, useCallback, useEffect } from 'react'
import { Upload, FileJson, FileText, Database, Check, Settings, History, FileArchive, XCircle, Loader2 } from 'lucide-react'
import {
  exportAllData, exportAllBlogData, exportAllScheduleData, exportAllKnowledgeData,
  showExportSaveDialog, showExportOpenDirDialog, writeExportTextFile, copyDbFile,
  writeMarkdownExport, onMarkdownExportProgress, getSetting
} from '../../lib/ipc'
import type { BlogExportData, ScheduleExportData, KnowledgeExportData, ExportMarkdownProgress } from '../../types'
import { ProgressPanel } from './components/ProgressPanel'
import { MarkdownItemSelector, SelectableItem } from './components/MarkdownItemSelector'

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

// ---- helpers ----
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ---- Export pipeline ----
interface ExportResult {
  cancelled: boolean
  filePath?: string | null
  dirPath?: string | null
  fileCount?: number
  totalSize?: number
}

async function runJsonExport(moduleIds: Set<string>, encoding: string = 'utf-8'): Promise<ExportResult> {
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

  const writeResult = await writeExportTextFile(filePath, JSON.stringify(data, null, 2), encoding)
  return { cancelled: false, filePath, fileCount: 1, totalSize: writeResult.size }
}

async function runMarkdownExport(
  moduleIds: Set<string>,
  blogIds: Set<string>,
  knowledgeIds: Set<string>,
  scheduleIds: Set<string>,
  data: { blog: BlogExportData | null; schedule: ScheduleExportData | null; knowledge: KnowledgeExportData | null },
  encoding: string = 'utf-8'
): Promise<ExportResult> {
  const { dirPath } = await showExportOpenDirDialog()
  if (!dirPath) return { cancelled: true }

  const files: { relPath: string; content: string }[] = []

  // Blog → selected entries
  if (moduleIds.has('blog') && data.blog) {
    const { entries, tags } = data.blog
    const selected = entries.filter(e => blogIds.has(e.id))

    for (const e of selected) {
      const [y, m] = e.date.split('-')
      const fname = sanitizeFilename(`${e.date}-${e.title || 'untitled'}`)
      const relPath = `blog/${y}/${m}/${fname}.md`

      const frontmatter = toYaml({
        title: e.title,
        date: e.date,
        tags: e.tags?.map((t: { name: string }) => t.name) || [],
        pinned: e.isPinned || undefined
      })
      files.push({ relPath, content: frontmatter + e.contentMd })
    }

    if (selected.length > 0) {
      const usedTagNames = new Set(selected.flatMap(e => e.tags?.map(t => t.name) || []))
      const filteredTags = tags.filter(t => usedTagNames.has(t.name))
      const tagList = filteredTags.map(t => `- **${t.name}**`).join('\n')
      let blogIndex = `# 博客归档\n\n导出时间：${new Date().toISOString().slice(0, 10)}\n\n## 标签列表\n${tagList || '(无)'}\n\n## 文章\n\n`
      for (const e of selected) {
        blogIndex += `- **${e.date}** — [${e.title || '无标题'}](blog/${e.date.slice(0, 4)}/${e.date.slice(5, 7)}/${sanitizeFilename(`${e.date}-${e.title || 'untitled'}`)}.md)${e.isPinned ? ' 📌' : ''}\n`
      }
      blogIndex += `\n共 ${selected.length} 篇文章\n`
      files.push({ relPath: 'blog/index.md', content: blogIndex })
    }
  }

  // Knowledge → selected pages
  if (moduleIds.has('knowledge') && data.knowledge) {
    const { categories, pages: allPages, tags } = data.knowledge
    const selected = allPages.filter(p => knowledgeIds.has(p.id))

    for (const p of selected) {
      const cat = categories.find(c => c.id === p.categoryId)
      const fname = sanitizeFilename(p.title || 'untitled')
      const relPath = `knowledge/pages/${fname}.md`

      const frontmatter = toYaml({
        title: p.title,
        category: cat?.name || undefined,
        starred: p.isStarred || undefined,
        tags: p.tags?.map((t: { name: string }) => t.name) || [],
        backlinks: p.backlinks || [],
        updated: p.updatedAt?.slice(0, 10)
      })
      files.push({ relPath, content: frontmatter + p.contentMd })
    }

    if (selected.length > 0) {
      const relevantCatIds = new Set(selected.map(p => p.categoryId).filter(Boolean) as string[])

      function renderCatTree(parentId: string | null, depth: number): string {
        const cats = categories.filter(c => c.parentId === parentId && relevantCatIds.has(c.id))
        if (cats.length === 0) return ''
        let s = ''
        for (const c of cats) {
          s += `${'  '.repeat(depth)}- 📁 **${c.name}**\n`
          const catPages = selected.filter(p => p.categoryId === c.id)
          for (const p of catPages) {
            const fname = sanitizeFilename(p.title || 'untitled')
            s += `${'  '.repeat(depth + 1)}- [${p.title || '无标题'}](pages/${fname}.md)${p.isStarred ? ' ⭐' : ''}\n`
          }
          s += renderCatTree(c.id, depth + 1)
        }
        return s
      }

      const usedTagNames = new Set(selected.flatMap(p => p.tags?.map(t => t.name) || []))
      const filteredTags = tags.filter(t => usedTagNames.has(t.name))

      let knowledgeIndex = `# 知识库\n\n导出时间：${new Date().toISOString().slice(0, 10)}\n\n## 分类与页面\n\n`
      knowledgeIndex += renderCatTree(null, 0)

      const uncategorized = selected.filter(p => !p.categoryId)
      if (uncategorized.length > 0) {
        knowledgeIndex += `\n## 未分类\n\n`
        for (const p of uncategorized) {
          const fname = sanitizeFilename(p.title || 'untitled')
          knowledgeIndex += `- [${p.title || '无标题'}](pages/${fname}.md)${p.isStarred ? ' ⭐' : ''}\n`
        }
      }

      knowledgeIndex += `\n## 标签\n\n`
      for (const t of filteredTags) knowledgeIndex += `- **${t.name}**\n`
      knowledgeIndex += `\n共 ${selected.length} 个页面\n`
      files.push({ relPath: 'knowledge/index.md', content: knowledgeIndex })
    }
  }

  // Schedule → selected todos
  if (moduleIds.has('schedule') && data.schedule) {
    const { todos, tags } = data.schedule
    const selected = todos.filter(t => scheduleIds.has(t.id))

    if (selected.length > 0) {
      const QUAD_NAMES: Record<number, string> = { 0: '紧急重要', 1: '重要不紧急', 2: '紧急不重要', 3: '不重要不紧急' }
      let md = `# 日程数据\n\n导出时间：${new Date().toISOString().slice(0, 10)}\n\n`
      md += `| 日期 | 标题 | 类型 | 状态 | 四象限 | 标签 | 截止时间 |\n`
      md += `|------|------|------|------|--------|------|----------|\n`
      for (const t of selected) {
        md += `| ${t.date} | ${t.title} | ${t.taskType === 'deadline' ? '截止' : '计划'} | ${t.status === 'done' ? '✅' : '⏳'} | ${QUAD_NAMES[t.quadrant] || t.quadrant} | ${t.tag?.name || '-'} | ${t.time || '-'} |\n`
      }
      md += `\n共 ${selected.length} 条待办\n`

      const usedTagNames = new Set(selected.map(t => t.tag?.name).filter(Boolean) as string[])
      const filteredTags = tags.filter(t => usedTagNames.has(t.name))
      if (filteredTags.length > 0) {
        md += `\n## 标签\n\n`
        for (const t of filteredTags) md += `- **${t.name}**\n`
      }

      files.push({ relPath: 'schedule/todos.md', content: md })
    }
  }

  const writeResult = await writeMarkdownExport(dirPath, files, encoding)
  return { cancelled: false, dirPath, fileCount: writeResult.fileCount, totalSize: writeResult.totalSize }
}

async function runSqliteExport(): Promise<ExportResult> {
  const { filePath } = await showExportSaveDialog({
    defaultName: `knowledge-recorder-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  })
  if (!filePath) return { cancelled: true }

  const copyResult = await copyDbFile(filePath)
  return { cancelled: false, filePath, fileCount: 1, totalSize: copyResult.size }
}

// ---- Component ----
export function ExportModule() {
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(['blog', 'schedule', 'knowledge']))
  const [format, setFormat] = useState<string>('json')
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [history, setHistory] = useState<ExportRecord[]>([])

  // Markdown item selection state
  const [markdownData, setMarkdownData] = useState<{
    blog: BlogExportData | null
    schedule: ScheduleExportData | null
    knowledge: KnowledgeExportData | null
  }>({ blog: null, schedule: null, knowledge: null })
  const [dataLoading, setDataLoading] = useState(false)
  const [selectedBlogIds, setSelectedBlogIds] = useState<Set<string>>(new Set())
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<Set<string>>(new Set())
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<Set<string>>(new Set())

  // Progress state
  const [progress, setProgress] = useState<ExportMarkdownProgress | null>(null)

  // Encoding
  const [exportEncoding, setExportEncoding] = useState('utf-8')
  useEffect(() => {
    getSetting('exportEncoding').then(v => {
      if (typeof v === 'string') setExportEncoding(v)
    })
  }, [])

  const isSqlite = format === 'sqlite'

  const canExport = isSqlite
    ? true
    : format === 'markdown'
      ? (
          (selectedModules.has('blog') && selectedBlogIds.size > 0) ||
          (selectedModules.has('schedule') && selectedScheduleIds.size > 0) ||
          (selectedModules.has('knowledge') && selectedKnowledgeIds.size > 0)
        )
      : selectedModules.size > 0

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

  // ---- Markdown data fetching ----
  useEffect(() => {
    if (format !== 'markdown') return

    const missingBlog = selectedModules.has('blog') && !markdownData.blog
    const missingSchedule = selectedModules.has('schedule') && !markdownData.schedule
    const missingKnowledge = selectedModules.has('knowledge') && !markdownData.knowledge

    if (!missingBlog && !missingSchedule && !missingKnowledge) return

    setDataLoading(true)
    const tasks: Promise<void>[] = []

    if (missingBlog) {
      tasks.push(
        exportAllBlogData().then(d => {
          setMarkdownData(prev => ({ ...prev, blog: d }))
          setSelectedBlogIds(new Set(d.entries.map(e => e.id)))
        })
      )
    }
    if (missingSchedule) {
      tasks.push(
        exportAllScheduleData().then(d => {
          setMarkdownData(prev => ({ ...prev, schedule: d }))
          setSelectedScheduleIds(new Set(d.todos.map(t => t.id)))
        })
      )
    }
    if (missingKnowledge) {
      tasks.push(
        exportAllKnowledgeData().then(d => {
          setMarkdownData(prev => ({ ...prev, knowledge: d }))
          setSelectedKnowledgeIds(new Set(d.pages.map(p => p.id)))
        })
      )
    }

    Promise.all(tasks).finally(() => setDataLoading(false))
  }, [format, selectedModules, markdownData.blog, markdownData.schedule, markdownData.knowledge])

  // Clear markdown state when switching away
  useEffect(() => {
    if (format !== 'markdown') {
      setMarkdownData({ blog: null, schedule: null, knowledge: null })
      setSelectedBlogIds(new Set())
      setSelectedKnowledgeIds(new Set())
      setSelectedScheduleIds(new Set())
      setProgress(null)
    }
  }, [format])

  // ---- Item selection helpers ----
  const toggleBlogItem = (id: string) => {
    setSelectedBlogIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const selectAllBlog = () => setSelectedBlogIds(new Set(markdownData.blog?.entries.map(e => e.id) || []))
  const deselectAllBlog = () => setSelectedBlogIds(new Set())

  const toggleKnowledgeItem = (id: string) => {
    setSelectedKnowledgeIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const selectAllKnowledge = () => setSelectedKnowledgeIds(new Set(markdownData.knowledge?.pages.map(p => p.id) || []))
  const deselectAllKnowledge = () => setSelectedKnowledgeIds(new Set())

  const toggleScheduleItem = (id: string) => {
    setSelectedScheduleIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const selectAllSchedule = () => setSelectedScheduleIds(new Set(markdownData.schedule?.todos.map(t => t.id) || []))
  const deselectAllSchedule = () => setSelectedScheduleIds(new Set())

  // ---- Item lists for selector ----
  const blogSelectableItems: SelectableItem[] = (markdownData.blog?.entries || []).map(e => ({
    id: e.id,
    title: e.title || '无标题',
    subtitle: `${e.date}${e.isPinned ? '  📌置顶' : ''}${e.tags?.length ? '  ' + e.tags.map(t => t.name).join(', ') : ''}`
  }))

  const knowledgeSelectableItems: SelectableItem[] = (markdownData.knowledge?.pages || []).map(p => ({
    id: p.id,
    title: p.title || '无标题',
    subtitle: markdownData.knowledge?.categories.find(c => c.id === p.categoryId)?.name || '未分类'
  }))

  const scheduleSelectableItems: SelectableItem[] = (markdownData.schedule?.todos || []).map(t => ({
    id: t.id,
    title: t.title,
    subtitle: `${t.date}  ${t.taskType === 'deadline' ? '截止日' : '计划'}  ${t.status === 'done' ? '已完成' : '待办'}`
  }))

  // ---- Export action ----
  const handleExport = useCallback(async () => {
    if (!canExport) return
    setStatus('loading')
    setStatusMessage('正在导出...')
    setProgress(null)

    try {
      let result: ExportResult

      if (format === 'sqlite') {
        setProgress({ current: 0, total: 1, currentFile: '', phase: '正在复制数据库文件...' })
        result = await runSqliteExport()
      } else if (format === 'markdown') {
        const unsub = onMarkdownExportProgress((p) => setProgress(p))
        try {
          result = await runMarkdownExport(
            selectedModules, selectedBlogIds, selectedKnowledgeIds, selectedScheduleIds, markdownData, exportEncoding
          )
        } finally {
          unsub()
        }
      } else {
        setProgress({ current: 0, total: 1, currentFile: '', phase: '正在生成 JSON 文件...' })
        result = await runJsonExport(selectedModules, exportEncoding)
      }

      setProgress(null)

      if (result.cancelled) {
        setStatus('idle')
        setStatusMessage('')
        return
      }

      const dest = result.filePath || result.dirPath || ''
      const sizeText = result.totalSize != null ? formatFileSize(result.totalSize) : ''
      const countText = result.fileCount != null && result.fileCount > 1 ? `${result.fileCount} 个文件` : ''
      const detail = [countText, sizeText].filter(Boolean).join('，')

      setStatus('success')
      setStatusMessage(`导出成功${detail ? `（${detail}）` : ''}：${dest.slice(-40)}`)

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
      setProgress(null)
    }
  }, [selectedModules, format, canExport, isSqlite, selectedBlogIds, selectedKnowledgeIds, selectedScheduleIds, markdownData, exportEncoding])

  const statusIcon = status === 'loading' ? <Loader2 size={16} className="animate-spin" />
    : status === 'success' ? <Check size={16} />
    : status === 'error' ? <XCircle size={16} />
    : null

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      {/* Left: Config panel */}
      <div className="w-56 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <Settings size={14} />
            <span className="font-semibold uppercase tracking-wide">导出配置</span>
          </div>
        </div>

        {/* Module checkboxes */}
        <div className="px-3 py-3 border-b border-[var(--border-color)]">
          <label className={`flex items-center gap-2 py-1 text-[12px] cursor-pointer transition-colors ${isSqlite ? 'text-[var(--text-disabled)] cursor-not-allowed' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            <input type="checkbox" checked={allChecked && !isSqlite} onChange={toggleAll} disabled={isSqlite} className="accent-[var(--accent)]" />
            全选
          </label>
          <div className="my-1 border-t border-[var(--bg-tertiary)]" />
          {MODULES.map(m => (
            <label key={m.id} className={`flex items-center gap-2 py-1.5 text-[12px] cursor-pointer transition-colors ${isSqlite ? 'text-[var(--text-disabled)] cursor-not-allowed' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
              <input type="checkbox" checked={selectedModules.has(m.id)} onChange={() => toggleModule(m.id)} disabled={isSqlite} className="accent-[var(--accent)]" />
              <span className={isSqlite ? 'text-[var(--text-disabled)]' : 'text-[var(--text-secondary)]'}>{m.icon}</span>
              <div className="flex flex-col">
                <span className={isSqlite ? 'text-[var(--text-disabled)]' : 'text-[var(--text-primary)] text-[13px]'}>{m.label}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{m.count}</span>
              </div>
            </label>
          ))}
          {isSqlite && (
            <p className="text-[10px] text-[var(--text-disabled)] mt-2">SQLite 格式导出完整数据库，无需选择模块</p>
          )}
        </div>

        {/* Format radio */}
        <div className="px-3 py-3">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">导出格式</div>
          {FORMATS.map(f => (
            <label
              key={f.id}
              onClick={() => setFormat(f.id)}
              className={`flex items-start gap-2 py-2 px-2 rounded cursor-pointer transition-colors ${
                format === f.id ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                format === f.id ? 'border-[var(--accent)]' : 'border-[#6a6a6a]'
              }`}>
                {format === f.id && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
              </div>
              <div>
                <div className="text-[12px] text-[var(--text-primary)] flex items-center gap-1.5">
                  <span className="text-[var(--text-muted)]">{f.icon}</span>
                  {f.label}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{f.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Right: Content area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {format === 'markdown' && status !== 'loading' ? (
            /* Markdown item selector */
            <div className="px-6 py-4">
              <MarkdownItemSelector
                blogItems={blogSelectableItems}
                selectedBlogIds={selectedBlogIds}
                onBlogToggle={toggleBlogItem}
                onBlogSelectAll={selectAllBlog}
                onBlogDeselectAll={deselectAllBlog}
                blogLoading={dataLoading && selectedModules.has('blog') && !markdownData.blog}

                knowledgeItems={knowledgeSelectableItems}
                selectedKnowledgeIds={selectedKnowledgeIds}
                onKnowledgeToggle={toggleKnowledgeItem}
                onKnowledgeSelectAll={selectAllKnowledge}
                onKnowledgeDeselectAll={deselectAllKnowledge}
                knowledgeLoading={dataLoading && selectedModules.has('knowledge') && !markdownData.knowledge}

                scheduleItems={scheduleSelectableItems}
                selectedScheduleIds={selectedScheduleIds}
                onScheduleToggle={toggleScheduleItem}
                onScheduleSelectAll={selectAllSchedule}
                onScheduleDeselectAll={deselectAllSchedule}
                scheduleLoading={dataLoading && selectedModules.has('schedule') && !markdownData.schedule}

                enabledModules={selectedModules}
              />
            </div>
          ) : status === 'loading' ? (
            /* Progress panel */
            <div className="h-full flex flex-col items-center justify-center gap-6 px-8">
              <ProgressPanel progress={progress} format={format} />
            </div>
          ) : (
            /* Default: preview card */
            <div className="h-full flex flex-col items-center justify-center gap-6 px-8">
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-6 w-full max-w-sm">
                <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">导出预览</div>
                <div className="space-y-2 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">选中模块</span>
                    <span className="text-[var(--text-primary)]">
                      {isSqlite ? '数据库完整导出' : `${selectedModules.size} / ${MODULES.length}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">导出格式</span>
                    <span className="text-[var(--text-primary)]">{FORMATS.find(f => f.id === format)?.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">输出方式</span>
                    <span className="text-[var(--text-primary)]">{format === 'markdown' ? '选择文件夹' : '选择保存位置'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Export button + status (sticky footer area) */}
        <div className="flex flex-col items-center gap-3 py-4 px-8 border-t border-[var(--border-color)]">
          <button
            disabled={!canExport || status === 'loading'}
            onClick={handleExport}
            className="flex items-center gap-2 px-8 py-3 bg-[var(--accent)] text-white text-[14px] font-medium rounded-lg hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {status === 'loading' ? '导出中...' : '执行导出'}
          </button>

          {statusMessage && (
            <div className={`flex items-center gap-2 text-[12px] px-3 py-1.5 rounded ${
              status === 'success' ? 'text-[var(--success)] bg-[#1e2a2a]'
              : status === 'error' ? 'text-[var(--danger)] bg-[#2a1e1e]'
              : 'text-[var(--accent)] bg-[#1e1e2a]'
            }`}>
              {statusIcon}
              <span className="truncate max-w-[300px]">{statusMessage}</span>
            </div>
          )}
        </div>

        {/* History footer */}
        <div className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)] px-6 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
            <History size={13} />
            导出历史
          </div>
          {history.length === 0 ? (
            <p className="text-[11px] text-[var(--text-disabled)] py-2">暂无导出记录</p>
          ) : (
            <div className="space-y-0.5">
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-[12px] py-1">
                  <div className="flex items-center gap-2">
                    <Check size={12} className={h.success ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
                    <span className="text-[var(--text-primary)]">{h.modules}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[var(--text-muted)]">
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
