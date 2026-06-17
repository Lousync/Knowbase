import { useState, useEffect, useMemo } from 'react'
import { Trash2, RotateCcw, X, AlertCircle, FileText, BookOpen, Folder, ChevronRight, ChevronDown, ArrowUpDown, Filter } from 'lucide-react'
import type { RecycleBinItem } from '../../types'
import { getRecycleBinItems, restoreRecycleBinItem, restoreRecycleBinPartial, trashRecycleBinItem, trashRecycleBinPartial, emptyRecycleBin } from '../../lib/ipc'

const MODULE_INFO: Record<string, { label: string; icon: React.ReactNode; badgeClass: string }> = {
  blog:          { label: '博客',     icon: <FileText size={12} />,  badgeClass: 'bg-[var(--accent)]/20 text-[var(--accent)]' },
  knowledge:     { label: '知识页面', icon: <BookOpen size={12} />,  badgeClass: 'bg-[var(--success)]/20 text-[var(--success)]' },
  knowledge_category: { label: '知识目录', icon: <Folder size={12} />, badgeClass: 'bg-[var(--warning)]/20 text-[var(--warning)]' },
}

const FILE_TYPE_OPTIONS = ['md', 'txt', 'cpp', 'c', 'h', 'hpp', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'java', 'rs', 'go', 'sh', 'sql', 'xml', 'yaml', 'pdf']

function getItemFileType(item: RecycleBinItem): string {
  if (item.module === 'blog') return 'md'
  if (item.module === 'knowledge') return item.data?.fileType || 'md'
  return 'dir' // knowledge_category
}

