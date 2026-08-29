import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Star, Trash2, FolderPlus, RotateCcw, ChevronDown, ChevronRight, ChevronLeft, Check, CheckSquare, Folder, Inbox } from 'lucide-react'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'
import { QuizMode } from '../../../components/shared/QuizMode'
import type { QuizItem } from '../../../components/shared/QuizParser'
import type { QuizRecordDto, QuizCollectionDto } from '../../../types'
import {
  quizRecordList, quizRecordRemove, quizRecordToggleFavorite, quizRecordSetCollections,
  quizCollectionList, quizCollectionCreate, quizCollectionDelete,
} from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'
import { ResizablePanel } from '../../../components/shared/ResizablePanel'

type Kind = 'favorite' | 'wrong'

/** 题干 markdown → 纯文本摘要（去代码块/符号，空格归一） */
function stripMarkdown(md: string): string {
  return (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`~_\-]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 书封面色板（主色 + 书脊深色），按科目名稳定分配 */
const BOOK_COLORS: Array<{ main: string; spine: string }> = [
  { main: '#a32d2d', spine: '#6d1b1b' },
  { main: '#993c1d', spine: '#662612' },
  { main: '#854f0b', spine: '#5a3507' },
  { main: '#3b6d11', spine: '#284a0a' },
  { main: '#0f6e56', spine: '#0a4a3a' },
  { main: '#185fa5', spine: '#0f3f70' },
  { main: '#534ab7', spine: '#38327c' },
  { main: '#993556', spine: '#68243a' },
]
function bookColor(name: string): { main: string; spine: string } {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return BOOK_COLORS[h % BOOK_COLORS.length]
}

/** 错次档位（错题本组内分层）：顽固 4+ / 中 2-3 / 轻 1 */
const WRONG_BANDS: Array<{ key: string; label: string; min: number; max?: number; badge: string }> = [
  { key: 'stubborn', label: '顽固错', min: 4, badge: 'bg-[var(--danger)]/10 text-[var(--danger)]' },
  { key: 'mid', label: '中错', min: 2, max: 3, badge: 'bg-[var(--warning)]/10 text-[var(--warning)]' },
  { key: 'light', label: '轻错', min: 1, max: 1, badge: 'bg-[var(--success)]/10 text-[var(--success)]' },
]
function bandOf(wrongCount: number): string {
  for (const b of WRONG_BANDS) {
    if (wrongCount >= b.min && (b.max === undefined || wrongCount <= b.max)) return b.key
  }
  return 'light'
}

/**
 * 错题本 / 收藏（按学习空间分区）。
 * 传入 spaceName 时只显示该空间的记录：书架按「知识点（来源笔记本）」分书（书=科目），
 * 翻书进入某科目后按错次档位分层；不传 spaceName 时回退为全局聚合（按来源空间分书）。
 * 重刷错题复用 QuizMode，答对即自动移出错题本（wrong_count 归零）。
 */
export function QuizCollection({ onClose, spaceName }: { onClose: () => void; spaceName?: string }) {
  const [kind, setKind] = useState<Kind>('wrong')
  const [records, setRecords] = useState<QuizRecordDto[]>([])
  const [collections, setCollections] = useState<QuizCollectionDto[]>([])
  const [bookFilter, setBookFilter] = useState<string | null>(null)
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<QuizItem[] | null>(null)
  const [newCollection, setNewCollection] = useState('')
  /** 书架「翻书」状态：true 时右侧显示书头（书名 + 返回书架），并按 bookFilter 聚焦某本书 */
  const [inBook, setInBook] = useState(false)
  /** 左侧筛选栏（按知识点/自定义分组）显隐：翻书自动收起，可拖拽手柄收放 */
  const [showSidebar, setShowSidebar] = useState(true)
  /** 勾选模式 + 选中的记录 id 集合（批量重刷） */
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  /** 记录的"书"归属：空间内按知识点（来源笔记本）分书，全局按来源空间分书 */
  const bookKeyOf = (r: QuizRecordDto) => spaceName
    ? (r.sourceNotebook || '其他')
    : (r.sourceSpace || '未分类')

  /** 当前空间限定后的记录（空间内只显示本空间的错题/收藏） */
  const baseRecords = useMemo(() => {
    if (!spaceName) return records
    return records.filter(r => r.sourceSpace === spaceName)
  }, [records, spaceName])

  /** 左侧栏列表（空间内=知识点/科目，全局=来源空间） */
  const spaces = useMemo(() => {
    const s = new Set<string>()
    baseRecords.forEach(r => s.add(bookKeyOf(r)))
    return Array.from(s)
  }, [baseRecords, spaceName])  // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => baseRecords.filter(r => {
    if (bookFilter && bookKeyOf(r) !== bookFilter) return false
    if (collectionFilter && !r.collectionIds.includes(collectionFilter)) return false
    return true
  }), [baseRecords, bookFilter, collectionFilter, spaceName])  // eslint-disable-line react-hooks/exhaustive-deps

  /** 书架分组：按"书"分本（空间内=科目/笔记本，全局=来源空间），书内统计错/藏 */
  const bookGroups = useMemo(() => {
    const m = new Map<string, QuizRecordDto[]>()
    baseRecords.forEach(r => {
      const k = bookKeyOf(r)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    })
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [baseRecords, spaceName])  // eslint-disable-line react-hooks/exhaustive-deps

  /** 翻书：进入某本书（科目/来源）聚焦视图，自动收起左侧筛选栏 */
  const openBook = (book: string) => {
    setBookFilter(book)
    setInBook(true)
    setExpanded(null)
    setShowSidebar(false)
  }
  /** 返回书架：清除书筛选，回到书架主页，恢复左侧筛选栏 */
  const backToShelf = () => {
    setBookFilter(null)
    setInBook(false)
    setExpanded(null)
    setShowSidebar(true)
  }

  const bookSpace = inBook && bookFilter ? bookFilter : null

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

  /** 重刷任意题集：单题 / 档位 / 知识点组 / 勾选批量 / 全部 共用入口 */
  const startReview = (items: QuizRecordDto[]) => {
    const list = items
      .filter(r => r.snapshot)
      .map(r => ({ no: r.snapshot!.no, points: '', question: r.snapshot!.question, options: r.snapshot!.options, answer: r.snapshot!.answer, explanation: r.snapshot!.explanation }))
    if (list.length === 0) { showToast({ type: 'warning', message: '所选题目没有可重刷的内容' }); return }
    setReviewing(list)
  }

  /** 勾选 / 取消勾选一道题 */
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 退出勾选模式（清空选择） */
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  /** 单张题目卡片：题干摘要 + 单刷/收藏/删除 + 展开完整题目；勾选模式下点摘要=勾选 */
  const renderCard = (r: QuizRecordDto) => {
    const isExp = expanded === r.id
    const snap = r.snapshot
    const summary = stripMarkdown(snap?.question || '') || r.pageTitle || '（无题干）'
    const isSel = selected.has(r.id)
    return (
      <div key={r.id} className={`relative rounded-lg border bg-[var(--bg-secondary)] overflow-hidden transition-colors ${isSel ? 'border-[var(--accent)]' : 'border-[var(--border-color)] hover:border-[var(--text-secondary)]/40'} ${isExp ? 'col-span-full' : ''}`}>
        {/* 勾选模式角标 */}
        {selectMode && (
          <span className={`absolute left-2 top-2 z-10 w-4 h-4 rounded flex items-center justify-center ${isSel ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-primary)] border border-[var(--border-color)]'}`}>
            {isSel && <Check size={11} strokeWidth={3} />}
          </span>
        )}
        <div className={`px-3 py-2.5 ${selectMode ? 'pl-8' : ''}`}>
          <button
            onClick={() => { if (selectMode) toggleSelect(r.id); else setExpanded(isExp ? null : r.id) }}
            className="w-full text-left"
            title={selectMode ? (isSel ? '取消勾选' : '勾选本题') : (isExp ? '收起' : '展开完整题目')}
          >
            <div className="text-[13px] leading-relaxed text-[var(--text-primary)] line-clamp-3">{summary}</div>
            <div className="flex items-center gap-1.5 mt-2">
              {isExp ? <ChevronDown size={13} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={13} className="shrink-0 text-[var(--text-muted)]" />}
              <span className="text-[11px] font-medium text-[var(--text-secondary)] shrink-0">第 {r.quizNo} 题</span>
              <span className="text-[11px] text-[var(--text-muted)] truncate">{r.pageTitle}</span>
              <div className="flex-1" />
              {r.wrongCount > 0 && (
                <span className="shrink-0 px-1 py-px rounded bg-[var(--danger)]/10 text-[10px] text-[var(--danger)]">错 {r.wrongCount}</span>
              )}
              {r.sourceSpace && <span className="shrink-0 px-1 py-px rounded bg-[var(--bg-hover)] text-[10px] text-[var(--text-muted)]">{r.sourceSpace}</span>}
            </div>
          </button>
          <div className="flex items-center justify-end gap-1 mt-1.5 pt-1.5 border-t border-[var(--border-color)]/60">
            <button
              onClick={() => startReview([r])}
              title="重刷本题"
              className="shrink-0 p-1 rounded text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              <RotateCcw size={13} />
            </button>
            <button
              onClick={() => void toggleFav(r)}
              title={r.isFavorite ? '取消收藏' : '收藏'}
              className={`shrink-0 p-1 rounded hover:bg-[var(--bg-hover)] ${r.isFavorite ? 'text-[#f5b301]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <Star size={14} fill={r.isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => void removeRecord(r)}
              title="移除记录"
              className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-hover)]"
            >
              <Trash2 size={14} />
            </button>
          </div>
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
        {selectMode ? (
          <>
            <button
              onClick={exitSelectMode}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              取消勾选
            </button>
            <button
              onClick={() => { startReview(filtered.filter(r => selected.has(r.id))); exitSelectMode() }}
              disabled={selected.size === 0}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90"
            >
              <RotateCcw size={13} />
              重刷所选 {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              title="勾选多道题批量重刷"
            >
              <CheckSquare size={13} />
              勾选
            </button>
            <button
              onClick={() => startReview(filtered)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              title="重刷当前筛选下全部题目"
            >
              <RotateCcw size={13} />
              重刷全部
            </button>
          </>
        )}
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X size={14} />
          关闭
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* 左侧：来源 + 自定义分组（可拖拽调宽 / 边缘收放；翻书自动收起） */}
        <ResizablePanel
          storageKey="quizCollectionSidebar"
          defaultWidth={208}
          minWidth={160}
          maxWidth={320}
          visible={showSidebar}
          onSnapClose={() => setShowSidebar(false)}
          onSnapOpen={() => setShowSidebar(true)}
        >
          <div className="h-full overflow-y-auto px-3 py-3 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
              <Inbox size={12} /> {spaceName ? '按知识点' : '按来源'}
            </div>
            <button
              onClick={() => { setBookFilter(null); setInBook(false); setShowSidebar(true) }}
              className={`w-full text-left px-2 py-1 rounded text-[12px] transition-colors ${
                bookFilter === null ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              全部（{baseRecords.length}）
            </button>
            {spaces.map(s => (
              <button
                key={s}
                onClick={() => {
                  setBookFilter(s === bookFilter ? null : s)
                  setInBook(s !== bookFilter)
                  setShowSidebar(s !== bookFilter ? false : true)
                }}
                className={`w-full text-left px-2 py-1 rounded text-[12px] transition-colors truncate ${
                  bookFilter === s ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {s}（{baseRecords.filter(r => bookKeyOf(r) === s).length}）
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
          </div>
        </ResizablePanel>

        {/* 右侧：书架 / 翻书内容 */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!bookSpace ? (
            baseRecords.length === 0 ? (
              /* 主页空态：本空间无任何错题/收藏 */
              <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] gap-2">
                <Inbox size={32} strokeWidth={1.2} />
                <div className="text-[13px]">
                  {kind === 'wrong'
                    ? (spaceName ? `「${spaceName}」暂无错题，去刷题吧` : '暂无错题，去刷题吧')
                    : (spaceName ? `「${spaceName}」暂无收藏` : '暂无收藏，看到好题点星标收藏')}
                </div>
              </div>
            ) : (
              /* 书架：主页只展示各科书本，错题在翻开书后平铺 */
              <div className="px-5 pt-4 pb-1">
                <div className="text-[11px] font-medium text-[var(--text-muted)] mb-2">{spaceName ? `${spaceName} · 错题本书架` : '错题本书架'}</div>
                <div className="flex flex-wrap gap-3">
                  {bookGroups.map(([name, list]) => {
                    const c = bookColor(name)
                    const wrong = list.filter(r => r.wrongCount > 0).length
                    const fav = list.filter(r => r.isFavorite).length
                    return (
                      <button
                        key={name}
                        onClick={() => openBook(name)}
                        title={`翻开「${name}」错题本`}
                        className="group text-left w-[150px] h-[104px] rounded-lg overflow-hidden border border-[var(--border-color)] hover:border-[var(--text-secondary)]/40 transition-colors"
                      >
                        <div className="flex h-full">
                          {/* 书脊 */}
                          <div className="w-2.5 shrink-0" style={{ background: c.spine }} />
                          {/* 封面 */}
                          <div className="flex-1 flex flex-col justify-between px-3 py-2.5 min-w-0" style={{ background: c.main }}>
                            <span className="text-[13px] font-medium text-white leading-snug line-clamp-2 break-all">{name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-white/90">错 {wrong}</span>
                              <span className="text-[11px] text-white/70">藏 {fav}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          ) : (
            <>
              {/* 书头：翻书聚焦单科 */}
              <div className="px-5 pt-3 pb-1 flex items-center gap-2 shrink-0">
                <button
                  onClick={backToShelf}
                  className="flex items-center gap-0.5 px-2 py-1 rounded text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <ChevronLeft size={13} />
                  返回书架
                </button>
                <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{bookSpace}</span>
                <span className="text-[11px] text-[var(--text-muted)] shrink-0">{filtered.length} 题</span>
              </div>

              {filtered.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] gap-2">
                  <Inbox size={32} strokeWidth={1.2} />
                  <div className="text-[13px]">
                    「{bookSpace}」暂无{kind === 'wrong' ? '错题' : '收藏'}
                  </div>
                  <button onClick={backToShelf} className="px-3 py-1.5 rounded border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                    返回书架
                  </button>
                </div>
              ) : (
            <div className="px-5 pt-4 pb-6">
              {kind === 'wrong' ? (
                WRONG_BANDS.map(band => {
                  const bandList = filtered.filter(r => bandOf(r.wrongCount) === band.key)
                  if (bandList.length === 0) return null
                  return (
                    <div key={band.key} className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`shrink-0 text-[10px] font-medium px-1.5 py-px rounded ${band.badge}`}>{band.label}</span>
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{bandList.length} 题</span>
                        <div className="flex-1" />
                        <button
                          onClick={() => startReview(bandList)}
                          className="shrink-0 text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
                        >
                          重刷这档
                        </button>
                      </div>
                      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                        {bandList.map(r => renderCard(r))}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                  {filtered.map(r => renderCard(r))}
                </div>
              )}
            </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
