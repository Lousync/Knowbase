import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, ImagePlus, Trash2, Clock3, RefreshCw, PencilLine, Pin, PinOff, X, Camera, Check,
  ChevronLeft, ChevronRight, Search, Images, List,
} from 'lucide-react'
import { ConfirmDialog } from '../../components/shared'
import {
  createMomentsPost,
  deleteMomentsPost,
  getAvatarBase64,
  getMomentsPosts,
  getUserProfile,
  setUserCoverImage,
  setUserUsername,
  toggleMomentsPin,
  updateMomentsPost,
} from '../../lib/ipc'
import type { MomentsPost, UserProfile } from '../../types'

type EditorMode = 'create' | 'edit'
type ViewMode = 'timeline' | 'album'

type Draft = {
  contentMd: string
  imageDataUrls: string[]
  tags: string[]
}

const MAX_IMAGES = 12
const MAX_TAGS = 5
const GRID_VISIBLE = 8 // 第 9 格用于展示 "+N" 折叠
const COVER_H = 300 // 封面区固定高度（h-[300px]）
const COVER_COLLAPSED_H = 104 // 下滑到底时封面的高度
const SHRINK_RANGE = 260 // 滚动多少像素完成收缩
const INFO_CARD_H = 76 // 签名卡片原始高度

function formatDateTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function initials(name: string): string {
  const t = name.trim()
  if (!t) return 'K'
  return t.slice(0, 1).toUpperCase()
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** 把 Markdown 转成适合时间线预览的纯文本 */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' [代码块] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[|:]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 主页折叠文案：超过 maxLines 时截断并显示「全文」 */
function ClampedText({ text, maxLines = 5, onExpand }: { text: string; maxLines?: number; onExpand: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [text])

  return (
    <div>
      <div
        ref={ref}
        className="overflow-hidden whitespace-pre-wrap break-words"
        style={{ display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical' }}
      >
        {text}
      </div>
      {overflowing && (
        <button onClick={onExpand} className="mt-1.5 text-[13px] text-[var(--accent)] hover:underline">
          全文
        </button>
      )}
    </div>
  )
}

export function MomentsModule() {
  const [posts, setPosts] = useState<MomentsPost[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [tagQuery, setTagQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [mode, setMode] = useState<EditorMode>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ contentMd: '', imageDataUrls: [], tags: [] })
  const [tagInput, setTagInput] = useState('')
  const [editorImagesExpanded, setEditorImagesExpanded] = useState(false)
  const [expandedFeedIds, setExpandedFeedIds] = useState<Set<string>>(new Set())
  const [detailPostId, setDetailPostId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [avatarDataUrl, setAvatarDataUrl] = useState('')
  const [coverImageDataUrl, setCoverImageDataUrl] = useState('')
  const [coverNatural, setCoverNatural] = useState<{ w: number; h: number } | null>(null)
  const [coverPanX, setCoverPanX] = useState(0)
  const [coverPanY, setCoverPanY] = useState(0)
  const [editingSignature, setEditingSignature] = useState(false)
  const [signatureDraft, setSignatureDraft] = useState('')
  const coverInputRef = useRef<HTMLInputElement>(null)
  const postImageInputRef = useRef<HTMLInputElement>(null)
  const coverContainerRef = useRef<HTMLDivElement>(null)
  const pageScrollRef = useRef<HTMLDivElement>(null)
  const coverDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number; moved: boolean } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      setPosts(await getMomentsPosts())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadProfile = useCallback(async () => {
    try {
      const p = await getUserProfile()
      setProfile(p)
      setCoverImageDataUrl(p?.coverImageDataUrl || '')
    } catch {
      setProfile(null)
    }
  }, [])

  useEffect(() => {
    loadPosts()
    reloadProfile()
    getAvatarBase64()
      .then(v => { if (typeof v === 'string') setAvatarDataUrl(v) })
      .catch(() => setAvatarDataUrl(''))
  }, [loadPosts, reloadProfile])

  // 封面更换后重置滑动状态
  useEffect(() => {
    setCoverPanX(0)
    setCoverPanY(0)
    setCoverNatural(null)
  }, [coverImageDataUrl])

  // Esc 关闭编辑器 / 详情弹层（灯箱打开时让灯箱优先处理）
  useEffect(() => {
    if (!editorOpen && !detailPostId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightbox) {
        setEditorOpen(false)
        setDetailPostId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editorOpen, detailPostId, lightbox])

  // 灯箱：Esc 关闭，左右键切换图片
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowLeft') setLightbox(l => l ? { ...l, index: (l.index - 1 + l.images.length) % l.images.length } : l)
      if (e.key === 'ArrowRight') setLightbox(l => l ? { ...l, index: (l.index + 1) % l.images.length } : l)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const signature = profile?.username?.trim() || '写下此刻'
  const canSave = !saving && (draft.contentMd.trim().length > 0 || draft.imageDataUrls.length > 0)
  const detailPost = detailPostId ? posts.find(p => p.id === detailPostId) || null : null

  // ---- 封面滑动（微信式拖动查看完整背景） ----
  const scrollProgress = Math.min(1, Math.max(0, scrollTop / SHRINK_RANGE))
  const coverCurH = Math.round(COVER_H - scrollProgress * (COVER_H - COVER_COLLAPSED_H))
  const coverFade = 1 - scrollProgress
  const infoH = Math.round(INFO_CARD_H * coverFade)
  const headerPadTop = Math.round(20 * (1 - 0.5 * scrollProgress))
  const headerPadBottom = Math.round(16 * (1 - 0.5 * scrollProgress))

  const coverScale = useMemo(() => {
    if (!coverNatural) return null
    const cw = coverContainerRef.current?.clientWidth || 0
    if (!cw) return null
    const scale = Math.max(cw / coverNatural.w, COVER_H / coverNatural.h)
    return { w: Math.round(coverNatural.w * scale), h: Math.round(coverNatural.h * scale), cw }
  }, [coverNatural])
  const coverMaxPanX = coverScale ? Math.max(0, coverScale.w - coverScale.cw) : 0
  const coverMaxPanY = coverScale ? Math.max(0, coverScale.h - coverCurH) : 0
  const coverCanPan = coverMaxPanX > 0 || coverMaxPanY > 0
  const clampPanX = (v: number) => Math.min(0, Math.max(-coverMaxPanX, v))
  const clampPanY = (v: number) => Math.min(0, Math.max(-coverMaxPanY, v))

  // 封面加载完成后，把初始视野居中，尽量多展示照片内容
  useEffect(() => {
    if (!coverScale) return
    setCoverPanX(-coverMaxPanX / 2)
    setCoverPanY(-coverMaxPanY / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverScale])

  const onCoverPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!coverImageDataUrl || !coverCanPan) return
    if ((e.target as HTMLElement).closest('button')) return
    coverDragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: coverPanX, startPanY: coverPanY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onCoverPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = coverDragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
    setCoverPanX(clampPanX(d.startPanX + dx))
    setCoverPanY(clampPanY(d.startPanY + dy))
  }
  const onCoverPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = coverDragRef.current
    coverDragRef.current = null
    if (d && !d.moved && coverImageDataUrl) {
      setLightbox({ images: [coverImageDataUrl], index: 0 })
    }
  }

  const handlePageScroll = () => {
    setScrollTop(pageScrollRef.current?.scrollTop || 0)
  }

  const switchView = (v: ViewMode) => {
    setViewMode(v)
    pageScrollRef.current?.scrollTo({ top: 0 })
  }

  // ---- 标签筛选 ----
  const filteredPosts = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    if (!q) return posts
    return posts.filter(p => (p.tags || []).some(t => t.toLowerCase().includes(q)))
  }, [posts, tagQuery])

  const pinnedPosts = useMemo(() => filteredPosts.filter(p => p.isPinned), [filteredPosts])
  const normalPosts = useMemo(() => filteredPosts.filter(p => !p.isPinned), [filteredPosts])
  const albumGroups = useMemo(() => filteredPosts.filter(p => (p.imageDataUrls || []).length > 0), [filteredPosts])

  const closeEditor = () => {
    setEditorOpen(false)
    setEditingId(null)
    setEditorImagesExpanded(false)
  }

  const openCreate = () => {
    setMode('create')
    setEditingId(null)
    setDraft({ contentMd: '', imageDataUrls: [], tags: [] })
    setTagInput('')
    setEditorImagesExpanded(false)
    setEditorOpen(true)
  }

  const openEdit = (post: MomentsPost) => {
    setMode('edit')
    setEditingId(post.id)
    setDraft({
      contentMd: post.contentMd || '',
      imageDataUrls: post.imageDataUrls || [],
      tags: post.tags || [],
    })
    setTagInput('')
    setEditorImagesExpanded(false)
    setEditorOpen(true)
  }

  const addTag = () => {
    const raw = tagInput.trim()
    if (!raw) return
    const normalized = raw.startsWith('#') ? raw.slice(1) : raw
    setDraft(prev => {
      const exists = (prev.tags || []).some(t => t.toLowerCase() === normalized.toLowerCase())
      if (exists || prev.tags.length >= MAX_TAGS) return prev
      return { ...prev, tags: [...prev.tags, normalized] }
    })
    setTagInput('')
  }

  const removeTag = (index: number) => {
    setDraft(prev => ({ ...prev, tags: prev.tags.filter((_, i) => i !== index) }))
  }

  const handlePickImages = async () => {
    const input = postImageInputRef.current
    if (!input?.files?.length) return
    const room = MAX_IMAGES - draft.imageDataUrls.length
    const files = Array.from(input.files).slice(0, room)
    if (files.length === 0) return
    const urls = await Promise.all(files.map(readFileAsDataUrl))
    setDraft(prev => ({ ...prev, imageDataUrls: [...prev.imageDataUrls, ...urls] }))
    input.value = ''
  }

  const removeImage = (index: number) => {
    setDraft(prev => ({
      ...prev,
      imageDataUrls: prev.imageDataUrls.filter((_, i) => i !== index),
    }))
  }

  const handlePickCover = async () => {
    const input = coverInputRef.current
    if (!input?.files?.length) return
    const file = input.files[0]
    const dataUrl = await readFileAsDataUrl(file)
    await setUserCoverImage(dataUrl)
    setCoverImageDataUrl(dataUrl)
    input.value = ''
  }

  const handleRemoveCover = async () => {
    await setUserCoverImage('')
    setCoverImageDataUrl('')
  }

  const startEditSignature = () => {
    setSignatureDraft(signature)
    setEditingSignature(true)
  }

  const saveSignature = async () => {
    const trimmed = signatureDraft.trim()
    if (!trimmed) return
    await setUserUsername(trimmed)
    setEditingSignature(false)
    await reloadProfile()
  }

  const handleSave = async () => {
    const trimmed = draft.contentMd.trim()
    if (saving || (trimmed.length === 0 && draft.imageDataUrls.length === 0)) return
    setSaving(true)
    try {
      const payload = {
        contentMd: trimmed,
        contentHtml: '',
        imageDataUrls: draft.imageDataUrls,
        tags: draft.tags,
      }
      if (mode === 'create') {
        await createMomentsPost({ ...payload, isPinned: false })
      } else if (editingId) {
        await updateMomentsPost(editingId, payload)
      }
      closeEditor()
      setDraft({ contentMd: '', imageDataUrls: [], tags: [] })
      await loadPosts()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePin = async (id: string) => {
    try {
      await toggleMomentsPin(id)
      await loadPosts()
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async () => {
    if (!confirmDeleteId) return
    try {
      await deleteMomentsPost(confirmDeleteId)
      setConfirmDeleteId(null)
      await loadPosts()
    } catch (err) {
      console.error(err)
    }
  }

  const toggleFeedExpanded = (postId: string) => {
    setExpandedFeedIds(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  const renderTags = (tags: string[], onClickTag?: (tag: string) => void) => {
    if (!tags || tags.length === 0) return null
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {tags.map(t => (
          onClickTag ? (
            <button
              key={t}
              onClick={e => { e.stopPropagation(); onClickTag(t) }}
              className="px-2 py-0.5 rounded-full bg-[var(--bg-hover)] border border-[var(--border-color)] text-[11px] text-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              #{t}
            </button>
          ) : (
            <span key={t} className="px-2 py-0.5 rounded-full bg-[var(--bg-hover)] border border-[var(--border-color)] text-[11px] text-[var(--accent)]">
              #{t}
            </span>
          )
        ))}
      </div>
    )
  }

  const renderCoverGrid = (post: MomentsPost) => {
    const images = post.imageDataUrls || []
    if (images.length === 0) return null

    const expanded = expandedFeedIds.has(post.id)
    const visible = expanded ? images : images.slice(0, GRID_VISIBLE)
    const overflow = images.length - visible.length
    const isSingle = images.length === 1
    const colsClass = images.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'

    // 单图：整块封面展示
    if (isSingle) {
      return (
        <div
          onClick={e => { e.stopPropagation(); setLightbox({ images, index: 0 }) }}
          className="relative w-[38%] max-w-[250px] shrink-0 min-h-[176px] bg-[var(--bg-primary)] cursor-zoom-in"
          title="点击放大查看"
        >
          <img src={images[0]} alt="说说图片" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        </div>
      )
    }

    return (
      <div className="relative w-[38%] max-w-[250px] shrink-0 bg-[var(--bg-primary)] p-[3px]">
        <span className="absolute right-1.5 top-1.5 z-10 px-1.5 py-0.5 rounded-full bg-black/50 text-white text-[10px] pointer-events-none">
          {images.length} 张
        </span>
        <div className={`grid ${colsClass} gap-[3px]`}>
          {visible.map((img, i) => (
            <div
              key={i}
              onClick={e => { e.stopPropagation(); setLightbox({ images, index: i }) }}
              className="relative aspect-square overflow-hidden rounded-[9px] bg-[var(--bg-primary)] cursor-zoom-in"
              title="点击放大查看"
            >
              <img src={img} alt={`说说图片 ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
            </div>
          ))}
          {overflow > 0 && !expanded && (
            <button
              onClick={e => { e.stopPropagation(); toggleFeedExpanded(post.id) }}
              className="relative aspect-square overflow-hidden rounded-[9px] bg-[var(--bg-primary)]"
              title={`展开剩余 ${overflow} 张图片`}
            >
              <img src={images[GRID_VISIBLE]} alt="" className="w-full h-full object-cover" loading="lazy" />
              <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-[16px] font-semibold">
                +{overflow}
              </span>
            </button>
          )}
        </div>
        {expanded && overflow > 0 && (
          <button
            onClick={e => { e.stopPropagation(); toggleFeedExpanded(post.id) }}
            className="absolute bottom-1.5 right-1.5 z-10 px-2 py-0.5 rounded-full bg-black/55 text-white text-[10px] backdrop-blur"
          >
            收起
          </button>
        )}
      </div>
    )
  }

  const renderPost = (post: MomentsPost) => {
    const previewText = post.contentMd || stripHtmlTags(post.contentHtml || '')
    return (
      <article
        key={post.id}
        onClick={() => setDetailPostId(post.id)}
        className="flex rounded-[20px] border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden shadow-[0_10px_28px_rgba(0,0,0,0.18)] cursor-pointer hover:border-[var(--text-muted)]/40 transition-colors"
        title="查看完整文案"
      >
        {renderCoverGrid(post)}

        <div className="flex-1 min-w-0 px-4 py-3.5 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[var(--text-muted)] mt-0.5">
              <Clock3 size={11} />
              <span className="truncate">{formatDateTime(post.createdAt)}</span>
              {post.isPinned && <span className="inline-flex items-center gap-1 text-[var(--accent)]"><Pin size={10} />置顶</span>}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={e => { e.stopPropagation(); handleTogglePin(post.id) }} className="p-1.5 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title={post.isPinned ? '取消置顶' : '置顶'}>
                {post.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button onClick={e => { e.stopPropagation(); openEdit(post) }} className="p-1.5 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="编辑">
                <PencilLine size={14} />
              </button>
              <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(post.id) }} className="p-1.5 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--danger)]" title="删除">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 mt-2 text-[14px] leading-6 text-[var(--text-primary)]">
            <ClampedText
              text={plainText(previewText) || previewText}
              maxLines={4}
              onExpand={() => setDetailPostId(post.id)}
            />
          </div>

          <div className="mt-2">
            {renderTags(post.tags || [], t => setTagQuery(t))}
          </div>

          <div className="mt-2 text-[10px] text-[var(--text-muted)]">
            {post.updatedAt !== post.createdAt ? '已编辑' : '发布'}
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="relative flex flex-col h-full bg-[linear-gradient(180deg,var(--bg-primary)_0%,color-mix(in_srgb,var(--bg-primary)_84%,#0b1120)_100%)] overflow-hidden">
      <div ref={pageScrollRef} onScroll={handlePageScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="px-5" style={{ paddingTop: headerPadTop, paddingBottom: headerPadBottom }}>
          <div className="max-w-4xl mx-auto rounded-[28px] border border-[var(--border-color)] overflow-hidden bg-[var(--bg-secondary)] shadow-[0_18px_50px_rgba(0,0,0,0.26)]">
            <div
              ref={coverContainerRef}
              onPointerDown={onCoverPointerDown}
              onPointerMove={onCoverPointerMove}
              onPointerUp={onCoverPointerUp}
              className={`relative bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.45),transparent_36%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.26),transparent_30%),linear-gradient(135deg,#111827 0%,#1f2937 44%,#0f172a 100%)] overflow-hidden select-none ${coverImageDataUrl && coverCanPan ? 'cursor-grab active:cursor-grabbing' : ''}`}
              style={{ height: coverCurH, touchAction: coverCanPan ? 'none' : undefined }}
            >
            {coverImageDataUrl && (
              coverScale ? (
                <img
                  src={coverImageDataUrl}
                  alt="封面背景"
                  onLoad={e => {
                    const el = e.currentTarget
                    setCoverNatural({ w: el.naturalWidth, h: el.naturalHeight })
                  }}
                  className="absolute top-0 left-1/2 max-w-none pointer-events-none"
                  style={{ width: coverScale.w, height: coverScale.h, transform: `translate(calc(-50% + ${coverPanX}px), ${coverPanY}px)`, objectFit: 'cover' }}
                  draggable={false}
                />
              ) : (
                <img
                  src={coverImageDataUrl}
                  alt="封面背景"
                  onLoad={e => {
                    const el = e.currentTarget
                    setCoverNatural({ w: el.naturalWidth, h: el.naturalHeight })
                  }}
                  className="absolute top-0 left-0 h-full w-full object-cover pointer-events-none"
                  draggable={false}
                />
              )
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.42)_100%)] pointer-events-none" />
            <div className="absolute left-5 top-5 flex items-center gap-2 text-white/90 text-[12px] tracking-wide uppercase pointer-events-none" style={{ opacity: 1 - 0.4 * scrollProgress }}>
              <span className="inline-flex w-2 h-2 rounded-full bg-[var(--accent)]" />
              Moments
            </div>

            <button
              onClick={() => coverInputRef.current?.click()}
              className="absolute left-5 bottom-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/35 text-white text-[12px] backdrop-blur hover:bg-black/55 transition-colors"
              style={{ opacity: coverFade, pointerEvents: scrollProgress > 0.5 ? 'none' : undefined }}
              title="更换封面背景"
            >
              <Camera size={13} />
              更换封面
            </button>

            {coverImageDataUrl && (
              <button
                onClick={() => { handleRemoveCover().catch(console.error) }}
                className="absolute right-5 top-5 w-8 h-8 rounded-full bg-black/40 text-white/90 flex items-center justify-center backdrop-blur hover:bg-black/60 transition-colors"
                style={{ opacity: coverFade, pointerEvents: scrollProgress > 0.5 ? 'none' : undefined }}
                title="移除封面背景"
              >
                <X size={14} />
              </button>
            )}

            {coverImageDataUrl && coverCanPan && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/30 text-white/85 text-[11px] backdrop-blur pointer-events-none" style={{ opacity: coverFade }}>
                拖动查看完整背景
              </div>
            )}

            <div
              className="absolute right-5 bottom-5 w-24 h-24 rounded-[26px] border border-white/20 bg-white/10 backdrop-blur-md overflow-hidden shadow-xl pointer-events-none"
              style={{ opacity: coverFade, transform: `scale(${1 - 0.35 * scrollProgress})`, transformOrigin: 'bottom right' }}
            >
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-[20px] font-semibold">{initials(signature)}</div>
              )}
            </div>
          </div>

          <div className="bg-[var(--bg-secondary)] overflow-hidden" style={{ height: infoH, opacity: coverFade }}>
            <div className="h-full flex items-center px-6">
            {editingSignature ? (
              <div className="flex items-center gap-2 min-w-0">
                <input
                  autoFocus
                  value={signatureDraft}
                  onChange={e => setSignatureDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveSignature().catch(console.error)
                    if (e.key === 'Escape') setEditingSignature(false)
                  }}
                  maxLength={30}
                  placeholder="输入签名"
                  className="min-w-0 flex-1 max-w-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-[16px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => { saveSignature().catch(console.error) }}
                  className="p-2 rounded-full text-[var(--accent)] hover:bg-[var(--bg-hover)]"
                  title="保存签名"
                >
                  <Check size={17} />
                </button>
                <button
                  onClick={() => setEditingSignature(false)}
                  className="p-2 rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                  title="取消"
                >
                  <X size={17} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[18px] font-semibold text-[var(--text-primary)] truncate">{signature}</span>
                <button
                  onClick={startEditSignature}
                  className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  title="修改签名"
                >
                  <PencilLine size={14} />
                </button>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* 搜索 + 视图切换 */}
      <div className="sticky top-0 z-30 px-5 pb-3 pt-2 bg-[var(--bg-primary)]/85 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={tagQuery}
              onChange={e => setTagQuery(e.target.value)}
              placeholder="搜索标签..."
              className="w-56 pl-9 pr-8 py-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)] transition-colors"
            />
            {tagQuery && (
              <button
                onClick={() => setTagQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="清除搜索"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            <button
              onClick={() => switchView('timeline')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] transition-colors ${viewMode === 'timeline' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <List size={13} />
              时间线
            </button>
            <button
              onClick={() => switchView('album')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] transition-colors ${viewMode === 'album' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <Images size={13} />
              相册
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 pb-24">
        <div className="max-w-4xl mx-auto space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[12px] text-[var(--text-muted)] gap-2">
              <RefreshCw size={14} className="animate-spin" />
              加载中...
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-[var(--border-color)] rounded-[24px] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
              {tagQuery ? '没有找到包含该标签的说说。' : '还没有说说，先点右下角加号发第一条。'}
            </div>
          ) : viewMode === 'album' ? (
            albumGroups.length === 0 ? (
              <div className="py-20 text-center border border-dashed border-[var(--border-color)] rounded-[24px] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                相册里还没有图片，发带图的说说后会自动归档到这里。
              </div>
            ) : (
              albumGroups.map(post => (
                <section key={post.id} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.18)]">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                      <Clock3 size={12} />
                      <span>{formatDateTime(post.createdAt)}</span>
                      {post.isPinned && <span className="inline-flex items-center gap-1 text-[var(--accent)]"><Pin size={10} />置顶</span>}
                    </div>
                    <span className="text-[11px] text-[var(--text-muted)]">{post.imageDataUrls.length} 张</span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {(post.imageDataUrls || []).map((img, i) => (
                      <div
                        key={i}
                        onClick={() => setLightbox({ images: post.imageDataUrls || [], index: i })}
                        className="aspect-square rounded-xl overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] cursor-zoom-in"
                        title="点击放大查看"
                      >
                        <img src={img} alt={`相册图片 ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )
          ) : (
            <>
              {pinnedPosts.length > 0 && (
                <section className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)] px-1">置顶</div>
                  {pinnedPosts.map(renderPost)}
                </section>
              )}
              <section className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)] px-1">时间线</div>
                {normalPosts.map(renderPost)}
              </section>
            </>
          )}
        </div>
      </div>
      </div>

      <button
        onClick={openCreate}
        className="fixed right-6 bottom-6 z-40 w-16 h-16 rounded-full bg-[var(--accent)] text-white shadow-[0_18px_40px_rgba(0,0,0,0.35)] hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center"
        title="新建说说"
      >
        <Plus size={28} strokeWidth={2.2} />
      </button>

      {editorOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-center justify-center p-5"
          onMouseDown={e => { if (e.target === e.currentTarget) closeEditor() }}
        >
          <div className="w-full max-w-2xl max-h-[88%] flex flex-col rounded-[26px] border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[0_28px_90px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="h-[3px] shrink-0 bg-[linear-gradient(90deg,var(--accent),color-mix(in_srgb,var(--accent)_45%,transparent))]" />

            <div className="px-5 h-[56px] shrink-0 flex items-center justify-between gap-3 border-b border-[var(--border-color)]">
              <button
                onClick={closeEditor}
                className="px-2 py-1.5 rounded-lg text-[15px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                取消
              </button>
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">{mode === 'create' ? '发表新说说' : '编辑说说'}</span>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="px-5 py-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_80%,#0ea5e9)] text-white text-[14px] font-medium shadow-[0_6px_16px_rgba(0,0,0,0.25)] hover:opacity-90 disabled:opacity-40 disabled:shadow-none transition-all"
              >
                {saving ? '发表中...' : '发表'}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="max-w-xl mx-auto px-6 pt-6 pb-8">
                <div className="flex items-center gap-3 pb-5">
                  <div className="w-11 h-11 rounded-full overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0 shadow-sm">
                    {avatarDataUrl ? (
                      <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[14px] font-semibold text-[var(--accent)]">{initials(signature)}</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{signature}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">发到我的时间线</div>
                  </div>
                </div>

                <textarea
                  autoFocus
                  value={draft.contentMd}
                  onChange={e => setDraft(prev => ({ ...prev, contentMd: e.target.value }))}
                  placeholder="这一刻的想法..."
                  className="w-full min-h-[150px] resize-none rounded-2xl border border-[var(--border-color)] bg-[linear-gradient(180deg,var(--bg-primary)_0%,color-mix(in_srgb,var(--bg-primary)_92%,var(--bg-secondary))_100%)] px-5 py-4 text-[15px] leading-8 text-[var(--text-primary)] outline-none focus:border-[var(--accent)] shadow-inner transition-colors placeholder:text-[var(--text-disabled)]"
                />

                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  {draft.tags.map((tag, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-hover)] border border-[var(--border-color)] text-[12px] text-[var(--accent)]">
                      #{tag}
                      <button onClick={() => removeTag(i)} className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors" title="移除标签">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {draft.tags.length < MAX_TAGS && (
                    <input
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
                        if (e.key === 'Backspace' && !tagInput && draft.tags.length > 0) removeTag(draft.tags.length - 1)
                      }}
                      onBlur={addTag}
                      placeholder={draft.tags.length ? '' : '添加标签，回车确认（最多 5 个）'}
                      className="flex-1 min-w-[130px] max-w-[240px] bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
                    />
                  )}
                </div>

                <div className="mt-5">
                  <div className="grid grid-cols-3 gap-2.5 w-[264px]">
                    {draft.imageDataUrls.slice(0, editorImagesExpanded ? draft.imageDataUrls.length : GRID_VISIBLE).map((img, i) => (
                      <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-sm group">
                        <img src={img} alt={`图片 ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeImage(i)}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-black/65 text-white flex items-center justify-center hover:bg-black/85 transition-colors opacity-0 group-hover:opacity-100"
                          title="移除图片"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}

                    {!editorImagesExpanded && draft.imageDataUrls.length > GRID_VISIBLE && (
                      <button
                        onClick={() => setEditorImagesExpanded(true)}
                        className="relative aspect-square rounded-2xl overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-sm"
                        title="展开全部图片"
                      >
                        <img src={draft.imageDataUrls[GRID_VISIBLE]} alt="" className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-[18px] font-semibold">
                          +{draft.imageDataUrls.length - GRID_VISIBLE}
                        </span>
                      </button>
                    )}

                    {draft.imageDataUrls.length < MAX_IMAGES && (editorImagesExpanded || draft.imageDataUrls.length <= GRID_VISIBLE) && (
                      <button
                        onClick={() => postImageInputRef.current?.click()}
                        className="aspect-square rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-hover)]/40 flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                        title="添加图片"
                      >
                        <ImagePlus size={22} />
                        <span className="text-[11px]">添加图片</span>
                      </button>
                    )}
                  </div>

                  {editorImagesExpanded && (
                    <button
                      onClick={() => setEditorImagesExpanded(false)}
                      className="mt-3 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      收起图片
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 px-6 py-2.5 border-t border-[var(--border-color)] bg-[var(--bg-primary)]/60 flex items-center justify-between gap-3">
              <span className="text-[11px] text-[var(--text-muted)]">纯文本文案 · 图片最多 {MAX_IMAGES} 张</span>
              <span className="text-[11px] text-[var(--text-muted)]">{draft.contentMd.trim().length} 字 · {draft.imageDataUrls.length} 图 · {draft.tags.length} 标签</span>
            </div>
          </div>

          <input ref={postImageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={() => { handlePickImages().catch(console.error) }} />
        </div>
      )}

      {detailPost && (
        <div
          className="absolute inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-center justify-center p-5"
          onMouseDown={e => { if (e.target === e.currentTarget) setDetailPostId(null) }}
        >
          <div className="w-full max-w-3xl max-h-[92%] flex flex-col rounded-[26px] border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[0_28px_90px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="h-[3px] shrink-0 bg-[linear-gradient(90deg,var(--accent),color-mix(in_srgb,var(--accent)_45%,transparent))]" />

            <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] overflow-hidden flex items-center justify-center shrink-0">
                  {avatarDataUrl ? (
                    <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[13px] font-semibold text-[var(--accent)]">{initials(signature)}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)] truncate">
                    {signature}
                    {detailPost.isPinned && <span className="inline-flex items-center gap-1 text-[var(--accent)] text-[11px]"><Pin size={10} />置顶</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mt-0.5">
                    <Clock3 size={11} />
                    <span>{formatDateTime(detailPost.createdAt)}</span>
                    {detailPost.updatedAt !== detailPost.createdAt && <span>· 已编辑</span>}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDetailPostId(null)}
                className="w-8 h-8 shrink-0 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center justify-center transition-colors"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-6 py-5">
                {renderTags(detailPost.tags || [])}
                <div className={`text-[15px] leading-8 text-[var(--text-primary)] break-words whitespace-pre-wrap ${(detailPost.tags || []).length > 0 ? 'mt-3' : ''}`}>
                  {detailPost.contentMd || stripHtmlTags(detailPost.contentHtml || '')}
                </div>

                {(detailPost.imageDataUrls || []).length > 0 && (
                  <div className="mt-5">
                    {(detailPost.imageDataUrls || []).length === 1 ? (
                      <img
                        src={detailPost.imageDataUrls[0]}
                        alt="说说图片"
                        onClick={() => setLightbox({ images: detailPost.imageDataUrls || [], index: 0 })}
                        className="max-w-[200px] max-h-[320px] w-auto h-auto object-contain rounded-[12px] border border-[var(--border-color)] bg-[var(--bg-primary)] cursor-zoom-in"
                        loading="lazy"
                        title="点击放大查看"
                      />
                    ) : (
                      <div className="grid grid-cols-3 max-w-[360px] gap-1">
                        {(detailPost.imageDataUrls || []).map((img, i) => (
                          <div
                            key={i}
                            onClick={() => setLightbox({ images: detailPost.imageDataUrls || [], index: i })}
                            className="relative aspect-square overflow-hidden rounded-[12px] border border-[var(--border-color)] bg-[var(--bg-primary)] cursor-zoom-in"
                            title="点击放大查看"
                          >
                            <img src={img} alt={`说说图片 ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="absolute inset-0 z-[70] bg-black/90 backdrop-blur-sm flex items-center justify-center select-none"
          onMouseDown={e => { if (e.target === e.currentTarget) setLightbox(null) }}
        >
          {lightbox.images.length > 1 && (
            <button
              onClick={() => setLightbox(l => l ? { ...l, index: (l.index - 1 + l.images.length) % l.images.length } : l)}
              className="absolute left-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/25 flex items-center justify-center transition-colors"
              title="上一张"
            >
              <ChevronLeft size={22} />
            </button>
          )}

          <img
            src={lightbox.images[lightbox.index]}
            alt="图片预览"
            className="max-w-[88%] max-h-[88%] object-contain rounded-lg shadow-2xl"
          />

          {lightbox.images.length > 1 && (
            <button
              onClick={() => setLightbox(l => l ? { ...l, index: (l.index + 1) % l.images.length } : l)}
              className="absolute right-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/25 flex items-center justify-center transition-colors"
              title="下一张"
            >
              <ChevronRight size={22} />
            </button>
          )}

          <button
            onClick={() => setLightbox(null)}
            className="absolute right-5 top-5 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/25 flex items-center justify-center transition-colors"
            title="关闭"
          >
            <X size={18} />
          </button>

          {lightbox.images.length > 1 && (
            <span className="absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 text-white text-[12px]">
              {lightbox.index + 1} / {lightbox.images.length}
            </span>
          )}
        </div>
      )}

      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={() => { handlePickCover().catch(console.error) }} />

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="删除说说"
        message="删除后会进入回收站，之后仍可恢复。"
        confirmLabel="删除"
        showCheckbox={false}
        onConfirm={() => { handleDelete().catch(console.error) }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
