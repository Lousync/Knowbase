import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, Folder, BookOpen, Layers } from 'lucide-react'
import type { KnowledgeCategory, KnowledgePage, KnowledgeTag } from '../../../types'
import { FileIcon } from '../../../components/shared/FileIcon'
import { getFileTypeInfo } from '../../../lib/fileTypes'
import { searchKnowledgePages } from '../../../lib/ipc'
import { isInternalKnowledgeTag } from '../../../lib/knowledgeTags'

interface Props {
  pages: KnowledgePage[]
  categories: KnowledgeCategory[]
  tags: KnowledgeTag[]
  onOpenPage: (pageId: string) => void
  onLocateCategory: (categoryId: string) => void
  onRequestRefresh?: () => void
}

type ResultKind = 'page' | 'notebook' | 'folder' | 'space' | 'tag'

interface ResultItem {
  kind: ResultKind
  id: string
  name: string
  subtitle?: string
  fileType?: string
  tagColor?: string
  tagPages?: KnowledgePage[]
  /** 全文命中摘录（含高亮标记） */
  excerpt?: string
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

/** 把文本按关键词切分并高亮（多词任一命中） */
function Highlighted({ text, query }: { text: string; query: string }) {
  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0),
    [query]
  )
  const parts = useMemo(() => {
    if (terms.length === 0 || !text) return [{ t: text, hit: false }]
    // 扫描所有命中区间后合并输出
    const lower = text.toLowerCase()
    const ranges: [number, number][] = []
    for (const term of terms) {
      let i = 0
      while (term.length > 0) {
        const idx = lower.indexOf(term, i)
        if (idx === -1) break
        ranges.push([idx, idx + term.length])
        i = idx + term.length
      }
    }
    if (ranges.length === 0) return [{ t: text, hit: false }]
    ranges.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = [ranges[0]]
    for (const r of ranges.slice(1)) {
      const last = merged[merged.length - 1]
      if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else merged.push(r)
    }
    const out: { t: string; hit: boolean }[] = []
    let cursor = 0
    for (const [s, e] of merged) {
      if (s > cursor) out.push({ t: text.slice(cursor, s), hit: false })
      out.push({ t: text.slice(s, e), hit: true })
      cursor = e
    }
    if (cursor < text.length) out.push({ t: text.slice(cursor), hit: false })
    return out
  }, [text, terms])
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-amber-400/30 text-[var(--text-primary)] rounded-sm px-px">{p.t}</mark>
        ) : (
          <span key={i}>{p.t}</span>
        )
      )}
    </>
  )
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
  // 后端全文搜索结果（带摘录），防抖接入
  const [ftsPages, setFtsPages] = useState<KnowledgePage[]>([])
  const ftsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) { setFtsPages([]); return }
    if (ftsTimer.current) clearTimeout(ftsTimer.current)
    ftsTimer.current = setTimeout(() => {
      searchKnowledgePages(q)
        .then(setFtsPages)
        .catch(() => setFtsPages([]))
    }, 220)
    return () => { if (ftsTimer.current) clearTimeout(ftsTimer.current) }
  }, [query])

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
    const ftsMap = new Map(ftsPages.map(p => [p.id, p]))

    // Pages by title（本地即时）+ 全文命中（后端，含仅正文命中的页面）
    const titleHit = new Set<string>()
    for (const p of pages) {
      if (fuzzyMatch(query, p.title)) {
        titleHit.add(p.id)
        const cat = p.categoryId ? categories.find(c => c.id === p.categoryId) : null
        res.push({
          kind: 'page', id: p.id, name: p.title || '无标题',
          subtitle: cat ? cat.name : '零散文件',
          fileType: p.fileType || '',
          excerpt: ftsMap.get(p.id)?.excerpt,
        })
      }
    }
    // 仅正文命中的页面（标题没匹配到）
    for (const fp of ftsPages) {
      if (titleHit.has(fp.id)) continue
      if (!pages.some(p => p.id === fp.id)) continue // 防御：以当前列表为准
      const cat = fp.categoryId ? categories.find(c => c.id === fp.categoryId) : null
      res.push({
        kind: 'page', id: fp.id, name: fp.title || '无标题',
        subtitle: (cat ? cat.name : '零散文件') + ' · 正文命中',
        fileType: fp.fileType || '',
        excerpt: fp.excerpt,
      })
    }

    // Categories by name
    for (const c of categories) {
      if (fuzzyMatch(query, c.name)) {
        res.push({
          kind: c.categoryType === 'space' ? 'space' : c.categoryType === 'notebook' ? 'notebook' : 'folder',
          id: c.id, name: c.name,
          subtitle: c.categoryType === 'space' ? '空间' : c.categoryType === 'notebook' ? '笔记本' : '目录'
        })
      }
    }

    // Tags by name — show tag result even if 0 pages use it (知识包机器标签 kb-* 隐藏)
    for (const t of tags) {
      if (isInternalKnowledgeTag(t.name)) continue
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
  }, [query, pages, categories, tags, ftsPages])

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
      case 'space':
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
        placeholder="搜索"
        className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none border-none py-0.5"
      />
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
                      className={`w-full flex items-start gap-2.5 px-4 py-1.5 text-left transition-colors ${
                        idx === selectedIdx ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                      }`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      {item.kind === 'page' && <span className="mt-0.5 shrink-0"><FileIcon ext={item.fileType || ''} size={15} /></span>}
                      {item.kind === 'notebook' && <BookOpen size={15} className="mt-0.5 text-[var(--text-muted)] shrink-0" />}
                      {item.kind === 'folder' && <Folder size={15} className="mt-0.5 text-[var(--warning)] shrink-0" />}
                      {item.kind === 'space' && <Layers size={15} className="mt-0.5 text-[var(--info)] shrink-0" />}
                      {item.kind === 'tag' && (
                        <span className="shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full" style={{ backgroundColor: item.tagColor || '#6b7280' }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-h-[22px]">
                          <span className="text-[13px] truncate">
                            {item.kind === 'page'
                              ? <Highlighted text={item.name} query={query} />
                              : item.name}
                          </span>
                          {item.subtitle && (
                            <span className="text-[11px] text-[var(--text-muted)] shrink-0">{item.subtitle}</span>
                          )}
                        </div>
                        {item.excerpt && (
                          <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)] line-clamp-2">
                            <Highlighted text={item.excerpt} query={query} />
                          </p>
                        )}
                      </div>
                      {item.kind === 'page' && (() => {
                        const fi = getFileTypeInfo(item.fileType || '')
                        return fi.badge ? (
                          <span className="shrink-0 mt-0.5 text-[9px] px-1 rounded font-medium" style={{ backgroundColor: fi.color + '20', color: fi.color }}>{fi.badge}</span>
                        ) : null
                      })()}
                      {item.kind === 'tag' && item.tagPages && item.tagPages.length > 0 && (
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0 mt-0.5">{expandedTagId === item.id ? '▾' : '▸'}</span>
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
