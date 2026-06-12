import { useState, useEffect, useCallback } from 'react'
import { Entry, Tag } from '../../types'
import { getEntries, createEntry, deleteEntry, getEntryById } from '../../lib/ipc'
import { Sidebar } from './components/Sidebar'
import { EntryList } from './views/EntryList'
import { MarkdownEditor } from './components/MarkdownEditor'

type BlogView = 'list' | 'editor' | 'detail'

export function BlogModule({ showLineNumbers = false, sidebarOpen = true }: {
  showLineNumbers?: boolean; sidebarOpen?: boolean
}) {
  const [view, setView] = useState<BlogView>('list')
  const [entries, setEntries] = useState<Entry[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
    <div className="flex h-full bg-[#1e1e1e]">
      <div className={`shrink-0 transition-all duration-200 ease-out overflow-hidden ${sidebarOpen ? 'w-56' : 'w-0'}`}>
        <Sidebar
          entries={entries}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onNewEntry={handleTodayEntry}
        />
      </div>
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
    </div>
  )
}

// 博文详情阅读
function EntryDetail({ entryId, isToday, onEdit, onDelete, onBack }: {
  entryId: string; isToday: boolean; onEdit: () => void; onDelete: () => void; onBack: () => void
}) {
  const [entry, setEntry] = useState<(Entry & { tags: Tag[] }) | null>(null)
  useEffect(() => { getEntryById(entryId).then(setEntry) }, [entryId])

  if (!entry) return <div className="flex-1 flex items-center justify-center text-[#6a6a6a]">加载中...</div>

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#3c3c3c]">
          <button onClick={onBack} className="text-sm text-[#969696] hover:text-[#cccccc]">← 返回列表</button>
          <div className="flex gap-2">
            {isToday && (
              <button onClick={onEdit} className="px-3 py-1.5 text-sm bg-[#007acc] text-white rounded hover:bg-[#1a8ad4]">编辑</button>
            )}
            <button onClick={onDelete} className="px-3 py-1.5 text-sm text-[#e81123] hover:bg-[#e8112320] rounded">删除</button>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[#e0e0e0] mb-2">{entry.date}</h1>
        <div className="prose-content" dangerouslySetInnerHTML={{ __html: entry.contentHtml || '<p>暂无内容</p>' }} />
      </div>
    </div>
  )
}
