import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ImagePlus, Trash2, Clock3, RefreshCw, PencilLine, Pin, PinOff, X, Camera, Check } from 'lucide-react'
import { ConfirmDialog, MarkdownPreview } from '../../components/shared'
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

type Draft = {
  contentMd: string
  imageDataUrls: string[]
}

const MAX_IMAGES = 12
const GRID_VISIBLE = 8 // 第 9 格用于展示 "+N" 折叠

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

export function MomentsModule() {
  const [posts, setPosts] = useState<MomentsPost[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [mode, setMode] = useState<EditorMode>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ contentMd: '', imageDataUrls: [] })
  const [editorImagesExpanded, setEditorImagesExpanded] = useState(false)
  const [expandedFeedIds, setExpandedFeedIds] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [avatarDataUrl, setAvatarDataUrl] = useState('')
  const [coverImageDataUrl, setCoverImageDataUrl] = useState('')
  const [editingSignature, setEditingSignature] = useState(false)
  const [signatureDraft, setSignatureDraft] = useState('')
  const coverInputRef = useRef<HTMLInputElement>(null)
  const postImageInputRef = useRef<HTMLInputElement>(null)

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

  // Esc 关闭编辑器
  useEffect(() => {
    if (!editorOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditorOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editorOpen])

  const pinnedPosts = useMemo(() => posts.filter(p => p.isPinned), [posts])
  const normalPosts = useMemo(() => posts.filter(p => !p.isPinned), [posts])
  const signature = profile?.username?.trim() || '写下此刻'
  const canSave = !saving && draft.contentMd.trim().length > 0

  const closeEditor = () => {
    setEditorOpen(false)
    setEditingId(null)
    setEditorImagesExpanded(false)
  }

  const openCreate = () => {
    setMode('create')
    setEditingId(null)
    setDraft({ contentMd: '', imageDataUrls: [] })
    setEditorImagesExpanded(false)
    setEditorOpen(true)
  }

  const openEdit = (post: MomentsPost) => {
    setMode('edit')
    setEditingId(post.id)
    setDraft({ contentMd: post.contentMd || '', imageDataUrls: post.imageDataUrls || [] })
    setEditorImagesExpanded(false)
    setEditorOpen(true)
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
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const payload = {
        contentMd: trimmed,
        contentHtml: '',
        imageDataUrls: draft.imageDataUrls,
      }
      if (mode === 'create') {
        await createMomentsPost({ ...payload, isPinned: false })
      } else if (editingId) {
        await updateMomentsPost(editingId, payload)
      }
      closeEditor()
      setDraft({ contentMd: '', imageDataUrls: [] })
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

  const renderImageGrid = (post: MomentsPost) => {
    const images = post.imageDataUrls || []
    if (images.length === 0) return null
    const expanded = expandedFeedIds.has(post.id)
    const visible = expanded ? images : images.slice(0, GRID_VISIBLE)
    const overflow = images.length - visible.length

    const layout =
      images.length === 1
        ? 'grid-cols-1 max-w-[320px]'
        : images.length <= 4
          ? 'grid-cols-2 max-w-[440px]'
          : 'grid-cols-3 max-w-[480px]'

    return (
      <div className="mt-4">
        <div className={`grid ${layout} gap-2`}>
          {visible.map((img, i) => (
            <div key={i} className={`relative overflow-hidden rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-primary)] ${images.length === 1 ? 'aspect-[4/3]' : 'aspect-square'}`}>
              <img src={img} alt={`说说图片 ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
            </div>
          ))}
          {overflow > 0 && !expanded && (
            <button
              onClick={() => toggleFeedExpanded(post.id)}
              className="relative aspect-square overflow-hidden rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-primary)]"
              title={`展开剩余 ${overflow} 张图片`}
            >
              <img src={images[GRID_VISIBLE]} alt="" className="w-full h-full object-cover" loading="lazy" />
              <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-[20px] font-semibold">
                +{overflow}
              </span>
            </button>
          )}
        </div>
        {expanded && overflow > 0 && (
          <button onClick={() => toggleFeedExpanded(post.id)} className="mt-2.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            收起图片
          </button>
        )}
      </div>
    )
  }

  const renderPost = (post: MomentsPost) => {
    const previewText = post.contentMd || stripHtmlTags(post.contentHtml || '')
    return (
      <article key={post.id} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden shadow-[0_10px_28px_rgba(0,0,0,0.18)]">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] overflow-hidden flex items-center justify-center shrink-0">
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[13px] font-semibold text-[var(--accent)]">{initials(signature)}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{signature}</div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mt-0.5">
                <Clock3 size={11} />
                <span>{formatDateTime(post.createdAt)}</span>
                {post.isPinned && <span className="inline-flex items-center gap-1 text-[var(--accent)]"><Pin size={10} />置顶</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => handleTogglePin(post.id)} className="p-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title={post.isPinned ? '取消置顶' : '置顶'}>
              {post.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
            <button onClick={() => openEdit(post)} className="p-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="编辑">
              <PencilLine size={15} />
            </button>
            <button onClick={() => setConfirmDeleteId(post.id)} className="p-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--danger)]" title="删除">
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="text-[15px] leading-7 text-[var(--text-primary)] break-words whitespace-pre-wrap">
            <MarkdownPreview content={previewText} />
          </div>
          {renderImageGrid(post)}
          <div className="mt-3 text-[11px] text-[var(--text-muted)] flex items-center gap-2">
            <span>{post.updatedAt !== post.createdAt ? '已编辑' : '发布'}</span>
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="relative flex flex-col h-full bg-[linear-gradient(180deg,var(--bg-primary)_0%,color-mix(in_srgb,var(--bg-primary)_84%,#0b1120)_100%)] overflow-hidden">
      <div className="relative shrink-0 px-5 pt-5 pb-4">
        <div className="max-w-4xl mx-auto rounded-[28px] border border-[var(--border-color)] overflow-hidden bg-[var(--bg-secondary)] shadow-[0_18px_50px_rgba(0,0,0,0.26)]">
          <div className="relative h-56 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.45),transparent_36%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.26),transparent_30%),linear-gradient(135deg,#111827 0%,#1f2937 44%,#0f172a 100%)]">
            {coverImageDataUrl && (
              <img src={coverImageDataUrl} alt="封面背景" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.42)_100%)]" />
            <div className="absolute left-5 top-5 flex items-center gap-2 text-white/90 text-[12px] tracking-wide uppercase">
              <span className="inline-flex w-2 h-2 rounded-full bg-[var(--accent)]" />
              Moments
            </div>

            <button
              onClick={() => coverInputRef.current?.click()}
              className="absolute left-5 bottom-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/35 text-white text-[12px] backdrop-blur hover:bg-black/55 transition-colors"
              title="更换封面背景"
            >
              <Camera size={13} />
              更换封面
            </button>

            {coverImageDataUrl && (
              <button
                onClick={() => { handleRemoveCover().catch(console.error) }}
                className="absolute right-5 top-5 w-8 h-8 rounded-full bg-black/40 text-white/90 flex items-center justify-center backdrop-blur hover:bg-black/60 transition-colors"
                title="移除封面背景"
              >
                <X size={14} />
              </button>
            )}

            <div className="absolute right-5 bottom-5 w-24 h-24 rounded-[26px] border border-white/20 bg-white/10 backdrop-blur-md overflow-hidden shadow-xl">
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-[20px] font-semibold">{initials(signature)}</div>
              )}
            </div>
          </div>

          <div className="px-6 pt-5 pb-5 bg-[var(--bg-secondary)]">
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

      <div className="flex-1 overflow-y-auto px-5 pb-24">
        <div className="max-w-4xl mx-auto space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[12px] text-[var(--text-muted)] gap-2">
              <RefreshCw size={14} className="animate-spin" />
              加载中...
            </div>
          ) : posts.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-[var(--border-color)] rounded-[24px] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
              还没有说说，先点右下角加号发第一条。
            </div>
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
                  className="w-full min-h-[170px] resize-none rounded-2xl border border-[var(--border-color)] bg-[linear-gradient(180deg,var(--bg-primary)_0%,color-mix(in_srgb,var(--bg-primary)_92%,var(--bg-secondary))_100%)] px-5 py-4 text-[15px] leading-8 text-[var(--text-primary)] outline-none focus:border-[var(--accent)] shadow-inner transition-colors placeholder:text-[var(--text-disabled)]"
                />

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
              <span className="text-[11px] text-[var(--text-muted)]">支持 Markdown · 图片最多 {MAX_IMAGES} 张</span>
              <span className="text-[11px] text-[var(--text-muted)]">{draft.contentMd.trim().length} 字 · {draft.imageDataUrls.length} 图</span>
            </div>
          </div>

          <input ref={postImageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={() => { handlePickImages().catch(console.error) }} />
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
