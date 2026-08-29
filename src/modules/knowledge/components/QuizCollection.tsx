import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Star, Trash2, FolderPlus, RotateCcw, ChevronDown, ChevronRight, Check, Folder, Inbox } from 'lucide-react'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'
import { QuizMode } from '../../../components/shared/QuizMode'
import type { QuizItem } from '../../../components/shared/QuizParser'
import type { QuizRecordDto, QuizCollectionDto } from '../../../types'
import {
  quizRecordList, quizRecordRemove, quizRecordToggleFavorite, quizRecordSetCollections,
  quizCollectionList, quizCollectionCreate, quizCollectionDelete,
} from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

type Kind = 'favorite' | 'wrong'

/**
 * 错题本 / 收藏 聚合视图（全知识包通用）。
 * 底层聚合 quiz_records 表，按 source_space 自动分组 + 自定义分组两级分类。
 * 重刷错题复用 QuizMode，答对即自动移出错题本（wrong_count 归零）。
 */
export function QuizCollection({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('wrong')
  const [records, setRecords] = useState<QuizRecordDto[]>([])
  const [collections, setCollections] = useState<QuizCollectionDto[]>([])
  const [spaceFilter, setSpaceFilter] = useState<string | null>(null)
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<QuizItem[] | null>(null)
  const [newCollection, setNewCollection] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, cols] = await Promise.all([quizRecordList({ kind }), quizCollectionList()])
      setRecords(list)
      setCollections(cols)
    } catch (e) {
      showToast({ type: 'error', message: '加载失败' })
    }
  }, [kind])

  useEffect(() => { void load() }, [load])

  const spaces = useMemo(() => {
    const s = new Set<string>()
    records.forEach(r => { if (r.sourceSpace) s.add(r.sourceSpace) })
    return Array.from(s)
  }, [records])

  const filtered = useMemo(() => records.filter(r => {
    if (spaceFilter && r.sourceSpace !== spaceFilter) return false
    if (collectionFilter && !r.collectionIds.includes(collectionFilter)) return false
    return true
  }), [records, spaceFilter, collectionFilter])

  const toggleFav = async (r: QuizRecordDto) => {
    try {
      await quizRecordToggleFavorite(r.pageId, r.quizNo, { pageTitle: r.pageTitle, snapshot: r.snapshot ?? undefined })
      await load()
    } catch { /* ignore */ }
  }

  const removeRecord = async (r: QuizRecordDto) => {
    try {
      await quizRecordRemove(r.pageId, r.quizNo)
      await load()
    } catch { /* ignore */ }
  }

  const toggleCollection = async (r: QuizRecordDto, cid: string) => {
    const next = r.collectionIds.includes(cid)
      ? r.collectionIds.filter(x => x !== cid)
      : [...r.collectionIds, cid]
    try {
      await quizRecordSetCollections(r.id, next)
      await load()
    } catch { /* ignore */ }
  }

  const createCollection = async () => {
    const name = newCollection.trim()
    if (!name) return
    try {
      await quizCollectionCreate(name)
      setNewCollection('')
      await load()
    } catch { /* ignore */ }
  }

  const deleteCollection = async (id: string) => {
    try {
      await quizCollectionDelete(id)
      if (collectionFilter === id) setCollectionFilter(null)
      await load()
    } catch { /* ignore */ }
  }

  const startReview = () => {
    const items = filtered
      .filter(r => r.snapshot)
      .map(r => ({ no: r.snapshot!.no, points: '', question: r.snapshot!.question, options: r.snapshot!.options, answer: r.snapshot!.answer, explanation: r.snapshot!.explanation }))
    if (items.length === 0) { showToast({ type: 'warning', message: '当前没有可重刷的题目' }); return }
    setReviewing(items)
  }

  const reviewPageTitle = kind === 'wrong' ? '错题重刷' : '收藏重刷'

  if (reviewing) {
    // 重刷时用第一题的来源页面 ID 做上报（答对自动移出错题本）
    const first = filtered.find(r => r.snapshot)
    return <QuizMode quizzes={reviewing} pageTitle={reviewPageTitle} pageId={first?.pageId} onClose={() => { setReviewing(null); void load() }} />
  }

  return (
    <div className="absolute inset-0 z-50 bg-[var(--bg-primary)] flex flex-col" role="dialog" aria-label="错题本与收藏">
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center gap-3 px-4 h-11 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <span className="text-[13px] font-medium text-[var(--text-primary)]">错题本 / 收藏</span>
        <div className="flex items-center gap-1 ml-2">
          {(['wrong', 'favorite'] as Kind[]).map(k => (
            <button
              key={k}
              onClick={() => { setKind(k); setExpanded(null); setCollectionFilter(null) }}
              className={`px-2.5 py-1 rounded text-[12px] transition-colors ${
                kind === k ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {k === 'wrong' ? '错题' : '收藏'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={startReview}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <RotateCcw size={13} />
          重刷{kind === 'wrong' ? '错题' : '收藏'}
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X size={14} />
          关闭
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* 左侧：来源 + 自定义分组 */}
        <aside className="shrink-0 w-52 border-r border-[var(--border-color)] overflow-y-auto px-3 py-3 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
              <Inbox size={12} /> 按来源
            </div>
            <button
              onClick={() => setSpaceFilter(null)}
              className={`w-full text-left px-2 py-1 rounded text-[12px] transition-colors ${
                spaceFilter === null ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              全部（{records.length}）
            </button>
            {spaces.map(s => (
              <button
                key={s}
                onClick={() => setSpaceFilter(s === spaceFilter ? null : s)}
                className={`w-full text-left px-2 py-1 rounded text-[12px] transition-colors truncate ${
                  spaceFilter === s ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {s}（{records.filter(r => r.sourceSpace === s).length}）
              </button>
            ))}
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
              <Folder size={12} /> 自定义分组
            </div>
            <button
              onClick={() => setCollectionFilter(null)}
              className={`w-full text-left px-2 py-1 rounded text-[12px] transition-colors ${
                collectionFilter === null ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              全部分组
            </button>
            {collections.map(c => (
              <div key={c.id} className="group flex items-center gap-1">
                <button
                  onClick={() => setCollectionFilter(c.id === collectionFilter ? null : c.id)}
                  className={`flex-1 text-left px-2 py-1 rounded text-[12px] transition-colors truncate ${
                    collectionFilter === c.id ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {c.name}（{c.count}）
                </button>
                <button
                  onClick={() => void deleteCollection(c.id)}
                  className="hidden group-hover:flex p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)]"
                  title="删除分组"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <div className="mt-1.5 flex items-center gap-1">
              <input
                value={newCollection}
                onChange={e => setNewCollection(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void createCollection() }}
                placeholder="新建分组"
                className="flex-1 px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <button onClick={() => void createCollection()} className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)]" title="新建分组">
                <FolderPlus size={14} />
              </button>
            </div>
          </div>
        </aside>

        {/* 右侧：题目列表 */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] gap-2">
              <Inbox size={32} strokeWidth={1.2} />
              <div className="text-[13px]">
                {kind === 'wrong' ? '暂无错题，去刷题吧' : '暂无收藏，看到好题点星标收藏'}
              </div>
            </div>
          ) : (
            <div className="max-w-[720px] mx-auto px-6 py-4 space-y-3">
              {filtered.map(r => {
                const isExp = expanded === r.id
                const snap = r.snapshot
                return (
                  <div key={r.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
                    {/* 摘要行 */}
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        onClick={() => setExpanded(isExp ? null : r.id)}
                        className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                      >
                        {isExp ? <ChevronDown size={14} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)]" />}
                        <span className="text-[12px] font-medium text-[var(--text-primary)] shrink-0">第 {r.quizNo} 题</span>
                        <span className="text-[11px] text-[var(--text-muted)] truncate">{r.pageTitle}</span>
                        {r.sourceSpace && <span className="shrink-0 px-1 py-px rounded bg-[var(--bg-hover)] text-[10px] text-[var(--text-muted)]">{r.sourceSpace}</span>}
                      </button>
                      {r.wrongCount > 0 && (
                        <span className="shrink-0 text-[11px] text-[var(--danger)]">错 {r.wrongCount} 次</span>
                      )}
                      <button
                        onClick={() => void toggleFav(r)}
                        title={r.isFavorite ? '取消收藏' : '收藏'}
                        className={`shrink-0 p-1 ${r.isFavorite ? 'text-[#f5b301]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                      >
                        <Star size={15} fill={r.isFavorite ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => void removeRecord(r)}
                        title="移除记录"
                        className="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* 展开：完整题目 + 归组 */}
                    {isExp && snap && (
                      <div className="border-t border-[var(--border-color)] px-3 py-2.5 space-y-2">
                        <div className="text-[13.5px] leading-relaxed text-[var(--text-primary)] [&_.prose-content>*:first-child]:mt-0">
                          <MarkdownPreview content={snap.question} />
                        </div>
                        <div className="space-y-1">
                          {snap.options.map(o => (
                            <div
                              key={o.key}
                              className={`flex items-start gap-2 px-2.5 py-1.5 rounded border text-[13px] leading-relaxed ${
                                o.key === snap.answer
                                  ? 'border-[var(--success)] bg-[var(--success)]/10 text-[var(--text-primary)]'
                                  : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                              }`}
                            >
                              <span className="shrink-0 mt-px inline-flex items-center justify-center w-5 h-5 rounded-full border border-current text-[11px] font-medium">{o.key}</span>
                              <span className="flex-1 min-w-0 [&_.prose-content]:!m-0 [&_.prose-content>*:first-child]:mt-0 [&_.prose-content>*:last-child]:mb-0">
                                <MarkdownPreview content={o.text} />
                              </span>
                              {o.key === snap.answer && <Check size={14} className="shrink-0 mt-0.5 text-[var(--success)]" />}
                            </div>
                          ))}
                        </div>
                        {snap.explanation && (
                          <div className="px-2.5 py-2 rounded border border-dashed border-[var(--border-color)] text-[13px] leading-relaxed text-[var(--text-primary)] [&_.prose-content>*:first-child]:mt-0 [&_.prose-content>*:last-child]:mb-0">
                            <div className="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">解析</div>
                            <MarkdownPreview content={snap.explanation} />
                          </div>
                        )}
                        {/* 归组 */}
                        {collections.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[11px] text-[var(--text-muted)]">归入分组：</span>
                            {collections.map(c => {
                              const on = r.collectionIds.includes(c.id)
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => void toggleCollection(r, c.id)}
                                  className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                                    on ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--accent)]'
                                  }`}
                                >
                                  {on && <Check size={11} className="inline mr-0.5" />}
                                  {c.name}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
