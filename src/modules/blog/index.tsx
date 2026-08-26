import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Star, ListTree, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Entry, Tag } from '../../types'
import { getEntries, createEntry, deleteEntry, getEntryById, toggleEntryStar, getSetting, setSetting, openExternal, getTags } from '../../lib/ipc'
import { useSettings } from '../../lib/SettingsContext'
import { ConfirmDialog } from '../../components/shared'
import { registerAssistantContext } from '../../lib/assistantContext'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'
import { isEditingInput } from '../../lib/shortcuts'
import { getGlobalActiveTab } from '../../lib/activeTab'
import { localToday } from '../../lib/date'
import { ResizablePanel } from '../../components/shared/ResizablePanel'
import { OutlinePanel, parseHeadings } from '../../components/shared/OutlinePanel'
import { Sidebar } from './components/Sidebar'
import { EntryList } from './views/EntryList'
import { MarkdownEditor } from './components/MarkdownEditor'
import { SummaryPanel } from './components/SummaryPanel'

type BlogView = 'list' | 'editor' | 'detail'

export function BlogModule({ showLineNumbers = false, sidebarOpen = true, zoom = 1, sidebarWidths = {} as Record<string, number>, onSnapCloseSidebar, onSnapOpenSidebar }: {
  showLineNumbers?: boolean; sidebarOpen?: boolean; zoom?: number; sidebarWidths?: Record<string, number>; onSnapCloseSidebar?: () => void; onSnapOpenSidebar?: () => void
}) {
  const { s } = useSettings()
  const [view, setView] = useState<BlogView>('list')
  const [entries, setEntries] = useState<Entry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOutline, setShowOutline] = useState(false)
  const [liveContent, setLiveContent] = useState('')
  const [allTags, setAllTags] = useState<Tag[]>([])

  const viewRef = useRef(view)
  const selectedIdRef = useRef(selectedId)
  useEffect(() => { viewRef.current = view }, [view])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  // Month & tag filter
  const today = localToday()
  const thisMonth = today.slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)   // null = thisMonth only; string = YYYY-MM filter; 'showAll' = everything
  const [filterTagId, setFilterTagId] = useState<string | null>(null)        // null = all tags

  // AI 助手上下文：正在编辑/查看的日记
  useEffect(() => {
    return registerAssistantContext(() => {
      if (!selectedId) return null
      const e = entries.find(x => x.id === selectedId)
      if (!e) return null
      const content = (liveContent && liveContent.length > 0 ? liveContent : e.contentMd) || ''
      return {
        type: 'blog.entry',
        label: `正在编辑的日记「${e.title || e.date}」`,
        data: { id: e.id, date: e.date, title: e.title, contentMd: content.slice(0, 8000) },
      }
    })
  }, [selectedId, entries, liveContent])

  const loadEntries = useCallback(async () => {
    try {
      const [es, ts] = await Promise.all([getEntries(), getTags()])
      setEntries(es)
      setAllTags(ts)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  // 回到列表：清除选中态，显示当月文章
  const goToList = useCallback(() => {
    setView('list')
    setSelectedId(null)
    setSelectedDate(null)
    setShowOutline(false)
    setSelectedMonth(null)
    setFilterTagId(null)
    onSnapOpenSidebar?.()
    loadEntries()
  }, [loadEntries, onSnapOpenSidebar])

  useEffect(() => { loadEntries() }, [loadEntries])

  // 监听数据导入事件
  useEffect(() => {
    const handler = () => { loadEntries() }
    window.addEventListener('data-imported', handler)
    return () => window.removeEventListener('data-imported', handler)
  }, [loadEntries])

  // Toggle star on an entry
  const handleToggleStar = useCallback(async (id: string) => {
    const updated = await toggleEntryStar(id)
    if (updated) {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, isStarred: updated.isStarred } : e))
    }
  }, [])

  const handleTodayEntry = async () => {
    const todayEntry = entries.find(e => e.date === today)
    if (todayEntry) {
      setSelectedId(todayEntry.id)
      setSelectedDate(today)
      setView('editor')
    } else {
      try {
        const entry = await createEntry({ date: today, title: today })
        setSelectedId(entry.id)
        setSelectedDate(today)
        setView('editor')
        loadEntries()
      } catch (e) { console.error(e) }
    }
  }

  const handleShowAll = useCallback(() => {
    setView('list')
    setSelectedId(null)
    setSelectedDate(null)
    setSelectedMonth('showAll')
    setFilterTagId(null)
    setShowOutline(false)
    onSnapOpenSidebar?.()
    loadEntries()
  }, [loadEntries, onSnapOpenSidebar])

  const handleSelectDate = async (date: string | null) => {
    setSelectedDate(date)
    if (!date) {
      setView('list')
      setSelectedMonth(null)
      setFilterTagId(null)
      return
    }
    const entry = entries.find(e => e.date === date)
    if (entry) {
      setSelectedId(entry.id)
      setView(date === today ? 'editor' : 'detail')
      if (date !== today) setLiveContent(entry.contentMd || '')
    } else {
      try {
        const e = await createEntry({ date, title: date })
        setSelectedId(e.id)
        setView('editor')
        loadEntries()
      } catch (err) { console.error(err) }
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getGlobalActiveTab() !== 'blog') return
      if (isEditingInput(e)) return

      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        handleTodayEntry()
        return
      }

      if (e.key === 'Delete') {
        if (viewRef.current !== 'list' && selectedIdRef.current) {
          e.preventDefault()
          deleteEntry(selectedIdRef.current).then(() => goToList()).catch(console.error)
        }
        return
      }

      if (e.key === 'Escape') {
        if (viewRef.current !== 'list') {
          e.preventDefault()
          goToList()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleTodayEntry, goToList, loadEntries])

  const starredEntries = entries.filter(e => e.isStarred)

  // ---- month navigation ----
  const effectiveMonth = selectedMonth === 'showAll' ? null : (selectedMonth || thisMonth)
  const MONTH_NAMES = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']

  const monthLabel = effectiveMonth
    ? `${effectiveMonth.slice(0, 4)}年${MONTH_NAMES[parseInt(effectiveMonth.slice(5, 7)) - 1]}`
    : '全部文章'

  const navigateMonth = (dir: -1 | 1) => {
    if (!effectiveMonth) return
    const [y, m] = effectiveMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + dir, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    setFilterTagId(null)
    setSelectedDate(null)
  }

  // Build tag list from entries in current view
  const displayedTagCounts = useMemo(() => {
    const map: Record<string, { tag: Tag; count: number }> = {}
    for (const t of allTags) map[t.id] = { tag: t, count: 0 }
    const viewEntries = selectedDate
      ? entries.filter(e => e.date === selectedDate)
      : effectiveMonth
        ? entries.filter(e => e.date.startsWith(effectiveMonth))
        : entries
    for (const e of viewEntries) {
      for (const t of e.tags || []) {
        if (map[t.id]) map[t.id].count++
      }
    }
    return Object.values(map).filter(x => x.count > 0).sort((a, b) => b.count - a.count)
  }, [allTags, entries, effectiveMonth, selectedDate])

  // Final filtered entries for display
  const displayEntries = useMemo(() => {
    let result = selectedDate
      ? entries.filter(e => e.date === selectedDate)
      : effectiveMonth
        ? entries.filter(e => e.date.startsWith(effectiveMonth))
        : entries
    if (filterTagId) {
      result = result.filter(e => (e.tags || []).some(t => t.id === filterTagId))
    }
    return result
  }, [entries, effectiveMonth, selectedDate, filterTagId])

  // Reset liveContent when switching entries
  useEffect(() => { setLiveContent('') }, [selectedId])

  // Outline headings from live content
  const outlineHeadings = useMemo(() => parseHeadings(liveContent), [liveContent])

  const handleToggleOutline = useCallback(() => {
    setShowOutline(v => {
      const next = !v
      if (next) {
        onSnapCloseSidebar?.()
      } else {
        onSnapOpenSidebar?.()
      }
      return next
    })
  }, [onSnapCloseSidebar, onSnapOpenSidebar])

  // Ctrl+O toggle outline
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getGlobalActiveTab() !== 'blog') return
      if (isEditingInput(e)) return
      if (e.ctrlKey && e.key === 'o' && (view === 'editor' || view === 'detail')) {
        e.preventDefault()
        handleToggleOutline()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, handleToggleOutline])

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      <ResizablePanel storageKey="sidebarWidth_blog" defaultWidth={224} minWidth={160} maxWidth={450} visible={sidebarOpen && !showOutline} initialWidth={sidebarWidths.sidebarWidth_blog} onSnapClose={onSnapCloseSidebar} onSnapOpen={onSnapOpenSidebar}>
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-hidden">
            <Sidebar
              entries={entries}
              starredEntries={starredEntries}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              onNewEntry={handleTodayEntry}
              onShowAll={handleShowAll}
              allTags={allTags}
            />
          </div>
        </div>
      </ResizablePanel>

      {/* Outline panel — replaces sidebar on the left when toggled */}
      {showOutline && (view === 'editor' || view === 'detail') && (
        <OutlinePanel
          pageTitle={view === 'editor' ? (entries.find(e => e.id === selectedId)?.title || '') : (entries.find(e => e.id === selectedId)?.date || '')}
          headings={outlineHeadings}
          onBackToFile={handleToggleOutline}
        />
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        {view === 'list' && (
          <>
            {/* Month switcher + tag filter bar */}
            <div className="flex items-center justify-center px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigateMonth(-1)}
                  disabled={!effectiveMonth}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="上个月"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-[13px] font-medium text-[var(--text-primary)] min-w-[120px] text-center select-none">{monthLabel}</span>
                <button
                  onClick={() => navigateMonth(1)}
                  disabled={!effectiveMonth}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="下个月"
                >
                  <ChevronRight size={16} />
                </button>
                {effectiveMonth && (
                  <button
                    onClick={() => { setSelectedMonth('showAll'); setSelectedDate(null); setFilterTagId(null) }}
                    className="ml-2 px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                  >
                    全部
                  </button>
                )}
                {selectedMonth === 'showAll' && (
                  <button
                    onClick={() => setSelectedMonth(null)}
                    className="ml-2 px-2 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                  >
                    回到本月
                  </button>
                )}
                {filterTagId && (
                  <button
                    onClick={() => setFilterTagId(null)}
                    className="ml-2 flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded hover:bg-[var(--accent)]/20 transition-colors"
                  >
                    <X size={10} />清除筛选
                  </button>
                )}
              </div>
            </div>

            {/* Tag filter chips */}
            {displayedTagCounts.length > 0 && (
              <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)] overflow-x-auto shrink-0">
                {displayedTagCounts.map(({ tag, count }) => (
                  <button
                    key={tag.id}
                    onClick={() => setFilterTagId(prev => prev === tag.id ? null : tag.id)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] shrink-0 transition-colors border ${
                      filterTagId === tag.id
                        ? 'border-current'
                        : 'border-transparent hover:border-current/30'
                    }`}
                    style={{
                      backgroundColor: tag.color + (filterTagId === tag.id ? '30' : '15'),
                      color: tag.color
                    }}
                  >
                    {tag.name}
                    <span className="opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            )}

            <EntryList
              entries={displayEntries}
              loading={loading}
              onEntryClick={entry => { setSelectedId(entry.id); setSelectedDate(entry.date); setView(entry.date === today ? 'editor' : 'detail'); if (entry.date !== today) setLiveContent(entry.contentMd || '') }}
              onToggleStar={handleToggleStar}
              onNewEntry={handleTodayEntry}
              cardSize={s.blogCardSize}
            />
          </>
        )}
        {view === 'editor' && selectedId && (
          <MarkdownEditor
            entryId={selectedId}
            showLineNumbers={showLineNumbers}
            zoom={zoom}
            onSave={goToList}
            onCancel={goToList}
            onContentChange={setLiveContent}
            onToggleOutline={handleToggleOutline}
          />
        )}
        {view === 'detail' && selectedId && (
          <EntryDetail
            entryId={selectedId}
            onEdit={() => setView('editor')}
            onDelete={async () => { await deleteEntry(selectedId); goToList() }}
            onBack={goToList}
            onToggleOutline={handleToggleOutline}
          />
        )}
      </main>
    </div>
  )
}

// 博文详情阅读
function EntryDetail({ entryId, onEdit, onDelete, onBack, onToggleOutline }: {
  entryId: string; onEdit: () => void; onDelete: () => void; onBack: () => void; onToggleOutline?: () => void
}) {
  const [entry, setEntry] = useState<(Entry & { tags: Tag[] }) | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)

  useEffect(() => { getEntryById(entryId).then(setEntry) }, [entryId])

  useEffect(() => {
    getSetting('skipDeleteConfirm_blog').then(v => {
      if (v === true) setSkipDeleteConfirm(true)
    })
  }, [])

  const handleToggleStar = async () => {
    const updated = await toggleEntryStar(entryId)
    if (updated) setEntry(prev => prev ? { ...prev, isStarred: updated.isStarred, tags: prev.tags } : null)
  }

  if (!entry) return <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">加载中...</div>

  const handleDeleteClick = () => {
    if (skipDeleteConfirm) { onDelete() } else { setShowDeleteConfirm(true) }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--border-color)]">
            <button onClick={onBack} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← 返回列表</button>
            <div className="flex gap-2">
              {onToggleOutline && (
                <button onClick={onToggleOutline} className="p-1.5 rounded hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]" title="大纲 (Ctrl+O)">
                  <ListTree size={16} />
                </button>
              )}
              <button onClick={handleToggleStar} className="p-1.5 rounded hover:bg-[var(--bg-hover)] transition-colors" title={entry.isStarred ? '取消收藏' : '收藏'}>
                <Star size={16} className={entry.isStarred ? 'text-[var(--warning)] fill-[#c5a332]' : 'text-[var(--text-muted)]'} />
              </button>
              <button onClick={onEdit} className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]">编辑</button>
              <button onClick={handleDeleteClick} className="px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[#e8112320] rounded">删除</button>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">{entry.date}</h1>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">最近修改：{fmtRelative(entry.updatedAt)}</p>
          <MarkdownPreview content={entry.contentMd || ''} onLinkClick={href => openExternal(href)} />
          <SummaryPanel date={entry.date} />
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="确认删除"
        message={`确定要删除博文「${entry.title || entry.date}」吗？删除后可在回收站恢复，30天后将自动清空。`}
        onConfirm={(skipNext) => {
          if (skipNext) { setSetting('skipDeleteConfirm_blog', true); setSkipDeleteConfirm(true) }
          setShowDeleteConfirm(false)
          onDelete()
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  )
}

function fmtRelative(dateStr: string): string {
  const d = new Date(dateStr)
  const now = Date.now()
  const diff = now - d.getTime()
  if (isNaN(diff)) return dateStr
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return d.toLocaleDateString('zh-CN')
}
