import { useState, useEffect } from 'react'
import { FileText, Folder, Plus, Pencil, Trash2, Star, Download, ChevronDown } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage } from '../../../types'
import { getFileTypeInfo } from '../../../lib/fileTypes'
import { ConfirmDialog } from '../../../components/shared'
import { getSetting, setSetting } from '../../../lib/ipc'
import { isEditingInput } from '../../../lib/shortcuts'

interface Props {
  notebookName: string
  chapters: KnowledgeCategory[]
  selectedChapterId: string | null
  focusChapterId: string | null  // when set, hide chapter list & show only this chapter
  onSelectChapter: (id: string | null) => void
  onCreateChapter: (name: string) => void
  onRenameChapter: (id: string, name: string) => void
  onDeleteChapter: (id: string) => void
  pages: KnowledgePage[]
  activePageId: string | null
  onOpenPage: (id: string) => void
  onCreatePage: () => void
  onImport: () => void
  onDropOnChapter: (pageId: string, chapterId: string) => void
  onCollapse: () => void
  onToggleStar: (id: string) => void
}

export function ChapterPanel({
  notebookName, chapters, selectedChapterId, focusChapterId, onSelectChapter,
  onCreateChapter, onRenameChapter, onDeleteChapter,
  pages, activePageId, onOpenPage, onCreatePage, onImport,
  onDropOnChapter, onCollapse, onToggleStar,
}: Props) {
  const [showNewChapter, setShowNewChapter] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)

  useEffect(() => {
    getSetting('skipDeleteConfirm_chapter').then(v => { if (v === true) setSkipDeleteConfirm(true) })
  }, [])

  // F2 — keyboard rename selected chapter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditingInput(e)) return
      if (e.key === 'F2' && selectedChapterId) {
        e.preventDefault()
        const ch = chapters.find(c => c.id === selectedChapterId)
        if (ch) handleStartRename(ch.id, ch.name)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedChapterId, chapters])

  function handleCreateChapter() {
    if (!newName.trim()) { setShowNewChapter(false); setNewName(''); return }
    onCreateChapter(newName.trim()); setNewName(''); setShowNewChapter(false)
  }

  const focusChapter = focusChapterId ? chapters.find(c => c.id === focusChapterId) : null

  function handleStartRename(id: string, name: string) { setEditingId(id); setEditName(name) }
  function handleRename(id: string) {
    if (!editName.trim()) { setEditingId(null); return }
    onRenameChapter(id, editName.trim()); setEditingId(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-1.5 min-w-0">
          <button onClick={onCollapse}
            className="p-0.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="折叠章节面板">
            <ChevronDown size={20} />
          </button>
          <span className="text-[12px] font-medium text-[var(--text-secondary)] truncate">
            {focusChapter ? `${notebookName} / ${focusChapter.name}` : notebookName}
          </span>
        </div>
      </div>

      {/* Chapters — hidden when focusing a single chapter */}
      {!focusChapter && (
      <div
        data-drop-container
        className="px-2 py-1 border-b border-[var(--border-color)]"
        onDragOver={e => {
          e.dataTransfer.dropEffect = 'move'
          const el = (e.target as HTMLElement).closest('[data-chapter-id]') as HTMLElement | null
          setDragTargetId(el ? el.getAttribute('data-chapter-id')! : null)
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragTargetId(null)
          }
        }}
        onDrop={e => {
          e.preventDefault()
          setDragTargetId(null)
          const raw = e.dataTransfer.getData('text/plain')
          let pageId = raw
          try { const p = JSON.parse(raw); if (p.type === 'page') pageId = p.id } catch {}
          if (!pageId) return
          const chTarget = (e.target as HTMLElement).closest('[data-chapter-id]') as HTMLElement | null
          if (chTarget) {
            onDropOnChapter(pageId, chTarget.getAttribute('data-chapter-id')!)
          }
        }}
      >
        <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-1 mb-1">章节</div>
        {chapters.map(ch => (
          <div key={ch.id} data-chapter-id={ch.id}>
            {editingId === ch.id ? (
              <input
                className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[13px] outline-none text-[var(--text-primary)]"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => handleRename(ch.id)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(ch.id); if (e.key === 'Escape') setEditingId(null) }}
                autoFocus
              />
            ) : (
              <div
                onClick={() => onSelectChapter(ch.id)}
                className={`flex items-center gap-1.5 px-1 py-1 cursor-pointer group rounded transition-colors text-[13px] ${
                  selectedChapterId === ch.id ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                  : dragTargetId === ch.id ? 'bg-[var(--drop-bg)] text-[var(--text-primary)]'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Folder size={16} className={`shrink-0 ${selectedChapterId === ch.id ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`} />
                <span className="flex-1 truncate">{ch.name}</span>
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button onClick={e => { e.stopPropagation(); handleStartRename(ch.id, ch.name) }}
                    className="p-0.5 hover:text-white text-[var(--text-secondary)]" title="重命名">
                    <Pencil size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); if (skipDeleteConfirm) onDeleteChapter(ch.id); else setDeleteTarget({ id: ch.id, name: ch.name }) }}
                    className="p-0.5 hover:text-[var(--danger)] text-[var(--text-secondary)]" title="删除">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {showNewChapter ? (
          <input
            className="w-full bg-[var(--input-bg)] border border-[var(--accent)] rounded px-1.5 py-1 text-[13px] outline-none text-[var(--text-primary)] mt-0.5"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={handleCreateChapter}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateChapter(); if (e.key === 'Escape') { setShowNewChapter(false); setNewName('') } }}
            placeholder="章节名称"
            autoFocus
          />
        ) : (
          <button onClick={() => setShowNewChapter(true)}
            className="w-full flex items-center gap-1.5 px-1 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors mt-0.5">
            <Plus size={13} />新建章节
          </button>
        )}
      </div>
      )}

      {/* Pages in selected chapter */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">页面</span>
          <span className="text-[10px] text-[var(--text-muted)]">{pages.length}</span>
        </div>
        {pages.length === 0 ? (
          <p className="px-1 py-4 text-[11px] text-[var(--text-disabled)] italic text-center">
            {focusChapter ? '暂无页面' : '暂未选中章节'}
          </p>
        ) : (
          pages.map(p => (
              <div key={p.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'page', id: p.id }))
                  requestAnimationFrame(() => {
                    (e.currentTarget as HTMLElement).style.opacity = '0.4'
                  })
                }}
                onDragEnd={e => {
                  (e.currentTarget as HTMLElement).style.opacity = '1'
                }}
              >
                <div
                  onClick={() => onOpenPage(p.id)}
                  className={`flex items-center gap-1.5 px-1 py-1 cursor-pointer group rounded text-[13px] transition-colors border-l-[3px] ${
                    activePageId === p.id ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-l-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent'
                  }`}
                >
                  <FileText size={15} className="shrink-0 text-[var(--text-muted)]" />
                  <span className="flex-1 truncate">{p.title || '无标题'}</span>
                  {(() => { const fi = getFileTypeInfo(p.fileType || ''); return fi.badge ? <span className="shrink-0 text-[8px] px-1 rounded font-medium ml-0.5" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> : null })()}
                  <button onClick={e => { e.stopPropagation(); onToggleStar(p.id) }}
                    className="shrink-0 p-0.5 opacity-0 group-hover:opacity-100">
                    <Star size={13} className={p.isStarred ? 'text-[var(--warning)] fill-[#c5a332]' : 'text-[var(--text-muted)]'} />
                  </button>
                </div>
              </div>
            )
          ))}
        {(selectedChapterId || focusChapterId) && (
          <div className="flex gap-1 mt-1">
            <button onClick={onCreatePage}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
              <Plus size={12} />新建页面
            </button>
            <button onClick={onImport}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
              <Download size={12} />导入
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除章节"
        message={`确定要删除章节「${deleteTarget?.name ?? ''}」吗？其下所有页面将被移到零散文件中。`}
        confirmLabel="删除"
        onConfirm={(skipNext) => {
          if (skipNext) { setSkipDeleteConfirm(true); setSetting('skipDeleteConfirm_chapter', true) }
          if (deleteTarget) { onDeleteChapter(deleteTarget.id); setDeleteTarget(null) }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
