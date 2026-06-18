import { useState, useEffect, useCallback, useRef } from 'react'
import { Entry, Tag } from '../../types'
import { getEntries, createEntry, deleteEntry, getEntryById, getSetting, setSetting } from '../../lib/ipc'
import { useSettings } from '../../lib/SettingsContext'
import { ConfirmDialog } from '../../components/shared'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'
import { isEditingInput } from '../../lib/shortcuts'
import { ResizablePanel } from '../../components/shared/ResizablePanel'
import { Sidebar } from './components/Sidebar'
import { EntryList } from './views/EntryList'
import { MarkdownEditor } from './components/MarkdownEditor'

type BlogView = 'list' | 'editor' | 'detail'

export function BlogModule({ showLineNumbers = false, sidebarOpen = true, zoom = 1, sidebarWidths = {} as Record<string, number> }: {
  showLineNumbers?: boolean; sidebarOpen?: boolean; zoom?: number; sidebarWidths?: Record<string, number>
}) {
  const { s } = useSettings()
  const [view, setView] = useState<BlogView>('list')
  const [entries, setEntries] = useState<Entry[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const viewRef = useRef(view)
  const selectedIdRef = useRef(selectedId)
  useEffect(() => { viewRef.current = view }, [view])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  const today = new Date().toISOString().split('T')[0]
  const thisMonth = today.slice(0, 7) // "2026-06"

  const loadEntries = useCallback(async () => {
    try {
      setEntries(await getEntries())
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
    loadEntries()
  }, [loadEntries])

  useEffect(() => { loadEntries() }, [loadEntries])

  // 监听数据导入事件 — 导入完成后刷新博文列表
  useEffect(() => {
    const handler = () => { loadEntries() }
    window.addEventListener('data-imported', handler)
    return () => window.removeEventListener('data-imported', handler)
  }, [loadEntries])

  // 今日文章编写 → 检查今天是否已有文章
  const handleTodayEntry = async () => {
    const todayEntry = entries.find(e => e.date === today)
    if (todayEntry) {
      // 已有文章 → 直接打开编辑
      setSelectedId(todayEntry.id)
      setSelectedDate(today)
      setView('editor')
    } else {
      // 没有文章 → 新建
      try {
        const entry = await createEntry({ date: today, title: today })
        setSelectedId(entry.id)
        setSelectedDate(today)
        setView('editor')
        loadEntries()
      } catch (e) { console.error(e) }
    }
  }

  // 点击侧边栏日期 → 打开该日文章（不存在则自动创建）
  const handleSelectDate = async (date: string | null) => {
    setSelectedDate(date)
    if (!date) return
    const entry = entries.find(e => e.date === date)
    if (entry) {
      setSelectedId(entry.id)
      setView('editor')
    } else {
      // 该日期尚无文章 → 自动创建
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
      if (isEditingInput(e)) return

      // Ctrl+N — create/open today's entry
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        handleTodayEntry()
        return
      }

      // Delete — delete entry in editor/detail
      if (e.key === 'Delete') {
        if (viewRef.current !== 'list' && selectedIdRef.current) {
          e.preventDefault()
          deleteEntry(selectedIdRef.current).then(() => {
            goToList()
          }).catch(console.error)
        }
        return
      }

      // Escape — back to list from editor/detail
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

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      <ResizablePanel storageKey="sidebarWidth_blog" defaultWidth={224} minWidth={160} maxWidth={450} visible={sidebarOpen} initialWidth={sidebarWidths.sidebarWidth_blog}>
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-hidden">
            <Sidebar
              entries={entries}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              onNewEntry={handleTodayEntry}
            />
          </div>
        </div>
      </ResizablePanel>
      <main className="flex-1 overflow-hidden">
        {view === 'list' && (
          <EntryList
            entries={selectedDate ? entries.filter(e => e.date === selectedDate) : entries.filter(e => e.date.startsWith(thisMonth))}
            loading={loading}
            onEntryClick={entry => { setSelectedId(entry.id); setSelectedDate(entry.date); setView('editor') }}
            onNewEntry={handleTodayEntry}
            cardSize={s.blogCardSize}
          />
        )}
        {view === 'editor' && selectedId && (
          <MarkdownEditor
            entryId={selectedId}
            showLineNumbers={showLineNumbers}
            zoom={zoom}
            onSave={goToList}
            onCancel={goToList}
          />
        )}
        {view === 'detail' && selectedId && (
          <EntryDetail
            entryId={selectedId}
            onEdit={() => setView('editor')}
            onDelete={async () => {
              await deleteEntry(selectedId); goToList()
            }}
            onBack={goToList}
          />
        )}
      </main>
    </div>
  )
}

// 博文详情阅读
function EntryDetail({ entryId, onEdit, onDelete, onBack }: {
  entryId: string; onEdit: () => void; onDelete: () => void; onBack: () => void
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

  if (!entry) return <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">加载中...</div>

  const handleDeleteClick = () => {
    if (skipDeleteConfirm) {
      onDelete()
    } else {
      setShowDeleteConfirm(true)
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--border-color)]">
            <button onClick={onBack} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← 返回列表</button>
            <div className="flex gap-2">
              <button onClick={onEdit} className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]">编辑</button>
              <button onClick={handleDeleteClick} className="px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[#e8112320] rounded">删除</button>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#e0e0e0] mb-1">{entry.date}</h1>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">最近修改：{fmtRelative(entry.updatedAt)}</p>
          <MarkdownPreview content={entry.contentMd || ''} />
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="确认删除"
        message={`确定要删除博文「${entry.title || entry.date}」吗？删除后可在回收站恢复，30天后将自动清空。`}
        onConfirm={(skipNext) => {
          if (skipNext) {
            setSetting('skipDeleteConfirm_blog', true)
            setSkipDeleteConfirm(true)
          }
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
