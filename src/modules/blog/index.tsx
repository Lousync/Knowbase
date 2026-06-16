import { useState, useEffect, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { Entry, Tag } from '../../types'
import { RecycleBinPanel } from '../shared/components/RecycleBinPanel'
import { getEntries, createEntry, deleteEntry, getEntryById, getSetting, setSetting } from '../../lib/ipc'
import { ConfirmDialog } from '../../components/shared'
import { ResizablePanel } from '../../components/shared/ResizablePanel'
import { Sidebar } from './components/Sidebar'
import { EntryList } from './views/EntryList'
import { MarkdownEditor } from './components/MarkdownEditor'

type BlogView = 'list' | 'editor' | 'detail'

export function BlogModule({ showLineNumbers = false, sidebarOpen = true, zoom = 1, sidebarWidths = {} as Record<string, number> }: {
  showLineNumbers?: boolean; sidebarOpen?: boolean; zoom?: number; sidebarWidths?: Record<string, number>
}) {
  const [view, setView] = useState<BlogView>('list')
  const [entries, setEntries] = useState<Entry[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRecycleBin, setShowRecycleBin] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  const loadEntries = useCallback(async () => {
    try {
      setEntries(await getEntries())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

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

  // 点击侧边栏日期 → 查看该日文章（已过日期为只读详情）
  const handleSelectDate = (date: string | null) => {
    setSelectedDate(date)
    if (!date) return
    const entry = entries.find(e => e.date === date)
    if (entry) {
      setSelectedId(entry.id)
      if (date === today) {
        setView('editor')
      } else {
        setView('detail')
      }
    }
  }

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
          <button
            onClick={() => setShowRecycleBin(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 text-[12px] border-t border-[var(--border-color)] transition-colors shrink-0 ${
              showRecycleBin ? 'bg-[var(--bg-selected)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <Trash2 size={14} /> 回收站
          </button>
        </div>
      </ResizablePanel>
      <main className="flex-1 overflow-hidden">
        {view === 'list' && (
          <EntryList
            entries={selectedDate ? entries.filter(e => e.date === selectedDate) : entries}
            loading={loading}
            onEntryClick={entry => void (setSelectedId(entry.id), setView(entry.date === today ? 'editor' : 'detail'))}
            onNewEntry={handleTodayEntry}
          />
        )}
        {view === 'editor' && selectedId && (
          <MarkdownEditor
            entryId={selectedId}
            showLineNumbers={showLineNumbers}
            zoom={zoom}
            onSave={() => { setView('list'); setSelectedId(null); loadEntries() }}
            onCancel={() => { setView('list'); setSelectedId(null) }}
          />
        )}
        {view === 'detail' && selectedId && (
          <EntryDetail
            entryId={selectedId}
            isToday={selectedDate === today}
            onEdit={() => setView('editor')}
            onDelete={async () => {
              await deleteEntry(selectedId); setView('list'); setSelectedId(null); loadEntries()
            }}
            onBack={() => { setView('list'); setSelectedId(null) }}
          />
        )}
      </main>

      {showRecycleBin && (
        <RecycleBinPanel
          module="blog"
          onClose={() => setShowRecycleBin(false)}
          onRestored={() => { loadEntries(); setSelectedId(null); setView('list') }}
        />
      )}
    </div>
  )
}

// 博文详情阅读
function EntryDetail({ entryId, isToday, onEdit, onDelete, onBack }: {
  entryId: string; isToday: boolean; onEdit: () => void; onDelete: () => void; onBack: () => void
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
              {isToday && (
                <button onClick={onEdit} className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]">编辑</button>
              )}
              <button onClick={handleDeleteClick} className="px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[#e8112320] rounded">删除</button>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#e0e0e0] mb-2">{entry.date}</h1>
          <div className="prose-content" dangerouslySetInnerHTML={{ __html: entry.contentHtml || '<p>暂无内容</p>' }} />
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