export function RecycleBinModule() {
  const [items, setItems] = useState<RecycleBinItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [typeFilter, setTypeFilter] = useState('') // '' = all

  // Filtered + sorted items
  const displayItems = useMemo(() => {
    let result = [...items]
    // Filter by type
    if (typeFilter) {
      result = result.filter(item => getItemFileType(item) === typeFilter)
    }
    // Sort by deletedAt
    result.sort((a, b) => {
      const da = a.deletedAt || ''
      const db = b.deletedAt || ''
      return sortOrder === 'desc' ? db.localeCompare(da) : da.localeCompare(db)
    })
    return result
  }, [items, sortOrder, typeFilter])

  // Count of items per file type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) {
      const ft = getItemFileType(item)
      counts[ft] = (counts[ft] || 0) + 1
    }
    return counts
  }, [items])

  const loadItems = async () => {
    setLoading(true)
    try {
      setItems(await getRecycleBinItems())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadItems() }, [])

  useEffect(() => {
    const handler = () => { loadItems() }
    window.addEventListener('data-imported', handler)
    return () => window.removeEventListener('data-imported', handler)
  }, [])

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const handleRestore = async (id: string, module: string) => {
    try {
      await restoreRecycleBinItem(id)
      await loadItems()
      window.dispatchEvent(new CustomEvent('recycle-restored', { detail: { module } }))
    } catch (e) { console.error(e) }
  }

  const handleRestorePartial = async (binId: string, path: string, module: string) => {
    try {
      await restoreRecycleBinPartial(binId, path)
      await loadItems()
      window.dispatchEvent(new CustomEvent('recycle-restored', { detail: { module } }))
    } catch (e) { console.error(e) }
  }

  const handlePermanentDelete = async (id: string) => {
    try {
      await trashRecycleBinItem(id)
      await loadItems()
    } catch (e) { console.error(e) }
  }

  const handlePermDeletePartial = async (binId: string, path: string) => {
    try {
      await trashRecycleBinPartial(binId, path)
      await loadItems()
    } catch (e) { console.error(e) }
  }

  const handleEmptyAll = async () => {
    try {
      await emptyRecycleBin()
      await loadItems()
    } catch (e) { console.error(e) }
  }

  const renderTreeNode = (item: RecycleBinItem) => {
    if (item.module !== 'knowledge_category') return null
    const data = item.data
    const cat = data?.category
    if (!cat) return null

    const isExpanded = expanded.has(item.id)
    const totalItems = (data.pages?.length || 0) + (data.children?.length || 0)

    return (
      <div className="ml-6 border-l border-[var(--border-color)]">
        {/* Category header */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] bg-[var(--bg-tertiary)]">
          <button onClick={() => toggleExpand(item.id)} className="shrink-0">
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <Folder size={12} className="text-[var(--warning)]" />
          <span className="truncate flex-1">{cat.name}</span>
          <span className="text-[10px] text-[var(--text-muted)] shrink-0">{totalItems} 项</span>
          <button
            onClick={() => handleRestorePartial(item.id, 'category', item.module)}
            className="p-0.5 rounded text-[var(--accent)] hover:bg-[#007acc20] shrink-0"
            title="恢复此目录">
            <RotateCcw size={12} />
          </button>
          <button
            onClick={() => handlePermDeletePartial(item.id, 'category')}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] shrink-0"
            title="永久删除此目录">
            <X size={12} />
          </button>
        </div>

        {/* Expanded children */}
        {isExpanded && (
          <div>
            {/* Sub-directories */}
            {(data.children || []).map((ch: any, ci: number) => {
              const c = ch.category
              return (
                <div key={`${c.id}`} className="ml-3 border-l border-[var(--border-color)]">
                  <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-[var(--text-secondary)] bg-[var(--bg-secondary)]">
                    <span className="w-3" />
                    <Folder size={11} className="text-[var(--text-muted)]" />
                    <span className="truncate flex-1">{c.name}</span>
                    <button
                      onClick={() => handleRestorePartial(item.id, `children.${ci}`, item.module)}
                      className="p-0.5 rounded text-[var(--accent)] hover:bg-[#007acc20] shrink-0"
                      title="恢复此子目录">
                      <RotateCcw size={11} />
                    </button>
                    <button
                      onClick={() => handlePermDeletePartial(item.id, `children.${ci}`)}
                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] shrink-0"
                      title="永久删除此子目录">
                      <X size={11} />
                    </button>
                  </div>
                  {/* Pages in this child */}
                  {(ch.pages || []).map((p: any, pi: number) => (
                    <div key={p.id} className="flex items-center gap-1.5 px-3 py-0.5 ml-6 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                      <FileText size={10} className="text-[var(--text-muted)] shrink-0" />
                      <span className="truncate flex-1">{p.title || '无标题'}</span>
                      <button
                        onClick={() => handleRestorePartial(item.id, `children.${ci}.pages.${pi}`, item.module)}
                        className="p-0.5 rounded text-[var(--accent)] hover:bg-[#007acc20] shrink-0"
                        title="恢复此页面">
                        <RotateCcw size={11} />
                      </button>
                      <button
                        onClick={() => handlePermDeletePartial(item.id, `children.${ci}.pages.${pi}`)}
                        className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] shrink-0"
                        title="永久删除此页面">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}

            {/* Direct pages */}
            {(data.pages || []).map((p: any, pi: number) => (
              <div key={p.id} className="flex items-center gap-1.5 px-3 py-0.5 ml-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                <FileText size={10} className="text-[var(--text-muted)] shrink-0" />
                <span className="truncate flex-1">{p.title || '无标题'}</span>
                <button
                  onClick={() => handleRestorePartial(item.id, `pages.${pi}`, item.module)}
                  className="p-0.5 rounded text-[var(--accent)] hover:bg-[#007acc20] shrink-0"
                  title="恢复此页面">
                  <RotateCcw size={11} />
                </button>
                <button
                  onClick={() => handlePermDeletePartial(item.id, `pages.${pi}`)}
                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] shrink-0"
                  title="永久删除此页面">
                  <X size={11} />
                </button>
              </div>
            ))}

            {(data.pages?.length || 0) === 0 && (data.children?.length || 0) === 0 && (
              <p className="px-3 py-2 text-[10px] text-[var(--text-disabled)] italic ml-3">空目录</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--border-color)] shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trash2 size={18} className="text-[var(--text-secondary)]" />
            <h2 className="text-[15px] font-medium text-[var(--text-primary)]">回收站</h2>
            <span className="text-[11px] text-[var(--text-muted)]">· {displayItems.length}/{items.length} 项</span>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                onClick={handleEmptyAll}
                className="px-3 py-1.5 text-[11px] text-[var(--danger)] hover:bg-[#e8112320] rounded transition-colors"
              >
                全部清空
              </button>
            )}
          </div>
        </div>

        {/* Sort + Filter bar */}
        <div className="flex items-center gap-3">
          {/* Sort toggle */}
          <button
            onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            title={`按删除时间${sortOrder === 'desc' ? '正序' : '倒序'}`}
          >
            <ArrowUpDown size={12} />
            {sortOrder === 'desc' ? '最近删除' : '最早删除'}
          </button>

          {/* Type filter */}
          <div className="flex items-center gap-1">
            <Filter size={12} className="text-[var(--text-muted)]" />
            <button
              onClick={() => setTypeFilter('')}
              className={`px-1.5 py-0.5 text-[11px] rounded transition-colors ${typeFilter === '' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >全部</button>
            {FILE_TYPE_OPTIONS.filter(ft => typeCounts[ft] > 0).map(ft => (
              <button
                key={ft}
                onClick={() => setTypeFilter(typeFilter === ft ? '' : ft)}
                className={`px-1.5 py-0.5 text-[11px] rounded transition-colors ${typeFilter === ft ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title={`${ft} (${typeCounts[ft]})`}
              >
                {ft.toUpperCase()}
                <span className="ml-0.5 opacity-60">{typeCounts[ft]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 30-day notice */}
      {items.length > 0 && (
        <div className="px-5 py-2 flex items-start gap-1.5 text-[11px] text-[var(--warning)] bg-[#2a2a1e] border-b border-[var(--border-color)] shrink-0">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span>删除的内容将在 30 天后自动清空</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="border-2 border-[var(--border-color)] border-t-[#007acc] rounded-full w-6 h-6 animate-spin" />
          </div>
        ) : displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
            <Trash2 size={48} className="mb-4 opacity-25" />
            <p className="text-[14px]">{typeFilter ? `无 ${typeFilter.toUpperCase()} 类型文件` : '回收站为空'}</p>
            <p className="text-[11px] mt-1 text-[var(--text-disabled)]">{typeFilter ? '尝试切换筛选条件' : '删除的内容将在 30 天后自动清空'}</p>
          </div>
        ) : (
          <div>
            {displayItems.map(item => {
              const info = MODULE_INFO[item.module] || { label: item.module, icon: null, badgeClass: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]' }
              const isCategory = item.module === 'knowledge_category'

              return (
                <div key={item.id} className="border-b border-[var(--border-color)]">
                  {/* Item row */}
                  <div className="flex items-center justify-between px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="min-w-0 flex-1 flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium shrink-0 ${info.badgeClass}`}>
                        {info.icon}
                        {info.label}
                      </span>
                      {getItemFileType(item) !== 'dir' && (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--bg-tertiary)] text-[var(--text-muted)] shrink-0">
                          {getItemFileType(item).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-[13px] text-[var(--text-primary)] truncate">{item.title || '无标题'}</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          删除于 {item.deletedAt?.slice(0, 16)?.replace('T', ' ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <button
                        onClick={() => handleRestore(item.id, item.module)}
                        className="p-1.5 rounded text-[var(--accent)] hover:bg-[#007acc20] transition-colors"
                        title={isCategory ? '恢复整个目录树' : '恢复'}
                      >
                        <RotateCcw size={15} />
                      </button>
                      <button
                        onClick={() => handlePermanentDelete(item.id)}
                        className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[#e8112320] transition-colors"
                        title="永久删除"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Expandable tree for category items */}
                  {isCategory && renderTreeNode(item)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
