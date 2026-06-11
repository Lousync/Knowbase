import { useState, useEffect, useCallback } from 'react'
import { Entry, Tag } from '../../types'
import { getEntries, getTags, createEntry, deleteEntry, getEntryById } from '../../lib/ipc'
import { Sidebar } from './components/Sidebar'
import { EntryList } from './views/EntryList'
import { MarkdownEditor } from './components/MarkdownEditor'

type BlogView = 'list' | 'editor' | 'detail'

export function BlogModule() {
  const [view, setView] = useState<BlogView>('list')
  const [entries, setEntries] = useState<Entry[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTagId, setActiveTagId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadEntries = useCallback(async () => {
    try {
      const filter: Record<string, unknown> = {}
      if (activeTagId) filter.tagId = activeTagId
      setEntries(await getEntries(filter))
    } catch (e) {
      console.error('Failed to load entries:', e)
    } finally {
      setLoading(false)
    }
  }, [activeTagId])

  const loadTags = useCallback(async () => {
    try { setTags(await getTags()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadEntries(); loadTags() }, [loadEntries, loadTags])

  const handleNewEntry = async () => {
    const today = new Date().toISOString().split('T')[0]
    try {
      const entry = await createEntry({ date: today, title: '' })
      setSelectedId(entry.id)
      setView('editor')
      loadEntries()
    } catch (e) { console.error(e) }
  }

  return (
    <div className="flex h-full bg-[#1e1e1e]">
      <Sidebar
        tags={tags}
        activeTagId={activeTagId}
        onSelectTag={setActiveTagId}
        onNewEntry={handleNewEntry}
        onRefresh={loadEntries}
      />
      <main className="flex-1 overflow-hidden">
        {view === 'list' && (
          <EntryList
            entries={entries}
            loading={loading}
            onEntryClick={entry => { setSelectedId(entry.id); setView('detail') }}
            onNewEntry={handleNewEntry}
          />
        )}
        {view === 'editor' && selectedId && (
          <MarkdownEditor
            entryId={selectedId}
            tags={tags}
            onSave={() => { setView('list'); setSelectedId(null); loadEntries() }}
            onCancel={() => { setView('list'); setSelectedId(null) }}
          />
        )}
        {view === 'detail' && selectedId && (
          <EntryDetail
            entryId={selectedId}
            onEdit={() => setView('editor')}
            onDelete={async () => { await deleteEntry(selectedId); setView('list'); setSelectedId(null); loadEntries() }}
            onBack={() => { setView('list'); setSelectedId(null) }}
          />
        )}
      </main>
    </div>
  )
}

// 博文阅读详情
function EntryDetail({ entryId, onEdit, onDelete, onBack }: {
  entryId: string; onEdit: () => void; onDelete: () => void; onBack: () => void
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
            <button onClick={onEdit} className="px-3 py-1.5 text-sm bg-[#007acc] text-white rounded hover:bg-[#1a8ad4]">编辑</button>
            <button onClick={onDelete} className="px-3 py-1.5 text-sm text-[#e81123] hover:bg-[#e8112320] rounded">删除</button>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[#e0e0e0] mb-2">{entry.title || '无标题'}</h1>
        <div className="flex items-center gap-3 text-sm text-[#6a6a6a] mb-6">
          <span>{entry.date}</span><span>{entry.wordCount} 字</span>
          {entry.tags?.map(t => (
            <span key={t.id} className="px-2 py-0.5 rounded text-xs text-white" style={{ backgroundColor: t.color }}>{t.name}</span>
          ))}
        </div>
        <div className="prose-content" dangerouslySetInnerHTML={{ __html: entry.contentHtml || '<p>暂无内容</p>' }} />
      </div>
    </div>
  )
}
