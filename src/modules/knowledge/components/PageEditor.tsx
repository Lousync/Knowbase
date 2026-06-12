import { useState, useEffect, useCallback, useRef } from 'react'
import { marked } from 'marked'
import { ArrowLeft, Trash2, Eye, Edit3, Star, FileText } from 'lucide-react'
import type { KnowledgePage, KnowledgeCategory } from '../../../types'
import { getKnowledgePageById, updateKnowledgePage, deleteKnowledgePage, getKnowledgeBacklinks, updateKnowledgeLinks, toggleKnowledgeStar } from '../../../lib/ipc'

interface Props {
  pageId: string
  categories: KnowledgeCategory[]
  allPages: KnowledgePage[]
  onBack: () => void
  onDeleted: () => void
  onNavigate: (id: string) => void
  onUpdate: () => void
}

export function PageEditor({ pageId, categories, allPages, onBack, onDeleted, onNavigate, onUpdate }: Props) {
  const [page, setPage] = useState<KnowledgePage | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState(false)
  const [backlinks, setBacklinks] = useState<KnowledgePage[]>([])
  const [saving, setSaving] = useState(false)
  const [showLinkSuggest, setShowLinkSuggest] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [cursorPos, setCursorPos] = useState(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    Promise.all([
      getKnowledgePageById(pageId).then(p => {
        if (p) { setPage(p); setTitle(p.title); setContent(p.contentMd) }
      }),
      getKnowledgeBacklinks(pageId).then(setBacklinks)
    ])
  }, [pageId])

  const doSave = useCallback(async (t: string, c: string) => {
    if (!page) return
    try {
      const links = parseWikiLinks(c)
      await updateKnowledgePage(page.id, { title: t, contentMd: c, contentHtml: marked.parse(c, { async: false }) as string })
      await updateKnowledgeLinks(page.id, links)
      setSaving(false)
    } catch (e) { console.error(e) }
  }, [page])

  useEffect(() => {
    if (!page) return
    setSaving(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(title, content), 2000)
    return () => clearTimeout(saveTimer.current)
  }, [title, content, page, doSave])

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value; const pos = e.target.selectionStart
    setContent(val); setCursorPos(pos)
    const before = val.slice(0, pos)
    const lastOpen = before.lastIndexOf('[[')
    const lastClose = before.lastIndexOf(']]')
    if (lastOpen > lastClose) {
      setLinkQuery(before.slice(lastOpen + 2))
      setShowLinkSuggest(true)
    } else { setShowLinkSuggest(false) }
  }

  const insertLink = (pageTitle: string) => {
    const before = content.slice(0, cursorPos)
    const after = content.slice(cursorPos)
    const lastOpen = before.lastIndexOf('[[')
    setContent(before.slice(0, lastOpen + 2) + pageTitle + ']]' + after)
    setShowLinkSuggest(false)
    textareaRef.current?.focus()
  }

  const matchingPages = linkQuery
    ? allPages.filter(p => p.title.toLowerCase().includes(linkQuery.toLowerCase()) && p.id !== pageId).slice(0, 5)
    : allPages.filter(p => p.id !== pageId).slice(0, 5)

  const handleDelete = async () => {
    if (!page) return
    await deleteKnowledgePage(page.id)
    onDeleted()
  }

  const handleToggleStar = async () => {
    if (!page) return
    try {
      const updated = await toggleKnowledgeStar(page.id)
      setPage({ ...page, isStarred: updated.isStarred })
      onUpdate()
    } catch (e) { console.error(e) }
  }

  if (!page) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="border-2 border-[#3c3c3c] border-t-[#007acc] rounded-full w-5 h-5 animate-spin" />
    </div>
  )

  const getCategoryPath = (catId: string | null): string => {
    if (!catId) return '未分类'
    const parts: string[] = []
    let current = categories.find(c => c.id === catId)
    while (current) { parts.unshift(current.name); current = categories.find(c => c.id === current!.parentId) }
    return parts.join(' > ')
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Main editing area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="text-sm text-[#969696] hover:text-[#cccccc] flex items-center gap-1">
              <ArrowLeft size={15} /> 返回
            </button>
            <button onClick={handleToggleStar} className={`${page.isStarred ? 'text-[#c5a332]' : 'text-[#6a6a6a]'} hover:text-[#c5a332]`}>
              <Star size={15} fill={page.isStarred ? '#c5a332' : 'none'} />
            </button>
            <span className="text-[10px] text-[#6a6a6a]">{getCategoryPath(page.categoryId)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${saving ? 'bg-[#c5a332]' : 'bg-green-500'}`} />
            <span className="text-[11px] text-[#969696]">{saving ? '未保存' : '已保存'}</span>
            <button onClick={() => setPreview(v => !v)} className={`p-1 rounded text-xs ${preview ? 'bg-[#007acc] text-white' : 'text-[#969696] hover:text-[#cccccc]'}`} title="Ctrl+/">
              {preview ? <Edit3 size={14} /> : <Eye size={14} />}
            </button>
            <button onClick={handleDelete} className="p-1 rounded text-[#969696] hover:text-[#e81123]" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        {preview ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <h1 className="text-xl font-bold text-[#e0e0e0] mb-3">{title}</h1>
            <div className="prose-content" dangerouslySetInnerHTML={{ __html: page.contentHtml || (marked.parse(content, { async: false }) as string) }} />
          </div>
        ) : (
          <div className="flex flex-col flex-1 relative">
            <input
              className="w-full bg-transparent text-xl font-bold text-[#e0e0e0] px-6 py-3 outline-none border-b border-[#3c3c3c] placeholder:text-[#555]"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="页面标题"
            />
            <textarea
              ref={textareaRef}
              className="flex-1 w-full bg-transparent text-[13px] text-[#cccccc] px-6 py-3 outline-none resize-none font-mono leading-relaxed"
              value={content}
              onChange={handleContentChange}
              onKeyDown={e => {
                if (e.key === 'Tab' && showLinkSuggest && matchingPages.length > 0) { e.preventDefault(); insertLink(matchingPages[0].title) }
                if (e.key === 'Escape' && showLinkSuggest) setShowLinkSuggest(false)
              }}
              placeholder="开始写 Markdown... 使用 [[页面名]] 创建链接"
            />
            {showLinkSuggest && matchingPages.length > 0 && (
              <div className="absolute bottom-2 left-6 bg-[#2d2d2d] border border-[#007acc] rounded shadow-lg max-h-40 overflow-y-auto z-10">
                {matchingPages.map(p => (
                  <div key={p.id} onClick={() => insertLink(p.title)} className="px-3 py-1.5 text-[13px] text-[#cccccc] hover:bg-[#094771] cursor-pointer flex items-center gap-2">
                    <FileText size={12} className="text-[#969696]" />
                    <span>{p.title}</span>
                    <span className="text-[10px] text-[#6a6a6a] ml-auto">Tab</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-0.5 bg-[#007acc] text-[11px] text-white shrink-0">
          <span>{content.length} 字</span>
          <span>Ctrl+/ 预览 · Ctrl+S 保存 · [[链接]]</span>
        </div>
      </div>

      {/* Right: Backlinks */}
      {backlinks.length > 0 && (
        <div className="w-48 shrink-0 bg-[#252526] border-l border-[#3c3c3c] flex flex-col">
          <div className="px-3 py-2 border-b border-[#3c3c3c]">
            <span className="text-[11px] font-semibold text-[#969696] uppercase">反向链接 · {backlinks.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {backlinks.map(bl => (
              <div key={bl.id} onClick={() => onNavigate(bl.id)} className="px-3 py-1.5 cursor-pointer hover:bg-[#2a2d2e] border-b border-[#2d2d2d]">
                <span className="text-[12px] text-[#cccccc] truncate block">{bl.title || '无标题'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function parseWikiLinks(md: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g
  const links: string[] = []
  let m
  while ((m = re.exec(md)) !== null) {
    const title = m[1].split('|')[0].trim()
    if (!links.includes(title)) links.push(title)
  }
  return links
}
