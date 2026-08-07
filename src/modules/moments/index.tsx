import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ImagePlus, Trash2, Clock3, RefreshCw, PencilLine, Pin, PinOff, X, ChevronLeft } from 'lucide-react'
import { ConfirmDialog, MarkdownPreview } from '../../components/shared'
import { createMomentsPost, deleteMomentsPost, getAvatarBase64, getMomentsPosts, getUserProfile, toggleMomentsPin, updateMomentsPost } from '../../lib/ipc'
import type { MomentsPost, UserProfile } from '../../types'

type EditorMode = 'create' | 'edit'

type Draft = {
  contentMd: string
  imageDataUrl: string
}

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
  const [draft, setDraft] = useState<Draft>({ contentMd: '', imageDataUrl: '' })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [avatarDataUrl, setAvatarDataUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    loadPosts()
    getUserProfile().then(setProfile).catch(() => setProfile(null))
    getAvatarBase64().then(v => { if (typeof v === 'string') setAvatarDataUrl(v) }).catch(() => setAvatarDataUrl(''))
  }, [loadPosts])

  const pinnedPosts = useMemo(() => posts.filter(p => p.isPinned), [posts])
  const normalPosts = useMemo(() => posts.filter(p => !p.isPinned), [posts])
  const draftCount = draft.contentMd.trim().length
  const signature = profile?.username?.trim() || '写下此刻'
  const headerCover = draft.imageDataUrl || posts.find(p => p.imageDataUrl)?.imageDataUrl || ''

  const openCreate = () => {
    setMode('create')
    setEditingId(null)
    setDraft({ contentMd: '', imageDataUrl: '' })
    setEditorOpen(true)
  }

  const openEdit = (post: MomentsPost) => {
    setMode('edit')
    setEditingId(post.id)
    setDraft({ contentMd: post.contentMd || '', imageDataUrl: post.imageDataUrl || '' })
    setEditorOpen(true)
  }

  const handlePickImage = async () => {
    const input = fileInputRef.current
    if (!input?.files?.length) return
    const file = input.files[0]
    const dataUrl = await readFileAsDataUrl(file)
    setDraft(prev => ({ ...prev, imageDataUrl: dataUrl }))
    input.value = ''
  }

  const handleSave = async () => {
    const trimmed = draft.contentMd.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const payload = {
        contentMd: trimmed,
        contentHtml: '',
        imageDataUrl: draft.imageDataUrl,
      }
      if (mode === 'create') {
        await createMomentsPost({ ...payload, isPinned: false })
      } else if (editingId) {
        await updateMomentsPost(editingId, payload)
      }
      setEditorOpen(false)
      setEditingId(null)
      setDraft({ contentMd: '', imageDataUrl: '' })
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
          <div className={`grid gap-4 ${post.imageDataUrl ? 'grid-cols-[96px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
            {post.imageDataUrl && (
              <div className="rounded-[18px] overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] aspect-[4/5]">
                <img src={post.imageDataUrl} alt="说说图片" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="min-w-0 flex flex-col justify-between">
              <div className="text-[15px] leading-7 text-[var(--text-primary)] break-words whitespace-pre-wrap">
                <MarkdownPreview content={previewText || stripHtmlTags(post.contentHtml || '')} />
              </div>
              <div className="mt-3 text-[11px] text-[var(--text-muted)] flex items-center gap-2">
                <span>{post.updatedAt !== post.createdAt ? '已编辑' : '发布'}</span>
              </div>
            </div>
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
            {headerCover ? (
              <img src={headerCover} alt="背景图" className="absolute inset-0 h-full w-full object-cover opacity-35" />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.42)_100%)]" />
            <div className="absolute left-5 top-5 flex items-center gap-2 text-white/90 text-[12px] tracking-wide uppercase">
              <span className="inline-flex w-2 h-2 rounded-full bg-[var(--accent)]" />
              Moments
            </div>
            <div className="absolute right-5 bottom-5 w-24 h-24 rounded-[26px] border border-white/20 bg-white/10 backdrop-blur-md overflow-hidden shadow-xl">
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-[20px] font-semibold">{initials(signature)}</div>
              )}
            </div>
          </div>

          <div className="px-6 pt-5 pb-5 bg-[var(--bg-secondary)]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[22px] font-semibold text-[var(--text-primary)]">说说</div>
                <div className="text-[12px] text-[var(--text-muted)] mt-1">单机离线时间线，不含点赞功能</div>
              </div>
              <div className="text-right">
                <div className="text-[12px] text-[var(--text-secondary)]">{signature}</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1">记录一下此刻的想法</div>
              </div>
            </div>
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-5xl h-[82vh] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-[28px] shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3 bg-[var(--bg-secondary)]">
              <div className="min-w-0">
                <button onClick={() => setEditorOpen(false)} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-2">
                  <ChevronLeft size={14} />
                  返回
                </button>
                <h3 className="text-[16px] font-semibold text-[var(--text-primary)]">{mode === 'create' ? '发表说说' : '编辑说说'}</h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{draftCount} 字 · 支持图片和简单 Markdown</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <ImagePlus size={14} />
                  添加图片
                </button>
                <button onClick={() => setEditorOpen(false)} className="px-3 py-2 rounded-xl text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">取消</button>
                <button onClick={handleSave} disabled={!draft.contentMd.trim() || saving} className="px-4 py-2 rounded-xl text-[12px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40">
                  {saving ? '保存中...' : '发布'}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="border-r border-[var(--border-color)] bg-[var(--bg-primary)] flex flex-col min-h-0">
                <div className="px-5 py-4 flex-1 min-h-0 flex flex-col gap-4">
                  <div className="rounded-[24px] border border-[var(--border-color)] overflow-hidden bg-[linear-gradient(135deg,#111827,#1f2937)] min-h-[160px] relative">
                    {draft.imageDataUrl ? (
                      <img src={draft.imageDataUrl} alt="图片预览" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)]">
                        <ImagePlus size={32} className="mb-2 opacity-60" />
                        <span className="text-[12px]">添加图片后可作为封面</span>
                      </div>
                    )}
                    {draft.imageDataUrl && (
                      <button onClick={() => setDraft(prev => ({ ...prev, imageDataUrl: '' }))} className="absolute right-3 top-3 w-8 h-8 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/60">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <textarea
                    value={draft.contentMd}
                    onChange={e => setDraft(prev => ({ ...prev, contentMd: e.target.value }))}
                    placeholder={'今天发生了什么...\n\n写点想法，或者留一段文字。'}
                    className="flex-1 min-h-[180px] resize-none rounded-[24px] border border-[var(--border-color)] bg-[var(--bg-secondary)] px-5 py-4 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] leading-7 shadow-inner"
                  />
                </div>
              </div>

              <div className="bg-[var(--bg-primary)] min-h-0 flex flex-col">
                <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--text-primary)]">实时预览</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">发布前看一眼最终效果</div>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">{draftCount} 字</div>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  {draft.contentMd.trim() ? (
                    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden shadow-sm">
                      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-[var(--border-color)]">
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)]">
                          {avatarDataUrl ? <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[var(--accent)] font-semibold">{initials(signature)}</div>}
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-[var(--text-primary)]">{signature}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">发布预览</div>
                        </div>
                      </div>
                      <div className="p-4">
                        {draft.imageDataUrl && (
                          <div className="mb-4 rounded-[18px] overflow-hidden border border-[var(--border-color)]">
                            <img src={draft.imageDataUrl} alt="图片" className="w-full max-h-64 object-cover" />
                          </div>
                        )}
                        <div className="text-[14px] leading-7 text-[var(--text-primary)] break-words whitespace-pre-wrap">
                          <MarkdownPreview content={draft.contentMd} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full rounded-[24px] border border-dashed border-[var(--border-color)] flex items-center justify-center text-[12px] text-[var(--text-disabled)]">
                      输入文字后会在这里显示预览
                    </div>
                  )}
                </div>
              </div>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={() => { handlePickImage().catch(console.error) }} />
          </div>
        </div>
      )}

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
