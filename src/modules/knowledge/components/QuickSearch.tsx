import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, Folder, BookOpen } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage, KnowledgeTag } from '../../../types'
import { FileIcon } from '../../../components/shared/FileIcon'
import { getFileTypeInfo } from '../../../lib/fileTypes'

interface Props {
  pages: KnowledgePage[]
  categories: KnowledgeCategory[]
  tags: KnowledgeTag[]
  onOpenPage: (pageId: string) => void
  onLocateCategory: (categoryId: string) => void
  onRequestRefresh?: () => void
}

type ResultKind = 'page' | 'notebook' | 'folder' | 'tag'

interface ResultItem {
  kind: ResultKind
  id: string
  name: string
  subtitle?: string
  fileType?: string
  tagColor?: string
  tagPages?: KnowledgePage[]
}

const MAX_VISIBLE = 10

function fuzzyMatch(query: string, target: string): boolean {
  if (!target) return false
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  return words.every(word => {
    let idx = 0
    for (const ch of word) {
      idx = target.toLowerCase().indexOf(ch, idx)
      if (idx === -1) return false
      idx++
    }
    return true
  })
}

export function QuickSearch({ pages, categories, tags, onOpenPage, onLocateCategory, onRequestRefresh }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const portalRoot = useRef<HTMLElement | null>(null)
  const [portalReady, setPortalReady] = useState(false)

  useEffect(() => {
    const check = () => {
      const el = document.getElementById('titlebar-search')
      if (el) { portalRoot.current = el; setPortalReady(true) }
      else setTimeout(check, 50)
    }
    check()
  }, [])

  const results = useMemo((): ResultItem[] => {
    if (!query.trim()) return []
    const res: ResultItem[] = []

    // Pages by title
    for (const p of pages) {
      if (fuzzyMatch(query, p.title)) {
        const cat = p.categoryId ? categories.find(c => c.id === p.categoryId) : null
        res.push({
          kind: 'page', id: p.id, name: p.title || '无标题',
          subtitle: cat ? cat.name : '零散文件',
          fileType: p.fileType || ''
        })
      }
    }

    // Categories by name
    for (const c of categories) {
      if (fuzzyMatch(query, c.name)) {
        res.push({
          kind: c.categoryType === 'notebook' ? 'notebook' : 'folder',
          id: c.id, name: c.name,
          subtitle: c.categoryType === 'notebook' ? '笔记本' : '目录'
        })
      }
    }

    // Tags by name — show tag result even if 0 pages use it
    for (const t of tags) {
      if (fuzzyMatch(query, t.name)) {
        const tagPages = pages.filter(p => (p.tags || []).some(pt => pt.id === t.id))
        res.push({
          kind: 'tag', id: t.id, name: t.name,
          tagColor: t.color,
          tagPages,
          subtitle: tagPages.length > 0 ? `${tagPages.length} 个页面` : '暂无页面使用此标签',
        })
      }
    }

    return res
  }, [query, pages, categories, tags])

  useEffect(() => { setSelectedIdx(0) }, [results.length])

  // Ctrl+P global listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault()
        onRequestRefresh?.()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRequestRefresh])

  // Dismiss on outside click
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (panelRef.current?.contains(target)) return
      if (inputRef.current?.contains(target)) return
      setOpen(false); setQuery(''); setExpandedTagId(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open && e.key !== 'Escape') { setOpen(true); return }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(prev => Math.min(prev + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(prev => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length > 0) {
        const item = results[Math.min(selectedIdx, results.length - 1)]
        handleSelect(item)
      }
      return
    }
    if (e.key === 'Escape') {
      setOpen(false); setQuery(''); setExpandedTagId(null)
      return
    }
  }, [open, results, selectedIdx])

  const handleSelect = useCallback((item: ResultItem) => {
    switch (item.kind) {
      case 'page':
        onOpenPage(item.id); break
      case 'notebook':
      case 'folder':
        onLocateCategory(item.id); break
      case 'tag':
        if (item.tagPages && item.tagPages.length > 0) {
          setExpandedTagId(prev => prev === item.id ? null : item.id)
          return
        }
        break
    }
    setOpen(false); setQuery(''); setExpandedTagId(null)
  }, [onOpenPage, onLocateCategory])

  const handleSelectTagPage = useCallback((pageId: string) => {
    onOpenPage(pageId)
    setOpen(false); setQuery(''); setExpandedTagId(null)
  }, [onOpenPage])

  const searchBar = (
    <div className="flex items-center gap-2 w-full">
      <Search size={14} className="shrink-0 text-[var(--text-muted)]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); if (!open) { onRequestRefresh?.(); setOpen(true) } }}
        onFocus={() => { onRequestRefresh?.(); if (query.trim()) setOpen(true) }}
        onKeyDown={handleKeyDown}
        placeholder="搜索文件名、笔记本、标签..."
        className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none border-none py-0.5"
      />
      {!query && (
        <span className="shrink-0 text-[10px] text-[var(--text-disabled)] tracking-wide border border-[var(--border-color)] rounded px-1.5 py-px">
          Ctrl+P
        </span>
      )}
    </div>
  )

  return (
    <>
      {portalReady && portalRoot.current && createPortal(searchBar, portalRoot.current)}

      {open && query.trim() && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center" style={{ pointerEvents: 'none' }}
          onClick={() => { setOpen(false); setQuery(''); setExpandedTagId(null) }}
        >
          <div
            ref={panelRef}
            className="mt-10 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-2xl overflow-hidden flex flex-col"
            style={{
              width: 'min(100% - 32px, 560px)',
              maxHeight: `${MAX_VISIBLE * 36 + 8}px`,
              pointerEvents: 'auto'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {results.length === 0 ? (
                <div className="px-4 py-8 text-[13px] text-[var(--text-muted)] text-center">未找到匹配结果</div>
              ) : (
                results.map((item, idx) => (
                  <div key={item.kind + item.id}>
                    <button
                      onClick={() => handleSelect(item)}
                      className={`w-full flex items-center gap-2.5 px-4 h-9 text-left transition-colors ${
                        idx === selectedIdx ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                      }`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      {item.kind === 'page' && <FileIcon ext={item.fileType || ''} size={15} />}
                      {item.kind === 'notebook' && <BookOpen size={15} className="text-[var(--text-muted)] shrink-0" />}
                      {item.kind === 'folder' && <Folder size={15} className="text-[var(--warning)] shrink-0" />}
                      {item.kind === 'tag' && (
                        <span className="shrink-0 w-3.5 h-3.5 rounded-full" style={{ backgroundColor: item.tagColor || '#6b7280' }} />
                      )}
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-[13px] truncate">{item.name}</span>
                        {item.subtitle && (
                          <span className="text-[11px] text-[var(--text-muted)] shrink-0">{item.subtitle}</span>
                        )}
                      </div>
                      {item.kind === 'page' && (() => {
                        const fi = getFileTypeInfo(item.fileType || '')
                        return fi.badge ? (
                          <span className="shrink-0 text-[9px] px-1 rounded font-medium" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span>
                        ) : null
                      })()}
                      {item.kind === 'tag' && item.tagPages && item.tagPages.length > 0 && (
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{expandedTagId === item.id ? '▾' : '▸'}</span>
                      )}
                    </button>

                    {item.kind === 'tag' && expandedTagId === item.id && item.tagPages && item.tagPages.length > 0 && (
                      <div className="border-t border-[var(--border-color)]">
                        {item.tagPages.map(p => (
                          <button key={p.id} onClick={() => handleSelectTagPage(p.id)}
                            className="w-full flex items-center gap-2.5 pl-10 pr-4 h-8 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
                          >
                            <FileIcon ext={p.fileType || ''} size={13} />
                            <span className="flex-1 truncate">{p.title || '无标题'}</span>
                            {(() => { const fi = getFileTypeInfo(p.fileType || ''); return fi.badge ? <span className="shrink-0 text-[8px] px-1 rounded font-medium" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span> : null })()}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--border-color)] px-4 py-1.5 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>{results.length} 个结果</span>
              <span className="flex gap-3">
                <span>↑↓ 选择</span>
                <span>Enter 打开</span>
                <span>Esc 取消</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
